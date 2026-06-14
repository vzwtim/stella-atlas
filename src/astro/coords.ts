import * as THREE from "three";

/** 赤経(時)・赤緯(度) → 単位方向ベクトル（y軸=天の北極） */
export function raDecToDir(
  raHours: number,
  decDeg: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const ra = (raHours / 24) * Math.PI * 2;
  const dec = (decDeg / 180) * Math.PI;
  const cd = Math.cos(dec);
  // RAが増える向きが天球内側から見て東向きになるよう -z 側にとる
  out.set(cd * Math.cos(ra), Math.sin(dec), -cd * Math.sin(ra));
  return out;
}

/** 銀経・銀緯(rad) → 赤道座標方向ベクトル (J2000) */
export function galacticToDir(
  l: number,
  b: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  // J2000: 北銀極 RA=192.8595°, Dec=27.1284°, 銀経原点の位置角 122.932°
  const raGP = (192.85948 * Math.PI) / 180;
  const decGP = (27.12825 * Math.PI) / 180;
  const lCP = (122.932 * Math.PI) / 180;

  const sinB = Math.sin(b);
  const cosB = Math.cos(b);
  const sinDec =
    sinB * Math.sin(decGP) + cosB * Math.cos(decGP) * Math.cos(lCP - l);
  const dec = Math.asin(THREE.MathUtils.clamp(sinDec, -1, 1));
  const y = cosB * Math.sin(lCP - l);
  const x = sinB * Math.cos(decGP) - cosB * Math.sin(decGP) * Math.cos(lCP - l);
  const ra = raGP + Math.atan2(y, x);

  const cd = Math.cos(dec);
  out.set(cd * Math.cos(ra), Math.sin(dec), -cd * Math.sin(ra));
  return out;
}

/** B-V色指数 → 近似RGB（黒体放射近似） */
export function bvToRGB(bv: number): [number, number, number] {
  const t = THREE.MathUtils.clamp(bv, -0.4, 2.0);
  let r = 1,
    g = 1,
    b = 1;

  if (t < 0.0) {
    const u = (t + 0.4) / 0.4;
    r = 0.61 + 0.11 * u + 0.1 * u * u;
    g = 0.7 + 0.07 * u + 0.1 * u * u;
    b = 1.0;
  } else if (t < 0.4) {
    const u = t / 0.4;
    r = 0.83 + 0.17 * u;
    g = 0.87 + 0.11 * u;
    b = 1.0;
  } else if (t < 1.6) {
    const u = (t - 0.4) / 1.2;
    r = 1.0;
    g = 0.98 - 0.16 * u;
    b = 1.0 - 0.47 * u;
  } else {
    const u = (t - 1.6) / 0.4;
    r = 1.0;
    g = 0.82 - 0.5 * u * u;
    b = 0.53 - 0.53 * u;
  }
  return [r, g, Math.max(b, 0)];
}

/** B-V → 有効温度(K) Ballesteros近似 */
export function bvToTempK(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

export const SKY_RADIUS = 1000;
