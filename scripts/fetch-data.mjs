// Converts raw HYG catalog + Stellarium modern skyculture into compact JSON
// used by the app. Raw files are downloaded once into public/data/_*.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const HYG_URL =
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';
const SKY_URL =
  'https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern/index.json';

const RAW_HYG = '.cache/_hyg_raw.csv';
const RAW_SKY = '.cache/_modern_raw.json';

for (const [path, url] of [[RAW_HYG, HYG_URL], [RAW_SKY, SKY_URL]]) {
  if (!existsSync(path)) {
    console.log(`downloading ${url}`);
    execSync(`curl -sL --retry 3 -o ${path} ${url}`, { stdio: 'inherit' });
  }
}

// --- constellations ---
const sky = JSON.parse(readFileSync(RAW_SKY, 'utf8'));
const constellations = sky.constellations.map((c) => ({
  abbr: c.id.split(' ').pop(),
  name: c.common_name?.native ?? c.common_name?.english ?? c.id,
  lines: c.lines,
}));
const lineHips = new Set(constellations.flatMap((c) => c.lines.flat()));

// --- stars ---
// CSV has no quoted commas in the fields we use except "proper"-adjacent ones;
// parse with a small state machine to be safe.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const csv = readFileSync(RAW_HYG, 'utf8').split('\n');
const header = parseCsvLine(csv[0].replace(/\r$/, ''));
const col = Object.fromEntries(header.map((h, i) => [h, i]));

const MAG_LIMIT = 6.5;
const stars = [];
const seenHip = new Set();
for (let i = 1; i < csv.length; i++) {
  const line = csv[i];
  if (!line || line.length < 5) continue;
  const f = parseCsvLine(line.replace(/\r$/, ''));
  const id = f[col.id];
  if (id === '0') continue; // Sol
  const hip = f[col.hip] ? parseInt(f[col.hip], 10) : 0;
  const mag = parseFloat(f[col.mag]);
  if (Number.isNaN(mag)) continue;
  const needed = hip && lineHips.has(hip);
  if (mag > MAG_LIMIT && !needed) continue;
  if (hip && seenHip.has(hip)) continue;
  if (hip) seenHip.add(hip);

  const ra = parseFloat(f[col.ra]); // hours
  const dec = parseFloat(f[col.dec]); // degrees
  let dist = parseFloat(f[col.dist]); // parsecs, 100000 = unknown
  if (dist >= 100000) dist = 0;
  const ci = f[col.ci] ? parseFloat(f[col.ci]) : 0.5;
  stars.push([
    hip,
    +ra.toFixed(5),
    +dec.toFixed(4),
    +dist.toFixed(2),
    +mag.toFixed(2),
    +(Number.isNaN(ci) ? 0.5 : ci).toFixed(3),
    f[col.spect] || '',
    f[col.proper] || '',
    f[col.bayer] || '',
    f[col.con] || '',
  ]);
}

// brightest first so picking can prefer bright stars cheaply
stars.sort((a, b) => a[4] - b[4]);

const missing = [...lineHips].filter((h) => !seenHip.has(h));
console.log(`stars: ${stars.length}, constellations: ${constellations.length}`);
if (missing.length) console.warn(`line HIPs missing from catalog: ${missing.length}`, missing.slice(0, 10));

writeFileSync('public/data/stars.json', JSON.stringify({ fields: ['hip', 'ra', 'dec', 'dist', 'mag', 'ci', 'spect', 'proper', 'bayer', 'con'], stars }));
writeFileSync('public/data/constellations.json', JSON.stringify(constellations));
console.log('wrote public/data/stars.json, public/data/constellations.json');
