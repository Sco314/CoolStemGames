import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fromFile } from 'geotiff';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const RELEASE_OWNER = 'Sco314';
const RELEASE_REPO = 'CoolStemGames';
const RELEASE_TAG = 'assets/ldem-16-uint';
const RELEASE_ASSET_NAME = 'ldem_16_uint.tif';
const TIFF_PATH = resolve(__dirname, 'ldem_16_uint.tif');
const OUT_DIR = resolve(REPO_ROOT, 'moonlander/assets/baked_terrain');

const TIFF_WIDTH = 5760;
const TIFF_HEIGHT = 2880;
const PIXELS_PER_DEG = 16;

// CGI Moon Kit LDEM encoding: pixel value * 0.5 m above 1727.4 km reference.
// Mean lunar surface is at 1737.4 km, so subtract 10000 m to get meters
// above mean surface.
const HEIGHT_SCALE = 0.5;
const HEIGHT_OFFSET = -10000;

const MEAN_LUNAR_RADIUS_M = 1737400;
const METERS_PER_DEG_LAT = (Math.PI * MEAN_LUNAR_RADIUS_M) / 180;

const OUT_SIZE = 65;
const GROUND_EXTENT_M = 1600;

const SITES = [
  { id: 'apollo-11', lat:  0.6741, lon:  23.4733 },
  { id: 'apollo-12', lat: -3.0128, lon: -23.4219 },
  { id: 'apollo-14', lat: -3.6453, lon: -17.4714 },
  { id: 'apollo-15', lat: 26.1322, lon:   3.6339 },
  { id: 'apollo-16', lat: -8.9734, lon:  15.5011 },
  { id: 'apollo-17', lat: 20.1908, lon:  30.7717 },
];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveAssetUrl() {
  // Use the API to look up the asset by name. This endpoint works for both
  // public and private repos, whereas the user-facing /releases/download/...
  // URL returns 404 for private repos even with a valid token.
  const token = process.env.GITHUB_TOKEN;
  const apiHeaders = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const releaseUrl = `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/tags/${RELEASE_TAG}`;
  const rel = await fetch(releaseUrl, { headers: apiHeaders });
  if (!rel.ok) {
    const hint = !token && (rel.status === 404 || rel.status === 403)
      ? ' (private-repo asset? set GITHUB_TOKEN env var with Contents:Read)'
      : '';
    fail(`❌ Release lookup failed: HTTP ${rel.status} ${rel.statusText}${hint}`);
  }
  const release = await rel.json();
  const asset = release.assets?.find((a) => a.name === RELEASE_ASSET_NAME);
  if (!asset) fail(`❌ Asset ${RELEASE_ASSET_NAME} not found on release ${RELEASE_TAG}`);
  return asset.url;
}

async function downloadTiff() {
  const assetUrl = await resolveAssetUrl();
  console.log(`Downloading ${RELEASE_ASSET_NAME} via release API`);
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    Accept: 'application/octet-stream',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(assetUrl, { headers, redirect: 'follow' });
  if (!res.ok) fail(`❌ TIFF download failed: HTTP ${res.status} ${res.statusText}`);

  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let nextPct = 10;

  const reporter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (total > 0) {
        const pct = (received / total) * 100;
        while (pct >= nextPct && nextPct <= 100) {
          console.log(`  ${nextPct}% (${(received / 1e6).toFixed(1)} MB)`);
          nextPct += 10;
        }
      }
      controller.enqueue(chunk);
    },
  });

  const body = res.body.pipeThrough(reporter);
  await pipeline(Readable.fromWeb(body), createWriteStream(TIFF_PATH));

  const { size } = await stat(TIFF_PATH);
  const mb = size / 1e6;
  if (size < 30e6 || size > 35e6) {
    await unlink(TIFF_PATH).catch(() => {});
    fail(`❌ TIFF download invalid (wrong size ${mb.toFixed(1)} MB) — re-run script`);
  }
  console.log(`✅ Downloaded ${mb.toFixed(1)} MB`);
}

function bilinearSample(raster, width, height, x, y) {
  // x,y are floating pixel coordinates. Caller guarantees they're inside
  // [0, width-1] × [0, height-1] (no wrap-around).
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const v00 = raster[y0 * width + x0];
  const v10 = raster[y0 * width + x1];
  const v01 = raster[y1 * width + x0];
  const v11 = raster[y1 * width + x1];
  const top = v00 * (1 - fx) + v10 * fx;
  const bot = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bot * fy;
}

function bakeSite(site, raster) {
  const halfM = GROUND_EXTENT_M / 2;
  // Latitude: meters→degrees is constant.
  const halfDegLat = halfM / METERS_PER_DEG_LAT;
  // Longitude: meters→degrees scales by 1/cos(lat). At Apollo latitudes
  // the cos is well above 0, so no singularity worries.
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((site.lat * Math.PI) / 180);
  const halfDegLon = halfM / metersPerDegLon;

  const latN = site.lat + halfDegLat;
  const latS = site.lat - halfDegLat;
  const lonW = site.lon - halfDegLon;
  const lonE = site.lon + halfDegLon;

  const xMin = (lonW + 180) * PIXELS_PER_DEG;
  const xMax = (lonE + 180) * PIXELS_PER_DEG;
  const yMin = (90 - latN) * PIXELS_PER_DEG; // north edge → smaller y
  const yMax = (90 - latS) * PIXELS_PER_DEG;

  // Assert the cropped window fits without wrap-around. None of the
  // Apollo sites are anywhere near the antimeridian or the poles, but a
  // future site addition could drift, so catch it here.
  if (xMin < 0 || xMax > TIFF_WIDTH - 1 || yMin < 0 || yMax > TIFF_HEIGHT - 1) {
    fail(`❌ ${site.id}: crop window out of bounds (x=${xMin.toFixed(2)}..${xMax.toFixed(2)}, y=${yMin.toFixed(2)}..${yMax.toFixed(2)})`);
  }

  const heightsM = new Float64Array(OUT_SIZE * OUT_SIZE);
  let minM = Infinity;
  let maxM = -Infinity;

  for (let r = 0; r < OUT_SIZE; r++) {
    const y = yMin + (r / (OUT_SIZE - 1)) * (yMax - yMin);
    for (let c = 0; c < OUT_SIZE; c++) {
      const x = xMin + (c / (OUT_SIZE - 1)) * (xMax - xMin);
      const pix = bilinearSample(raster, TIFF_WIDTH, TIFF_HEIGHT, x, y);
      const m = pix * HEIGHT_SCALE + HEIGHT_OFFSET;
      heightsM[r * OUT_SIZE + c] = m;
      if (m < minM) minM = m;
      if (m > maxM) maxM = m;
    }
  }

  if (!(maxM > minM)) {
    fail(`❌ ${site.id}: degenerate flat window (min=${minM} max=${maxM}) — coordinate-math bug`);
  }

  const range = maxM - minM;
  const heights = new Array(OUT_SIZE * OUT_SIZE);
  for (let i = 0; i < heightsM.length; i++) {
    const n = (heightsM[i] - minM) / range;
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      fail(`❌ ${site.id}: normalized height out of [0,1] at index ${i}: ${n}`);
    }
    heights[i] = n;
  }

  if (heights.length !== OUT_SIZE * OUT_SIZE) {
    fail(`❌ ${site.id}: heights.length=${heights.length} expected ${OUT_SIZE * OUT_SIZE}`);
  }

  return { minM, maxM, heights };
}

async function main() {
  const forceDownload = process.argv.includes('--force-download');

  if (forceDownload || !(await fileExists(TIFF_PATH))) {
    if (forceDownload && (await fileExists(TIFF_PATH))) {
      await unlink(TIFF_PATH);
    }
    await downloadTiff();
  } else {
    console.log(`Using cached TIFF at ${TIFF_PATH}`);
  }

  console.log('Parsing TIFF...');
  const tiff = await fromFile(TIFF_PATH);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const bitsPerSample = image.getBitsPerSample();

  if (width !== TIFF_WIDTH || height !== TIFF_HEIGHT || bitsPerSample !== 16) {
    fail(`❌ Source TIFF has unexpected dimensions or bit depth: ${width}x${height}, ${bitsPerSample}-bit`);
  }

  const rasters = await image.readRasters({ interleave: true });
  console.log(`✅ Parsed ${width}×${height}, ${bitsPerSample}-bit (${rasters.length.toLocaleString()} samples)`);

  await mkdir(OUT_DIR, { recursive: true });

  for (const site of SITES) {
    const { minM, maxM, heights } = bakeSite(site, rasters);
    const out = {
      site: site.id,
      lat: site.lat,
      lon: site.lon,
      size: OUT_SIZE,
      groundExtentM: GROUND_EXTENT_M,
      minM,
      maxM,
      heights,
    };
    const outPath = resolve(OUT_DIR, `${site.id}.json`);
    const json = JSON.stringify(out);
    await writeFile(outPath, json);
    const kb = Math.round(json.length / 1024);
    console.log(
      `✅ ${site.id}: ${OUT_SIZE}×${OUT_SIZE} heights, range ${minM.toFixed(1)} .. ${maxM.toFixed(1)} m (Δ ${(maxM - minM).toFixed(1)} m), ${kb} KB`,
    );
  }
}

main().catch((err) => {
  console.error('❌', err.stack || err.message || err);
  process.exit(1);
});
