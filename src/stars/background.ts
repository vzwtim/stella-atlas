import * as THREE from "three";
import { SKY_RADIUS } from "../astro/coords";

const BGVERT = /* glsl */ `
uniform float uPixelRatio;
uniform float uFovScale;
void main() {
  gl_PointSize = 1.6 * uPixelRatio * uFovScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BGFRAG = /* glsl */ `
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  gl_FragColor = vec4(0.90, 0.93, 1.0, (1.0 - d) * 0.72);
}
`;

export function createBackgroundStars(count = 80000): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = SKY_RADIUS * 0.983;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: BGVERT,
    fragmentShader: BGFRAG,
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uFovScale: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 1;
  return points;
}

export function updateBackgroundFov(
  points: THREE.Points,
  camera: THREE.PerspectiveCamera,
) {
  const mat = points.material as THREE.ShaderMaterial;
  mat.uniforms.uFovScale.value =
    Math.tan((55 * Math.PI) / 360) / Math.tan((camera.fov * Math.PI) / 360);
}
