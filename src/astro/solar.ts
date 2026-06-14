import * as THREE from "three";
import { raDecToDir } from "./coords";

/** 現在時刻のユリウス日 */
export function getJD(d: Date = new Date()): number {
  return d.getTime() / 86400000 + 2440587.5;
}

/** 太陽の赤経(度)・赤緯(度) — Meeus簡略版 */
export function sunRaDec(jd: number): { raDeg: number; decDeg: number } {
  const T = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + 36000.76983 * T) % 360;
  const Mrad = ((357.52911 + 35999.05029 * T) % 360) * (Math.PI / 180);
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad) +
    0.000289 * Math.sin(3 * Mrad);
  const sunLon = ((L0 + C) % 360) * (Math.PI / 180);
  const eps = (23.439291 - 0.013004 * T) * (Math.PI / 180);

  const raDeg =
    (Math.atan2(Math.cos(eps) * Math.sin(sunLon), Math.cos(sunLon)) * 180) /
    Math.PI;
  const decDeg = (Math.asin(Math.sin(eps) * Math.sin(sunLon)) * 180) / Math.PI;
  return { raDeg: (raDeg + 360) % 360, decDeg };
}

/** 月の赤経(度)・赤緯(度) — 簡略版 (≈1° 精度) */
export function moonRaDec(jd: number): { raDeg: number; decDeg: number } {
  const d = jd - 2451545.0;
  const T = d / 36525;
  const Lm = ((218.316 + 13.176396 * d) % 360) * (Math.PI / 180);
  const M = ((134.963 + 13.064993 * d) % 360) * (Math.PI / 180);
  const F = ((93.272 + 13.22935 * d) % 360) * (Math.PI / 180);
  const Dm = ((297.85 + 12.19075 * d) % 360) * (Math.PI / 180);
  const Ms = ((357.52911 + 35999.05029 * T) % 360) * (Math.PI / 180);

  const lon =
    Lm +
    (6.289 * Math.sin(M) +
      1.274 * Math.sin(2 * Dm - M) +
      0.658 * Math.sin(2 * Dm) -
      0.186 * Math.sin(Ms) -
      0.059 * Math.sin(2 * M) -
      0.057 * Math.sin(2 * Dm - 2 * M) +
      0.053 * Math.sin(2 * Dm + M)) *
      (Math.PI / 180);
  const lat =
    (5.128 * Math.sin(F) +
      0.28 * Math.sin(M + F) -
      0.279 * Math.sin(M - F) -
      0.173 * Math.sin(2 * Dm - F)) *
    (Math.PI / 180);

  const eps = (23.439291 - 0.013004 * T) * (Math.PI / 180);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);

  const raDeg =
    (Math.atan2(
      Math.sin(lon) * Math.cos(eps) - Math.tan(lat) * Math.sin(eps),
      Math.cos(lon),
    ) *
      180) /
    Math.PI;
  const decDeg =
    (Math.asin(
      THREE.MathUtils.clamp(
        sinLat * Math.cos(eps) + cosLat * Math.sin(eps) * Math.sin(lon),
        -1,
        1,
      ),
    ) *
      180) /
    Math.PI;
  return { raDeg: (raDeg + 360) % 360, decDeg };
}

/**
 * 観測者の地方恒星時(ラジアン)。
 * longitude: 東経(度)、デフォルトは東京(139.69°)。
 */
export function localSiderealTime(jd: number, lonDeg = 139.69): number {
  const T = (jd - 2451545.0) / 36525;
  // グリニッジ視恒星時(度)
  const gst =
    280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T;
  return (((gst + lonDeg) % 360) * Math.PI) / 180;
}

/** 地平座標(高度・方位角) → 単位方向ベクトル */
export function altAzToDir(
  altDeg: number,
  azDeg: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const alt = (altDeg * Math.PI) / 180;
  const az = (azDeg * Math.PI) / 180;
  // 高度→y、方位角は北=0で時計回り
  const cosAlt = Math.cos(alt);
  // 北=-Z, 東=+X, 南=+Z, 西=-X に合わせた変換
  out.set(cosAlt * Math.sin(az), Math.sin(alt), -cosAlt * Math.cos(az));
  return out;
}

/**
 * 赤道座標(RA/Dec 度) → 地平座標(高度・方位角 度)。
 * lat: 観測地の北緯(度)、lst: 地方恒星時(rad)
 */
export function equatorialToHorizontal(
  raDeg: number,
  decDeg: number,
  latDeg: number,
  lstRad: number,
): { altDeg: number; azDeg: number } {
  const ha = lstRad - (raDeg * Math.PI) / 180; // 時角(rad)
  const dec = (decDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;

  const sinAlt =
    Math.sin(dec) * Math.sin(lat) +
    Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const altRad = Math.asin(THREE.MathUtils.clamp(sinAlt, -1, 1));

  const cosAz =
    (Math.sin(dec) - Math.sin(altRad) * Math.sin(lat)) /
    (Math.cos(altRad) * Math.cos(lat) + 1e-9);
  let azRad = Math.acos(THREE.MathUtils.clamp(cosAz, -1, 1));
  if (Math.sin(ha) > 0) azRad = 2 * Math.PI - azRad;

  return {
    altDeg: (altRad * 180) / Math.PI,
    azDeg: (azRad * 180) / Math.PI,
  };
}

/** 赤経(度) → 天球上の方向ベクトル(skyGroup座標系) */
export function raDegDecDegToDir(raDeg: number, decDeg: number): THREE.Vector3 {
  return raDecToDir(raDeg / 15, decDeg);
}

/** 太陽・月の位置を地平座標に変換（観測地: 東京 35.69°N, 139.69°E） */
export interface CelestialBody {
  dir: THREE.Vector3;
  altDeg: number;
  azDeg: number;
  aboveHorizon: boolean;
}

export function getSunPosition(jd: number): CelestialBody {
  const { raDeg, decDeg } = sunRaDec(jd);
  const lst = localSiderealTime(jd);
  const { altDeg, azDeg } = equatorialToHorizontal(raDeg, decDeg, 35.69, lst);
  const dir = raDegDecDegToDir(raDeg, decDeg);
  return { dir, altDeg, azDeg, aboveHorizon: altDeg > -0.83 };
}

export function getMoonPosition(jd: number): CelestialBody {
  const { raDeg, decDeg } = moonRaDec(jd);
  const lst = localSiderealTime(jd);
  const { altDeg, azDeg } = equatorialToHorizontal(raDeg, decDeg, 35.69, lst);
  const dir = raDegDecDegToDir(raDeg, decDeg);
  return { dir, altDeg, azDeg, aboveHorizon: altDeg > -0.83 };
}
