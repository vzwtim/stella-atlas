import * as THREE from "three";
import type { Catalog, ConstellationDef } from "../astro/catalog";
import { SKY_RADIUS } from "../astro/coords";
import { CONSTELLATION_JA } from "../data/names-ja";

interface ConstellationEntry {
  def: ConstellationDef;
  nameJa: string;
  lines: THREE.LineSegments;
  material: THREE.LineBasicMaterial;
  label: THREE.Sprite;
  centroid: THREE.Vector3; // 単位方向
  /** スクリーン空間ホバー判定用のセグメント端点（単位方向ペア） */
  segments: [THREE.Vector3, THREE.Vector3][];
}

const BASE_OPACITY = 0.12;
const HOVER_OPACITY = 0.42;
const LABEL_BASE = 0.4;
const LABEL_HOVER = 1.0;

function makeLabelTexture(
  textJa: string,
  textLatin: string,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(190, 215, 255, 0.95)";
  ctx.font = '500 44px "Hiragino Kaku Gothic ProN", "Yu Gothic UI", sans-serif';
  ctx.fillText(textJa, 256, 56);
  ctx.fillStyle = "rgba(190, 215, 255, 0.55)";
  ctx.font = "300 26px Georgia, serif";
  ctx.fillText(textLatin, 256, 100);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Constellations {
  readonly group = new THREE.Group();
  private entries: ConstellationEntry[] = [];
  private byAbbr = new Map<string, ConstellationEntry>();
  private hovered: ConstellationEntry | null = null;
  private flash: { entry: ConstellationEntry; t: number } | null = null;
  linesVisible = true;
  labelsVisible = true;

  private pa = new THREE.Vector3();
  private pb = new THREE.Vector3();

  constructor(
    catalog: Catalog,
    private skyGroup: THREE.Group,
  ) {
    const lineR = SKY_RADIUS * 0.995;

    for (const def of catalog.constellations) {
      const verts: number[] = [];
      const segments: [THREE.Vector3, THREE.Vector3][] = [];
      const centroid = new THREE.Vector3();
      let count = 0;

      for (const poly of def.lines) {
        for (let i = 0; i < poly.length - 1; i++) {
          const a = catalog.byHip.get(poly[i]);
          const b = catalog.byHip.get(poly[i + 1]);
          if (!a || !b) continue;
          // 星の少し手前で線を止め、星に線が刺さらないようにする
          const dirA = a.dir.clone();
          const dirB = b.dir.clone();
          const trimmed = dirA.clone().lerp(dirB, 0.04).normalize();
          const trimmedB = dirA.clone().lerp(dirB, 0.96).normalize();
          verts.push(
            trimmed.x * lineR,
            trimmed.y * lineR,
            trimmed.z * lineR,
            trimmedB.x * lineR,
            trimmedB.y * lineR,
            trimmedB.z * lineR,
          );
          segments.push([dirA, dirB]);
          centroid.add(dirA).add(dirB);
          count += 2;
        }
      }
      if (count === 0) continue;
      centroid.divideScalar(count).normalize();

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(0.45, 0.62, 0.95),
        transparent: true,
        opacity: BASE_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(geo, material);
      lines.renderOrder = 1;

      const nameJa = CONSTELLATION_JA[def.abbr] ?? def.name;
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeLabelTexture(nameJa, def.name),
          transparent: true,
          opacity: LABEL_BASE,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      label.position.copy(centroid).multiplyScalar(SKY_RADIUS * 0.97);
      label.scale.set(110, 27.5, 1);
      label.renderOrder = 3;

      const entry: ConstellationEntry = {
        def,
        nameJa,
        lines,
        material,
        label,
        centroid,
        segments,
      };
      this.entries.push(entry);
      this.byAbbr.set(def.abbr, entry);
      this.group.add(lines);
      this.group.add(label);
    }
  }

  /** カーソル直下の星座を返す（スクリーン空間で最寄りの星座線を探す） */
  hitTest(
    ndcX: number,
    ndcY: number,
    camera: THREE.PerspectiveCamera,
    maxPixels = 18,
  ): ConstellationEntry | null {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const viewDir = new THREE.Vector3();
    camera.getWorldDirection(viewDir);
    const q = this.skyGroup.quaternion;

    let best: ConstellationEntry | null = null;
    let bestPx = maxPixels;

    for (const entry of this.entries) {
      // 視野外の星座を粗く除外
      this.pa.copy(entry.centroid).applyQuaternion(q);
      if (this.pa.dot(viewDir) < 0.1) continue;

      for (const [a, b] of entry.segments) {
        this.pa
          .copy(a)
          .applyQuaternion(q)
          .multiplyScalar(SKY_RADIUS)
          .project(camera);
        this.pb
          .copy(b)
          .applyQuaternion(q)
          .multiplyScalar(SKY_RADIUS)
          .project(camera);
        if (this.pa.z > 1 || this.pb.z > 1) continue;
        const ax = ((this.pa.x - ndcX) * w) / 2;
        const ay = ((this.pa.y - ndcY) * h) / 2;
        const bx = ((this.pb.x - ndcX) * w) / 2;
        const by = ((this.pb.y - ndcY) * h) / 2;
        // 点(0,0)から線分(a-b)までの距離
        const abx = bx - ax;
        const aby = by - ay;
        const len2 = abx * abx + aby * aby;
        const t =
          len2 > 0
            ? THREE.MathUtils.clamp(-(ax * abx + ay * aby) / len2, 0, 1)
            : 0;
        const dx = ax + abx * t;
        const dy = ay + aby * t;
        const px = Math.sqrt(dx * dx + dy * dy);
        if (px < bestPx) {
          bestPx = px;
          best = entry;
        }
      }
    }
    return best;
  }

  setHovered(entry: ConstellationEntry | null) {
    this.hovered = entry;
  }

  get hoveredName(): { ja: string; latin: string } | null {
    return this.hovered
      ? { ja: this.hovered.nameJa, latin: this.hovered.def.name }
      : null;
  }

  /** 検索ヒット時に一時的に強調表示する */
  flashConstellation(abbr: string): THREE.Vector3 | null {
    const entry = this.byAbbr.get(abbr);
    if (!entry) return null;
    this.flash = { entry, t: 3.0 };
    return entry.centroid.clone();
  }

  findByName(query: string): { abbr: string; centroid: THREE.Vector3 } | null {
    const nq = query.trim().toLowerCase();
    if (!nq) return null;
    for (const e of this.entries) {
      if (
        e.nameJa === nq ||
        e.nameJa.toLowerCase().includes(nq) ||
        e.def.name.toLowerCase().includes(nq) ||
        e.def.abbr.toLowerCase() === nq
      ) {
        return { abbr: e.def.abbr, centroid: e.centroid.clone() };
      }
    }
    return null;
  }

  get allNames(): { ja: string; latin: string }[] {
    return this.entries.map((e) => ({ ja: e.nameJa, latin: e.def.name }));
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    if (this.flash) {
      this.flash.t -= dt;
      if (this.flash.t <= 0) this.flash = null;
    }
    const viewDir = new THREE.Vector3();
    camera.getWorldDirection(viewDir);
    const q = this.skyGroup.quaternion;
    const tmp = this.pa;

    for (const e of this.entries) {
      const isHover = e === this.hovered;
      const isFlash =
        this.flash?.entry === e && Math.sin(this.flash.t * 10) > -0.3;
      const lineTarget = this.linesVisible
        ? isHover || isFlash
          ? HOVER_OPACITY
          : BASE_OPACITY
        : 0;
      e.material.opacity +=
        (lineTarget - e.material.opacity) * Math.min(dt * 10, 1);

      // 視線が向いている星座のラベルだけ浮かび上がらせる
      tmp.copy(e.centroid).applyQuaternion(q);
      const facing = THREE.MathUtils.smoothstep(tmp.dot(viewDir), 0.75, 0.97);
      const labelTarget = this.labelsVisible
        ? isHover || isFlash
          ? LABEL_HOVER
          : LABEL_BASE * facing
        : 0;
      const m = e.label.material as THREE.SpriteMaterial;
      m.opacity += (labelTarget - m.opacity) * Math.min(dt * 10, 1);
    }
  }
}
