import * as THREE from "three";
import { galacticToDir, SKY_RADIUS } from "../astro/coords";

const VERT = /* glsl */ `
uniform float uPixelRatio;
uniform float uFovScale;
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio * uFovScale;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(p, p);
  if (d2 > 1.0) discard;
  float i = exp(-d2 * 4.0) * vAlpha;
  gl_FragColor = vec4(vColor * i, i);
}
`;

function gaussian(): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 銀河面に沿った粒子で天の川を再現する。
 * 微小星 + 大きなヘイズ粒子の2層構成。バルジは銀河中心（いて座方向）に寄せる。
 */
export function createMilkyWay(): THREE.Points {
  const N_STARS = 52000;
  const N_HAZE = 2600;
  const N_BULGE = 9000;
  const n = N_STARS + N_HAZE + N_BULGE;

  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const alphas = new Float32Array(n);

  const dir = new THREE.Vector3();
  const R = SKY_RADIUS * 1.7;
  let idx = 0;

  const put = (
    l: number,
    b: number,
    size: number,
    alpha: number,
    r: number,
    g: number,
    bl: number,
  ) => {
    galacticToDir(l, b, dir).multiplyScalar(R);
    positions[idx * 3] = dir.x;
    positions[idx * 3 + 1] = dir.y;
    positions[idx * 3 + 2] = dir.z;
    colors[idx * 3] = r;
    colors[idx * 3 + 1] = g;
    colors[idx * 3 + 2] = bl;
    sizes[idx] = size;
    alphas[idx] = alpha;
    idx++;
  };

  // 微小星: 銀緯方向ガウス分布。銀経により濃淡（中心方向が濃い）
  for (let i = 0; i < N_STARS; i++) {
    const l = Math.random() * Math.PI * 2;
    const centerBoost = 0.5 + 0.5 * Math.cos(l); // l=0 (銀河中心) が濃い
    const sigma = THREE.MathUtils.degToRad(4.5 + 5 * centerBoost);
    const b = gaussian() * sigma;
    const warm = Math.random() * 0.25;
    put(
      l,
      b,
      0.8 + Math.random() * 1.8,
      0.16 + Math.random() * 0.24 * (0.5 + centerBoost),
      1.0,
      0.93 - warm * 0.15,
      0.82 - warm * 0.3,
    );
  }

  // ヘイズ: 大きく淡い光斑で雲のような質感を出す
  for (let i = 0; i < N_HAZE; i++) {
    const l = Math.random() * Math.PI * 2;
    const centerBoost = 0.5 + 0.5 * Math.cos(l);
    const sigma = THREE.MathUtils.degToRad(3.5 + 4.5 * centerBoost);
    const b = gaussian() * sigma;
    const blue = Math.random() * 0.3;
    put(
      l,
      b,
      30 + Math.random() * 80,
      0.02 + Math.random() * 0.032 * (0.4 + centerBoost),
      0.85 + blue * 0.1,
      0.88,
      0.95 + blue * 0.05,
    );
  }

  // バルジ: 銀河中心の膨らみ（やや黄色味）
  for (let i = 0; i < N_BULGE; i++) {
    const l = gaussian() * THREE.MathUtils.degToRad(16);
    const b = gaussian() * THREE.MathUtils.degToRad(9);
    put(
      l,
      b,
      1.0 + Math.random() * 3.0,
      0.12 + Math.random() * 0.26,
      1.0,
      0.88,
      0.7,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uFovScale: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 0;
  return points;
}

export function updateMilkyWayFov(
  points: THREE.Points,
  camera: THREE.PerspectiveCamera,
) {
  const mat = points.material as THREE.ShaderMaterial;
  mat.uniforms.uFovScale.value =
    Math.tan((55 * Math.PI) / 360) / Math.tan((camera.fov * Math.PI) / 360);
}
