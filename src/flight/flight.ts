import * as THREE from "three";
import type { Star } from "../astro/catalog";
import { bvToRGB, bvToTempK, SKY_RADIUS } from "../astro/coords";

// 3D simplex noise (Ashima Arts / Ian McEwan, MIT)
const NOISE = /* glsl */ `
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p) {
  float f = 0.0;
  f += 0.5000 * snoise(p);
  f += 0.2500 * snoise(p * 2.01);
  f += 0.1250 * snoise(p * 4.02);
  f += 0.0625 * snoise(p * 8.05);
  return f;
}
`;

const SURFACE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vPos;
varying vec3 vView;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const SURFACE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uActivity;
varying vec3 vNormal;
varying vec3 vPos;
varying vec3 vView;
${NOISE}
void main() {
  vec3 p = normalize(vPos);

  // 粒状斑（granulation）: ゆっくり対流するノイズ
  float g1 = fbm(p * 7.0 + vec3(uTime * 0.05));
  float g2 = fbm(p * 18.0 - vec3(uTime * 0.085));
  float gran = 0.78 + 0.32 * g1 + 0.18 * g2;

  // 暗い斑点（黒点）
  float spots = smoothstep(0.42, 0.7, fbm(p * 3.4 + vec3(7.7, uTime * 0.012, 0.0)));
  gran *= 1.0 - spots * 0.55 * uActivity;

  // 明るいフレア領域
  float flare = smoothstep(0.55, 0.9, fbm(p * 5.0 - vec3(uTime * 0.03, 3.1, 0.0)));
  gran += flare * 0.45 * uActivity;

  // 周縁減光（limb darkening）
  float mu = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
  float limb = 0.35 + 0.65 * pow(mu, 0.62);

  vec3 col = uColor * gran * limb * 0.85;
  // 縁のごく薄い彩層の輝き
  col += uColor * pow(1.0 - mu, 3.0) * 0.35;

  gl_FragColor = vec4(col, 1.0);
}
`;

const CORONA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CORONA_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
${NOISE}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float ang = atan(vUv.y, vUv.x);

  // 角度方向に流れるストリーマ
  float streaks = fbm(vec3(cos(ang) * 2.2, sin(ang) * 2.2, r * 3.0 - uTime * 0.1));
  float falloff = exp(-(r - 0.25) * 4.5);
  float i = max(falloff * (0.55 + 0.45 * streaks), 0.0);
  i *= smoothstep(1.0, 0.6, r);
  i *= smoothstep(0.18, 0.30, r); // 本体と重なる中心部は抑える

  gl_FragColor = vec4(uColor * i * 0.55, i * 0.7);
}
`;

export type FlightPhase = "idle" | "outbound" | "arrived" | "returning";

export interface FlightTarget {
  star: Star;
  tempK: number;
}

/**
 * 星クリック → 恒星への没入フライト。
 * 恒星メッシュは星の方向の天球内側付近に生成し、カメラがそこへ飛ぶ。
 * （星間の実距離は情報として表示し、空間スケールは演出として圧縮する）
 */
export class Flight {
  phase: FlightPhase = "idle";
  current: FlightTarget | null = null;
  onArrive?: (t: FlightTarget) => void;
  onReturn?: () => void;

  private group = new THREE.Group();
  private surface: THREE.Mesh | null = null;
  private corona: THREE.Mesh | null = null;
  private surfaceMat: THREE.ShaderMaterial | null = null;
  private coronaMat: THREE.ShaderMaterial | null = null;

  private t = 0;
  private duration = 4.2;
  private fromPos = new THREE.Vector3();
  private toPos = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  private starWorldPos = new THREE.Vector3();
  private fromQuat = new THREE.Quaternion();
  private fovFrom = 55;
  private fovTo = 55;

  constructor(
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private skyGroup: THREE.Group,
  ) {
    scene.add(this.group);
  }

  get busy(): boolean {
    return this.phase === "outbound" || this.phase === "returning";
  }

  start(star: Star) {
    if (this.busy) return;
    this.disposeMeshes();

    const tempK = bvToTempK(star.ci);
    this.current = { star, tempK };

    const [r, g, b] = bvToRGB(star.ci);
    const color = new THREE.Color(r, g, b);

    // 高温星ほど活動的な表面の変化を抑え、低温星は黒点・フレアを強める
    const activity = THREE.MathUtils.clamp((7000 - tempK) / 4500, 0.25, 1.0);

    const radius = 4;
    this.surfaceMat = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: color },
        uActivity: { value: activity },
      },
    });
    this.surface = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 96, 96),
      this.surfaceMat,
    );

    this.coronaMat = new THREE.ShaderMaterial({
      vertexShader: CORONA_VERT,
      fragmentShader: CORONA_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: color },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.corona = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 7, radius * 7),
      this.coronaMat,
    );

    // 星の方向、天球のやや内側に配置（skyGroupの回転を反映）
    this.starWorldPos
      .copy(star.dir)
      .applyQuaternion(this.skyGroup.quaternion)
      .multiplyScalar(SKY_RADIUS * 0.93);
    this.surface.position.copy(this.starWorldPos);
    this.corona.position.copy(this.starWorldPos);
    this.group.add(this.surface);
    this.group.add(this.corona);

    // カメラ終点: 恒星の手前
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    const offsetDir = this.starWorldPos.clone().normalize();
    this.toPos.copy(this.starWorldPos).addScaledVector(offsetDir, -radius * 18);
    this.lookTarget.copy(this.starWorldPos);

    this.fovFrom = this.camera.fov;
    this.fovTo = 32;
    this.t = 0;
    this.duration = 4.5;
    this.phase = "outbound";
  }

  returnHome() {
    if (this.phase !== "arrived") return;
    this.fromPos.copy(this.camera.position);
    this.toPos.set(0, 0, 0.001);
    this.fovFrom = this.camera.fov;
    this.fovTo = 55;
    this.t = 0;
    this.duration = 3.2;
    this.phase = "returning";
  }

  private disposeMeshes() {
    for (const m of [this.surface, this.corona]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.surface = null;
    this.corona = null;
    this.surfaceMat = null;
    this.coronaMat = null;
  }

  update(dt: number, time: number) {
    if (this.surfaceMat) this.surfaceMat.uniforms.uTime.value = time;
    if (this.coronaMat) {
      this.coronaMat.uniforms.uTime.value = time;
      this.corona!.lookAt(this.camera.position);
    }

    if (this.phase === "outbound" || this.phase === "returning") {
      this.t += dt;
      const u = Math.min(this.t / this.duration, 1);
      // easeInOutQuint: 序盤ゆっくり→中盤加速→終盤減速で「飛んでいる」感を出す
      const e = u < 0.5 ? 16 * u ** 5 : 1 - Math.pow(-2 * u + 2, 5) / 2;
      this.camera.position.lerpVectors(this.fromPos, this.toPos, e);

      // FOV zoom: outbound → fovTo=32, returning → fovTo=55
      this.camera.fov = this.fovFrom + (this.fovTo - this.fovFrom) * e;
      this.camera.updateProjectionMatrix();

      if (this.phase === "outbound") {
        // 視線を徐々に恒星へ向ける
        const lookQuat = new THREE.Quaternion();
        const m = new THREE.Matrix4().lookAt(
          this.camera.position,
          this.lookTarget,
          new THREE.Vector3(0, 1, 0),
        );
        lookQuat.setFromRotationMatrix(m);
        this.camera.quaternion.slerpQuaternions(
          this.fromQuat,
          lookQuat,
          Math.min(u * 1.6, 1),
        );
      } else {
        this.camera.lookAt(this.lookTarget);
      }

      if (u >= 1) {
        if (this.phase === "outbound") {
          this.phase = "arrived";
          if (this.current) this.onArrive?.(this.current);
        } else {
          this.phase = "idle";
          this.disposeMeshes();
          this.current = null;
          this.onReturn?.();
        }
      }
    }
  }
}
