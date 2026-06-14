import * as THREE from "three";
import { SKY_RADIUS } from "../astro/coords";
import {
  getJD,
  getSunPosition,
  getMoonPosition,
  altAzToDir,
} from "../astro/solar";

const SUN_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  // 光球本体
  float core = 1.0 - smoothstep(0.0, 0.48, r);
  // コロナ・ハロー
  float corona = exp(-r * 2.8) * 0.9;
  float flicker = 1.0 + 0.04 * sin(uTime * 7.3 + r * 15.0);
  float i = (core + corona) * flicker;
  vec3 col = mix(vec3(1.0, 0.85, 0.4), vec3(1.0, 0.5, 0.1), smoothstep(0.0, 0.55, r));
  gl_FragColor = vec4(col * i, i);
}
`;

const MOON_FRAG = /* glsl */ `
uniform vec3 uSunDir;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  // 月面（半球の明暗）
  vec3 n = vec3(vUv, sqrt(max(0.0, 1.0 - dot(vUv, vUv))));
  float diff = max(dot(n, normalize(uSunDir + vec3(0.0, 0.0, 1.0))), 0.08);
  // クレーターっぽいノイズ（簡易）
  float noise = fract(sin(dot(floor(vUv * 18.0), vec2(12.9898, 78.233))) * 43758.5);
  float crater = 1.0 - noise * 0.08;
  float i = diff * crater * (1.0 - smoothstep(0.85, 1.0, r));
  vec3 col = vec3(0.82, 0.82, 0.78);
  gl_FragColor = vec4(col * i, i);
}
`;

const VERT_UV = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** 天体表示+地平線グロー+コンパスラベル */
export class HorizonScene {
  readonly group = new THREE.Group(); // 地平線・コンパス（scene直下）
  readonly skyBody: THREE.Group; // 太陽・月（skyGroup直下）

  private sunPlane: THREE.Mesh;
  private moonPlane: THREE.Mesh;
  private sunMat: THREE.ShaderMaterial;
  private moonMat: THREE.ShaderMaterial;
  private compassSprites: THREE.Sprite[] = [];
  private lastUpdateMs = 0;

  constructor(
    scene: THREE.Scene,
    _skyGroup: THREE.Group,
    private camera: THREE.PerspectiveCamera,
  ) {
    // skyBody は互換性のため保持（sun/moonは水平座標でgroupに直接追加）
    this.skyBody = new THREE.Group();

    this.sunMat = new THREE.ShaderMaterial({
      vertexShader: VERT_UV,
      fragmentShader: SUN_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.sunPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 42),
      this.sunMat,
    );
    this.sunPlane.renderOrder = 5;
    this.group.add(this.sunPlane);

    this.moonMat = new THREE.ShaderMaterial({
      vertexShader: VERT_UV,
      fragmentShader: MOON_FRAG,
      uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.moonPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 22),
      this.moonMat,
    );
    this.moonPlane.renderOrder = 5;
    this.group.add(this.moonPlane);

    this._buildHorizonRing(scene);
    this._buildCompass(scene);

    scene.add(this.group);
  }

  private _buildHorizonRing(_scene: THREE.Scene) {
    // 地平面グロー: y=0 の大きなリング
    const geoRing = new THREE.RingGeometry(
      SKY_RADIUS * 0.01,
      SKY_RADIUS * 1.05,
      128,
    );
    const matRing = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          float r = length(vUv * 2.0 - 1.0);
          float edge = smoothstep(0.90, 1.0, r);
          float glow = exp(-pow((r - 1.0) * 12.0, 2.0));
          float alpha = (edge * 0.18 + glow * 0.08) * (1.0 - smoothstep(0.65, 1.0, r) * 0.5);
          vec3 col = mix(vec3(0.1, 0.35, 0.9), vec3(0.2, 0.7, 1.0), edge);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geoRing, matRing);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 1;
    this.group.add(ring);

    // 地表グロー（下半球の薄い色）
    const geoAtm = new THREE.SphereGeometry(
      SKY_RADIUS * 0.98,
      64,
      32,
      0,
      Math.PI * 2,
      Math.PI / 2,
      Math.PI / 2,
    );
    const matAtm = new THREE.MeshBasicMaterial({
      color: 0x1122aa,
      transparent: true,
      opacity: 0.04,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.group.add(new THREE.Mesh(geoAtm, matAtm));
  }

  private _buildCompass(_scene: THREE.Scene) {
    const labels = [
      { text: "北 N", x: 0, z: -SKY_RADIUS * 0.98, y: 0 },
      { text: "南 S", x: 0, z: SKY_RADIUS * 0.98, y: 0 },
      { text: "東 E", x: SKY_RADIUS * 0.98, z: 0, y: 0 },
      { text: "西 W", x: -SKY_RADIUS * 0.98, z: 0, y: 0 },
    ];
    for (const l of labels) {
      const sprite = this._makeTextSprite(l.text, 56, "rgba(100,200,255,0.85)");
      sprite.position.set(l.x, 12, l.z);
      sprite.scale.set(90, 45, 1);
      sprite.renderOrder = 4;
      this.group.add(sprite);
      this.compassSprites.push(sprite);
    }
  }

  private _makeTextSprite(
    text: string,
    fontSize: number,
    color: string,
  ): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 128);
    ctx.font = `bold ${fontSize}px 'Hiragino Kaku Gothic ProN', sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(80,160,255,0.7)";
    ctx.shadowBlur = 12;
    ctx.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Sprite(mat);
  }

  update(time: number, simDate: Date = new Date()) {
    this.sunMat.uniforms.uTime.value = time;

    const simMs = simDate.getTime();
    if (Math.abs(simMs - this.lastUpdateMs) > 1000) {
      this.lastUpdateMs = simMs;
      const jd = getJD(simDate);
      const sun = getSunPosition(jd);
      const moon = getMoonPosition(jd);

      const sunDir = altAzToDir(sun.altDeg, sun.azDeg);
      const moonDir = altAzToDir(moon.altDeg, moon.azDeg);
      this.sunPlane.position.copy(sunDir).multiplyScalar(SKY_RADIUS * 0.92);
      this.moonPlane.position.copy(moonDir).multiplyScalar(SKY_RADIUS * 0.92);
      this.sunPlane.visible = sun.altDeg > -3;
      this.moonPlane.visible = moon.altDeg > -3;

      this.moonMat.uniforms.uSunDir.value.copy(sunDir);
    }

    this.sunPlane.lookAt(this.camera.position);
    this.moonPlane.lookAt(this.camera.position);
  }

  getBodyInfo(simDate: Date = new Date()): { sun: string; moon: string } {
    const jd = getJD(simDate);
    const sun = getSunPosition(jd);
    const moon = getMoonPosition(jd);
    const fmt = (b: ReturnType<typeof getSunPosition>, name: string) =>
      `${name} ${b.aboveHorizon ? "▲" : "▽"} 高度${b.altDeg.toFixed(1)}° 方位${b.azDeg.toFixed(1)}°`;
    return {
      sun: fmt(sun, "☀"),
      moon: fmt(moon, "☽"),
    };
  }
}
