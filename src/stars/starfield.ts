import * as THREE from "three";
import type { Catalog, Star } from "../astro/catalog";
import { bvToRGB, SKY_RADIUS } from "../astro/coords";

const VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uFovScale;
attribute float aMag;
attribute float aSeed;
attribute vec3 aColor;
varying vec3 vColor;
varying float vMag;
varying float vTwinkle;

void main() {
  vMag = aMag;
  vColor = aColor;

  float size = 7.0 * pow(10.0, -0.09 * aMag);
  size = clamp(size, 1.5, 11.0);

  // 暗い星ほど瞬きが強い（大気のシンチレーション風）
  float tw1 = sin(uTime * (1.5 + aSeed * 4.0) + aSeed * 628.3);
  float tw2 = sin(uTime * (3.7 + aSeed * 2.1) + aSeed * 314.1) * 0.5;
  float tw3 = sin(uTime * (0.8 + aSeed * 6.5) + aSeed * 942.5) * 0.3;
  float twAmp = smoothstep(-1.0, 5.0, aMag) * 0.35;
  vTwinkle = 1.0 + (tw1 + tw2 + tw3) * twAmp;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uPixelRatio * uFovScale;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vMag;
varying float vTwinkle;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;

  // 完全ガウシアン: 自然に円形になり四角アーティファクトなし
  float core = exp(-d * d * 10.0);
  float halo = exp(-d * d * 1.8) * 0.28;
  float edge = smoothstep(1.0, 0.75, d);
  float i = (core + halo) * edge;

  // 等級に応じた自然な輝度フォールオフ（background.tsが暗い星密度を担う）
  float lum = pow(10.0, -0.20 * vMag) * 3.5;
  i *= clamp(lum, 0.0, 5.0) * vTwinkle;

  gl_FragColor = vec4(vColor * i, i);
}
`;

export class Starfield {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private projected = new THREE.Vector3();

  constructor(private catalog: Catalog) {
    const n = catalog.stars.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const mags = new Float32Array(n);
    const seeds = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const s = catalog.stars[i];
      positions[i * 3] = s.dir.x * SKY_RADIUS;
      positions[i * 3 + 1] = s.dir.y * SKY_RADIUS;
      positions[i * 3 + 2] = s.dir.z * SKY_RADIUS;
      const [r, g, b] = bvToRGB(s.ci);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      mags[i] = s.mag;
      seeds[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aMag", new THREE.BufferAttribute(mags, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uFovScale: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  update(time: number, camera: THREE.PerspectiveCamera) {
    this.material.uniforms.uTime.value = time;
    // ズームインしても星の見かけサイズが保たれるよう補正
    this.material.uniforms.uFovScale.value =
      Math.tan((55 * Math.PI) / 360) / Math.tan((camera.fov * Math.PI) / 360);
  }

  /**
   * スクリーン座標に最も近い星を返す（CPU総当たり。9千個なので十分速い）。
   * 明るい星ほど拾いやすいよう等級でスコアを補正する。
   */
  pick(
    ndcX: number,
    ndcY: number,
    camera: THREE.PerspectiveCamera,
    skyQuaternion: THREE.Quaternion,
    maxPixels = 24,
  ): Star | null {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const viewDir = new THREE.Vector3();
    camera.getWorldDirection(viewDir);

    let best: Star | null = null;
    let bestScore = Infinity;
    const v = this.projected;

    for (const s of this.catalog.stars) {
      v.copy(s.dir).applyQuaternion(skyQuaternion);
      if (v.dot(viewDir) < 0.3) continue; // 視野の反対側はスキップ
      v.multiplyScalar(SKY_RADIUS).project(camera);
      if (v.z > 1) continue;
      const dx = ((v.x - ndcX) * w) / 2;
      const dy = ((v.y - ndcY) * h) / 2;
      const px = Math.sqrt(dx * dx + dy * dy);
      if (px > maxPixels) continue;
      const score = px + s.mag * 2.5; // 明るい星を優先
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }
}
