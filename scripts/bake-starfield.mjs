// bake-starfield.mjs — v0.1.0
//
// Produces moonlander/assets/starfield.json — the bright-star catalog
// rendered in OrbitMode's 3D sky. Sourced from the Yale Bright Star
// Catalog (BSC5) via brettonw/YaleBrightStarCatalog on GitHub. The
// public-domain catalog contains ~9,000 stars to apparent magnitude
// ~6.5, the naked-eye limit.
//
// Output format (compact JSON; ~150 KB for ~5,500 stars to mag 6):
//   [
//     [ra_deg, dec_deg, mag, color_temp_k],   // brightest first
//     ...
//   ]
// (RA / Dec in decimal degrees, J2000 equatorial; mag is apparent V;
//  K is surface temperature in kelvin or null if unknown.)
//
// Run:
//   cd scripts
//   node bake-starfield.mjs

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const OUT_PATH = resolve(REPO_ROOT, 'moonlander/assets/starfield.json');

const SOURCE_URL =
  'https://raw.githubusercontent.com/brettonw/YaleBrightStarCatalog/master/bsc5-short.json';

// Magnitude cutoff. The naked-eye limit under perfectly dark skies is
// ~6.5; stars fainter than that aren't useful in our viewer because
// they fall below the sub-pixel size threshold and produce visual noise
// without recognisable constellation patterns.
const MAG_CUTOFF = 6.0;

/**
 * Parse "00h 05m 09.9s" → 1.290° (RA in decimal degrees).
 * 24 hours = 360°, so an hour is 15°.
 */
function parseRA(s) {
  const m = /^([\-+]?\d+)h\s*([\d.]+)m\s*([\d.]+)s/.exec(s);
  if (!m) return null;
  const h = parseFloat(m[1]);
  const min = parseFloat(m[2]);
  const sec = parseFloat(m[3]);
  return (h + min / 60 + sec / 3600) * 15;
}

/**
 * Parse "+45° 13′ 45″" → +45.229° (Dec in decimal degrees).
 * Handles both ASCII and Unicode prime/double-prime characters.
 */
function parseDec(s) {
  const m = /^([\-+]?\d+)°\s*([\d.]+)['′]\s*([\d.]+)["″]/.exec(s);
  if (!m) return null;
  const sign = s.trim().startsWith('-') ? -1 : 1;
  const d = Math.abs(parseFloat(m[1]));
  const mm = parseFloat(m[2]);
  const ss = parseFloat(m[3]);
  return sign * (d + mm / 60 + ss / 3600);
}

async function main() {
  console.log(`Fetching ${SOURCE_URL} …`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    console.error(`HTTP ${res.status}`);
    process.exit(1);
  }
  const raw = await res.json();
  console.log(`✅ Fetched ${raw.length} catalog entries`);

  const stars = [];
  let skipped = 0;
  for (const row of raw) {
    const mag = parseFloat(row.V);
    if (!Number.isFinite(mag) || mag > MAG_CUTOFF) { skipped++; continue; }
    const ra = parseRA(row.RA);
    const dec = parseDec(row.Dec);
    if (ra == null || dec == null) { skipped++; continue; }
    const k = parseFloat(row.K);
    stars.push([
      Math.round(ra * 1000) / 1000,                // 0.001° resolution (~3.6 arcsec)
      Math.round(dec * 1000) / 1000,
      Math.round(mag * 100) / 100,                 // 0.01 mag resolution
      Number.isFinite(k) ? Math.round(k) : null,   // kelvin, integer; null when unknown
    ]);
  }

  // Sort brightest-first so the first slice fits the brightest-stars
  // bucket without re-scanning at runtime.
  stars.sort((a, b) => a[2] - b[2]);

  await mkdir(dirname(OUT_PATH), { recursive: true });
  // Compact JSON: array of arrays, one star per line for diff-friendliness.
  const lines = stars.map(s => '  ' + JSON.stringify(s));
  const out = '[\n' + lines.join(',\n') + '\n]\n';
  await writeFile(OUT_PATH, out);
  const sizeKB = Math.round(out.length / 1024);
  console.log(`✅ Wrote ${OUT_PATH}`);
  console.log(`   ${stars.length} stars (skipped ${skipped} faint/unparseable), ${sizeKB} KB`);
  // Brightest-star sanity check (Sirius is mag −1.46, RA 06h 45m 09s).
  console.log(`   Brightest: mag=${stars[0][2]} at RA=${stars[0][0]}° Dec=${stars[0][1]}°`);
}

main().catch((err) => {
  console.error('❌', err.stack || err.message || err);
  process.exit(1);
});
