import "./styles.css";
import * as THREE from "three";
import { loadCatalog, type Star } from "./astro/catalog";
import { createScene } from "./scene/setup";
import { SkyControls } from "./scene/controls";
import { Starfield } from "./stars/starfield";
import { createBackgroundStars, updateBackgroundFov } from "./stars/background";
import { Constellations } from "./constellations/constellations";
import { createMilkyWay, updateMilkyWayFov } from "./galaxy/milkyway";
import { Flight } from "./flight/flight";
import { HorizonScene } from "./scene/horizon";
import { getJD, localSiderealTime } from "./astro/solar";
import {
  CONSTELLATION_JA,
  CONSTELLATION_STORY,
  STAR_JA,
  spectralDescription,
} from "./data/names-ja";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

async function bootstrap() {
  const loadingLabel = $("loading-label");
  const catalog = await loadCatalog(
    (label) => (loadingLabel.textContent = label),
  );

  const ctx = createScene($("app"));
  const { camera, composer, skyGroup, renderer } = ctx;
  const controls = new SkyControls(camera, renderer.domElement);

  const starfield = new Starfield(catalog);
  skyGroup.add(starfield.points);

  const bgStars = createBackgroundStars();
  skyGroup.add(bgStars);

  const constellations = new Constellations(catalog, skyGroup);
  skyGroup.add(constellations.group);

  const milkyway = createMilkyWay();
  skyGroup.add(milkyway);

  const flight = new Flight(ctx.scene, camera, skyGroup);
  const horizonScene = new HorizonScene(ctx.scene, skyGroup, camera);

  // ---- 時刻シミュレーション ----
  let simDate = new Date();
  let simSpeed = 0; // 0=停止, 1=実時間, 60, 3600, 86400

  // 東京緯度 35.69°N での天の北極方向（世界座標）
  const LAT_RAD = 35.69 * Math.PI / 180;
  const POLAR_AXIS_WORLD = new THREE.Vector3(0, Math.sin(LAT_RAD), -Math.cos(LAT_RAD));

  // skyGroupを現在のLSTに合わせて正確に配置
  // Step1: 緯度ティルト (北極を天頂→仰角LAT°の北に移動)
  // Step2: LST回転 (RA=lstが南中するよう π-lst で回転)
  function setSkyGroupOrientation(lst: number) {
    const qTilt = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(-1, 0, 0),
      Math.PI / 2 - LAT_RAD,
    );
    const qLst = new THREE.Quaternion().setFromAxisAngle(
      POLAR_AXIS_WORLD,
      Math.PI - lst,
    );
    skyGroup.quaternion.copy(qLst).multiply(qTilt);
  }

  let prevLST = localSiderealTime(getJD(simDate));
  setSkyGroupOrientation(prevLST);

  // ---- UI要素 ----
  const infoPanel = $("info-panel");
  const infoName = $("info-name");
  const infoSub = $("info-sub");
  const infoRows = $<HTMLDListElement>("info-rows");
  const backButton = $("back-button");
  const hint = $("hint");
  const search = $<HTMLInputElement>("search");
  const datalist = $<HTMLDataListElement>("constellation-list");
  const tbDatetime = $("tb-datetime");
  const tbSlider = $<HTMLInputElement>("tb-slider");

  for (const n of constellations.allNames) {
    const opt = document.createElement("option");
    opt.value = n.ja;
    opt.label = n.latin;
    datalist.appendChild(opt);
  }

  // ---- 情報パネル ----
  function showStarInfo(star: Star) {
    const ja = star.proper ? STAR_JA[star.proper] : undefined;
    const title =
      ja ??
      star.proper ??
      (star.bayer && star.con
        ? `${star.bayer} ${star.con}`
        : `HIP ${star.hip || "—"}`);
    infoName.textContent = title;

    const subParts: string[] = [];
    if (ja && star.proper) subParts.push(star.proper);
    if (star.bayer && star.con) subParts.push(`${star.bayer} ${star.con}`);
    infoSub.textContent = subParts.join(" · ");

    const conJa = star.con ? (CONSTELLATION_JA[star.con] ?? star.con) : "—";
    const ly = star.dist > 0 ? star.dist * 3.2616 : 0;
    const distText =
      ly === 0
        ? "不明"
        : ly >= 100
          ? `約 ${Math.round(ly).toLocaleString()} 光年`
          : `約 ${ly.toFixed(1)} 光年`;

    const rows: [string, string][] = [
      ["星座", conJa],
      ["距離", distText],
      ["視等級", star.mag.toFixed(2)],
      ["スペクトル型", star.spect || "—"],
      ["分類", spectralDescription(star.spect)],
      ["HIP番号", star.hip ? String(star.hip) : "—"],
    ];
    infoRows.innerHTML = "";
    for (const [dt, dd] of rows) {
      const dtEl = document.createElement("dt");
      dtEl.textContent = dt;
      const ddEl = document.createElement("dd");
      ddEl.textContent = dd;
      infoRows.appendChild(dtEl);
      infoRows.appendChild(ddEl);
    }
    if (star.con) {
      const story = CONSTELLATION_STORY[star.con];
      if (story) {
        const storyEl = document.createElement("p");
        storyEl.className = "info-story";
        storyEl.textContent = story;
        infoRows.after(storyEl);
      }
    }
    infoPanel.classList.remove("hidden");
  }

  function showConstellationInfo(abbr: string) {
    const jaName = CONSTELLATION_JA[abbr] ?? abbr;
    infoName.textContent = jaName;
    infoSub.textContent = abbr;
    infoRows.innerHTML = "";
    infoRows.parentElement?.querySelectorAll(".info-story").forEach((e) => e.remove());
    const story = CONSTELLATION_STORY[abbr];
    if (story) {
      const storyEl = document.createElement("p");
      storyEl.className = "info-story";
      storyEl.textContent = story;
      infoRows.after(storyEl);
    }
    infoPanel.classList.remove("hidden");
  }

  $("info-close").addEventListener("click", () => {
    infoPanel.classList.add("hidden");
    infoRows.parentElement?.querySelectorAll(".info-story").forEach((e) => e.remove());
  });

  // ---- フライト ----
  flight.onArrive = (t) => {
    backButton.classList.remove("hidden");
    showStarInfo(t.star);
  };
  flight.onReturn = () => {
    camera.position.set(0, 0, 0);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    controls.syncFromCamera();
    controls.enabled = true;
    controls.forceUpdate();
    hint.classList.remove("hidden");
  };
  backButton.addEventListener("click", () => {
    backButton.classList.add("hidden");
    infoPanel.classList.add("hidden");
    flight.returnHome();
  });

  // ---- ポインタ操作 ----
  const ndc = new THREE.Vector2();
  let hoverStar: Star | null = null;

  renderer.domElement.addEventListener("pointermove", (e) => {
    ndc.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
  });

  renderer.domElement.addEventListener("click", () => {
    if (!controls.enabled || flight.busy) return;
    if (controls.dragDistance > 6) return;
    const star = starfield.pick(ndc.x, ndc.y, camera, skyGroup.quaternion);
    if (star) {
      controls.enabled = false;
      hint.classList.add("hidden");
      infoPanel.classList.add("hidden");
      infoRows.parentElement?.querySelectorAll(".info-story").forEach((e) => e.remove());
      flight.start(star);
      return;
    }
    const con = constellations.hitTest(ndc.x, ndc.y, camera);
    if (con) {
      showConstellationInfo(con.def.abbr);
    }
  });

  // ---- 検索 ----
  function gotoConstellation(query: string) {
    const hit = constellations.findByName(query);
    if (!hit) return;
    constellations.flashConstellation(hit.abbr);
    const dir = hit.centroid.clone().applyQuaternion(skyGroup.quaternion);
    controls.lookTowards(dir, 1.8);
    search.blur();
  }
  search.addEventListener("change", () => gotoConstellation(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") gotoConstellation(search.value);
  });

  // ---- トグル ----
  const toggleLines = $("toggle-lines");
  const toggleLabels = $("toggle-labels");
  toggleLines.addEventListener("click", () => {
    constellations.linesVisible = !constellations.linesVisible;
    toggleLines.classList.toggle("active", constellations.linesVisible);
  });
  toggleLabels.addEventListener("click", () => {
    constellations.labelsVisible = !constellations.labelsVisible;
    toggleLabels.classList.toggle("active", constellations.labelsVisible);
  });

  // ---- 時間コントロールバー ----
  function setSimSpeed(speed: number) {
    simSpeed = speed;
    document.querySelectorAll(".tb-speed").forEach((btn) => {
      const b = btn as HTMLButtonElement;
      b.classList.toggle("active", Number(b.dataset.speed) === speed);
    });
  }

  document.querySelectorAll(".tb-speed").forEach((btn) => {
    btn.addEventListener("click", () => {
      setSimSpeed(Number((btn as HTMLButtonElement).dataset.speed));
    });
  });

  $("tb-prev").addEventListener("click", () => {
    const d = new Date(simDate.getTime() - 86400 * 1000);
    jumpSimDate(d);
  });
  $("tb-next").addEventListener("click", () => {
    const d = new Date(simDate.getTime() + 86400 * 1000);
    jumpSimDate(d);
  });

  let sliderDragging = false;
  tbSlider.addEventListener("mousedown", () => { sliderDragging = true; });
  tbSlider.addEventListener("touchstart", () => { sliderDragging = true; });
  tbSlider.addEventListener("input", () => {
    const minutes = Number(tbSlider.value);
    const d = new Date(simDate);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    jumpSimDate(d);
  });
  tbSlider.addEventListener("mouseup", () => { sliderDragging = false; });
  tbSlider.addEventListener("touchend", () => { sliderDragging = false; });

  function jumpSimDate(newDate: Date) {
    simDate = newDate;
    prevLST = localSiderealTime(getJD(simDate));
    setSkyGroupOrientation(prevLST);
    horizonScene["lastUpdateMs"] = 0;
    updateTimeBar();
  }

  function updateTimeBar() {
    const dateStr = simDate.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const timeStr = simDate.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
    tbDatetime.textContent = `${dateStr} ${timeStr}`;
    if (!sliderDragging) {
      const minutesOfDay = simDate.getHours() * 60 + simDate.getMinutes();
      tbSlider.value = String(minutesOfDay);
    }
  }
  updateTimeBar();

  // ---- メインループ ----
  const clock = new THREE.Clock();
  let hoverThrottle = 0;
  let timeBarThrottle = 0;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const time = clock.elapsedTime;

    // 時刻シミュレーション
    if (simSpeed !== 0 && !flight.busy) {
      simDate = new Date(simDate.getTime() + dt * simSpeed * 1000);
    }
    const currLST = localSiderealTime(getJD(simDate));
    const lstDelta = currLST - prevLST;
    if (Math.abs(lstDelta) > 1e-10) {
      const dq = new THREE.Quaternion().setFromAxisAngle(POLAR_AXIS_WORLD, -lstDelta);
      skyGroup.quaternion.premultiply(dq);
      prevLST = currLST;
    }

    controls.update(dt);
    flight.update(dt, time);
    starfield.update(time, camera);
    updateBackgroundFov(bgStars, camera);
    updateMilkyWayFov(milkyway, camera);
    constellations.update(dt, camera);
    horizonScene.update(time, simDate);

    hoverThrottle++;
    if (hoverThrottle % 2 === 0 && controls.enabled) {
      const hit = constellations.hitTest(ndc.x, ndc.y, camera);
      constellations.setHovered(hit);
      hoverStar = starfield.pick(ndc.x, ndc.y, camera, skyGroup.quaternion, 14);
      renderer.domElement.style.cursor = hoverStar || hit ? "pointer" : "grab";
    }

    // タイムバー更新（simSpeed速い時は毎フレーム、遅い時は数秒ごと）
    timeBarThrottle++;
    const tbInterval = simSpeed >= 3600 ? 1 : simSpeed >= 60 ? 10 : 120;
    if (timeBarThrottle % tbInterval === 0) {
      updateTimeBar();
    }

    composer.render();
  }

  $("loading").classList.add("hidden");
  frame();
}

bootstrap().catch((err) => {
  const label = document.getElementById("loading-label");
  if (label) label.textContent = `エラー: ${err.message ?? err}`;
  console.error(err);
});
