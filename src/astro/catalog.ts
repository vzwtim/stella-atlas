import * as THREE from "three";
import { raDecToDir } from "./coords";

export interface Star {
  index: number;
  hip: number;
  ra: number; // hours
  dec: number; // degrees
  dist: number; // parsecs (0 = 不明)
  mag: number;
  ci: number; // B-V
  spect: string;
  proper: string;
  bayer: string;
  con: string;
  dir: THREE.Vector3; // 単位方向
}

export interface ConstellationDef {
  abbr: string;
  name: string; // 学名 (Latin)
  lines: number[][]; // HIP番号のポリライン
}

export interface Catalog {
  stars: Star[];
  byHip: Map<number, Star>;
  constellations: ConstellationDef[];
}

type RawStar = [
  number,
  number,
  number,
  number,
  number,
  number,
  string,
  string,
  string,
  string,
];

export async function loadCatalog(
  onProgress?: (label: string) => void,
): Promise<Catalog> {
  onProgress?.("恒星カタログを読み込み中…");
  const base = import.meta.env.BASE_URL;
  const [starsRes, consRes] = await Promise.all([
    fetch(`${base}data/stars.json`),
    fetch(`${base}data/constellations.json`),
  ]);
  if (!starsRes.ok || !consRes.ok)
    throw new Error("データの読み込みに失敗しました");

  const starsJson = (await starsRes.json()) as { stars: RawStar[] };
  const constellations = (await consRes.json()) as ConstellationDef[];

  onProgress?.("天球を構築中…");
  const stars: Star[] = starsJson.stars.map((s, index) => ({
    index,
    hip: s[0],
    ra: s[1],
    dec: s[2],
    dist: s[3],
    mag: s[4],
    ci: s[5],
    spect: s[6],
    proper: s[7],
    bayer: s[8],
    con: s[9],
    dir: raDecToDir(s[1], s[2]),
  }));

  const byHip = new Map<number, Star>();
  for (const s of stars) if (s.hip) byHip.set(s.hip, s);

  return { stars, byHip, constellations };
}
