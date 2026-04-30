import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fromFile } from 'geotiff';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const RELEASE_OWNER = 'Sco314';
const RELEASE_REPO = 'CoolStemGames';
const OUT_DIR = resolve(REPO_ROOT, 'moonlander/assets/baked_terrain');

// CGI Moon Kit LDEM encoding: pixel value * 0.5 m above 1727.4 km reference.
// Mean lunar surface is at 1737.4 km, so subtract 10000 m to get meters
// above mean surface.
const HEIGHT_SCALE = 0.5;
const HEIGHT_OFFSET = -10000;

const MEAN_LUNAR_RADIUS_M = 1737400;
const METERS_PER_DEG_LAT = (Math.PI * MEAN_LUNAR_RADIUS_M) / 180;

const HEIGHT_OUT_SIZE = 65;
const COLOR_OUT_SIZE = 256;
// Color and height bakes use DIFFERENT crop sizes. Heights stay at 1600 m
// for close-up walk-around relief; color is 16 km because the 16k LROC
// source's ~45 ppd only gives ~2.4 source pixels per side at a 1600 m
// crop — not enough to fill a 256² output with visible detail. At 16 km
// we get ~109 source px per side ≈ 12,000 unique samples.
//
// The runtime UV math depends on the COLOR extent (per the sidecar
// metadata, see writeColorSidecar below), not the heightmap extent.
const HEIGHT_GROUND_EXTENT_M = 1600;
const COLOR_GROUND_EXTENT_M  = 16000;

// Margin (in source pixels) around each crop window to keep bilinear
// interpolation valid at edges. Tiny — the 16k crops are only ~5 px
// per side so even pad=1 would technically be enough, but pad=2 is
// cheap insurance against off-by-one mistakes.
const WINDOW_PAD = 2;

const SITES = [
  { id: 'apollo-11', lat:  0.6741, lon:  23.4733 },
  { id: 'apollo-12', lat: -3.0128, lon: -23.4219 },
  { id: 'apollo-14', lat: -3.6453, lon: -17.4714 },
  { id: 'apollo-15', lat: 26.1322, lon:   3.6339 },
  { id: 'apollo-16', lat: -8.9734, lon:  15.5011 },
  { id: 'apollo-17', lat: 20.1908, lon:  30.7717 },
];

// Asset descriptors. Each TIFF source is parameterized so the LDEM and
// LROC paths share the download / parse / sample machinery. Width and
// height are validated against expected dims; pixels-per-degree is
// derived from width (= width / 360) so re-encoded sources at different
// resolutions just work.
const ASSETS = {
  ldem: {
    tag: 'assets/ldem-16-uint',
    name: 'ldem_16_uint.tif',
    cachePath: resolve(__dirname, 'ldem_16_uint.tif'),
    expectedDims: [5760, 2880],
    expectedBps: 16,
    expectedSpp: 1,
    sizeMinBytes: 30e6,
    sizeMaxBytes: 35e6,
  },
  lroc: {
    tag: 'assets/lroc-color-4k',
    name: 'lroc_color_16bit_srgb_4k.tif',
    cachePath: resolve(__dirname, 'lroc_color_16bit_srgb_4k.tif'),
    expectedDims: [4096, 2048],
    expectedBps: 16,
    expectedSpp: 3,
    sizeMinBytes: 50e6,
    sizeMaxBytes: 70e6,
    tierLabel: '4k',
    bakeSizeMin: 256,             // 4k crops produce ~1-4 KB PNGs by design
    bakeSizeMax: 500 * 1024,
  },
  lroc16k: {
    // The user's release uses the bare filename stem as the tag — no
    // 'assets/' prefix unlike the LDEM and 4k LROC releases.
    tag: 'lroc_color_16bit_srgb_16k',
    name: 'lroc_color_16bit_srgb_16k.tif',
    cachePath: resolve(__dirname, 'lroc_color_16bit_srgb_16k.tif'),
    expectedDims: [16384, 8192],
    expectedBps: 16,
    expectedSpp: 3,
    sizeMinBytes: 500e6,
    sizeMaxBytes: 1.1e9,          // observed ~954 MB; pad to 1.1 GB
    tierLabel: '16k',
    // At 16 km crop the 16k source covers ~109 px per side ≈ 12,000
    // unique samples per tile. PNGs should fall in [50 KB, 800 KB];
    // outside that band we WARN (don't fail) since real moon terrain
    // can produce surprisingly compressible (or larger) outputs.
    bakeSizeMin: 50 * 1024,
    bakeSizeMax: 800 * 1024,
  },
};

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

function authHeaders() {
  // GITHUB_TOKEN is OPTIONAL: the repo is currently public so anonymous
  // fetch works, but if a token is set we'll attach it (preserves the
  // ability to run against a private repo later without code changes).
  const headers = { Accept: 'application/octet-stream' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function downloadAsset(asset) {
  // Public-repo download URL works without auth; the API path is the
  // fallback for private-repo runs (requires a token).
  const publicUrl =
    `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}` +
    `/releases/download/${asset.tag}/${asset.name}`;

  let res = await fetch(publicUrl, { headers: authHeaders(), redirect: 'follow' });
  if (!res.ok) {
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      // Private-repo path: look up the asset by name via API, then GET
      // its API URL with Accept: application/octet-stream + auth.
      const apiHeaders = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
      };
      const releaseUrl = `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/tags/${asset.tag}`;
      const rel = await fetch(releaseUrl, { headers: apiHeaders });
      if (!rel.ok) fail(`❌ Release lookup failed: HTTP ${rel.status} ${rel.statusText}`);
      const release = await rel.json();
      const meta = release.assets?.find((a) => a.name === asset.name);
      if (!meta) fail(`❌ Asset ${asset.name} not found on release ${asset.tag}`);
      res = await fetch(meta.url, {
        headers: { ...apiHeaders, Accept: 'application/octet-stream' },
        redirect: 'follow',
      });
    }
    if (!res.ok) {
      const hint = !token
        ? ' (private-repo asset? set GITHUB_TOKEN env var)'
        : '';
      fail(`❌ ${asset.name} download failed: HTTP ${res.status} ${res.statusText}${hint}`);
    }
  }

  console.log(`Downloading ${asset.name}`);
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
  await pipeline(Readable.fromWeb(res.body.pipeThrough(reporter)), createWriteStream(asset.cachePath));

  const { size } = await stat(asset.cachePath);
  const mb = size / 1e6;
  if (size < asset.sizeMinBytes || size > asset.sizeMaxBytes) {
    await unlink(asset.cachePath).catch(() => {});
    fail(`❌ ${asset.name} download invalid (wrong size ${mb.toFixed(1)} MB) — re-run script`);
  }
  console.log(`✅ Downloaded ${mb.toFixed(1)} MB`);
}

async function ensureAsset(asset, forceDownload) {
  if (forceDownload || !(await fileExists(asset.cachePath))) {
    if (forceDownload && (await fileExists(asset.cachePath))) {
      await unlink(asset.cachePath);
    }
    await downloadAsset(asset);
  } else {
    console.log(`Using cached ${asset.name}`);
  }
}

/**
 * Open a TIFF and validate dims; return the geotiff Image so callers can
 * issue per-site windowed reads. Reading the full raster up-front would
 * cost ~768 MB for the 16k LROC; windowed reads decode only the tiles
 * (or strips) that intersect each crop.
 */
async function openTiff(asset) {
  console.log(`Parsing ${asset.name}...`);
  const tiff = await fromFile(asset.cachePath);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const bps = image.getBitsPerSample();
  const spp = image.getSamplesPerPixel();
  const [expW, expH] = asset.expectedDims;

  if (width !== expW || height !== expH || bps !== asset.expectedBps || spp !== asset.expectedSpp) {
    fail(`❌ ${asset.name} has unexpected dimensions or layout: ${width}×${height}, ${bps}-bit, ${spp} samples/px (expected ${expW}×${expH}, ${asset.expectedBps}-bit, ${asset.expectedSpp} samples/px)`);
  }
  console.log(`✅ ${asset.name}: ${width}×${height}, ${bps}-bit, ${spp}-channel`);
  return { image, width, height };
}

function bilinearSample1(raster, width, height, x, y) {
  // Single-channel bilinear. Caller guarantees x,y are inside
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

function pixelBoundsForSite(site, width, height, extentM) {
  const halfM = extentM / 2;
  const halfDegLat = halfM / METERS_PER_DEG_LAT;
  // cos(lat) longitude correction — at 16 km the longitude window
  // spans ~0.53° so the correction matters for high-latitude sites
  // (Apollo 15 +26.13°, Apollo 17 +20.19°) where it shifts the crop
  // by ~5-7%.
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((site.lat * Math.PI) / 180);
  const halfDegLon = halfM / metersPerDegLon;

  const latN = site.lat + halfDegLat;
  const latS = site.lat - halfDegLat;
  const lonW = site.lon - halfDegLon;
  const lonE = site.lon + halfDegLon;

  const ppd = width / 360;
  const xMin = (lonW + 180) * ppd;
  const xMax = (lonE + 180) * ppd;
  const yMin = (90 - latN) * ppd; // north edge → smaller y
  const yMax = (90 - latS) * ppd;

  if (xMin < 0 || xMax > width - 1 || yMin < 0 || yMax > height - 1) {
    fail(`❌ ${site.id}: crop window out of bounds (x=${xMin.toFixed(2)}..${xMax.toFixed(2)}, y=${yMin.toFixed(2)}..${yMax.toFixed(2)})`);
  }
  return { xMin, xMax, yMin, yMax };
}

/**
 * Read the per-site source-pixel window (with WINDOW_PAD margin) from
 * `image`. Returns the raster + the window's origin so callers can
 * convert image-space (x, y) to window-relative (x - winX, y - winY).
 */
async function readSiteWindow(image, bounds, { interleave }) {
  const fullW = image.getWidth();
  const fullH = image.getHeight();
  const winX = Math.max(0, Math.floor(bounds.xMin) - WINDOW_PAD);
  const winY = Math.max(0, Math.floor(bounds.yMin) - WINDOW_PAD);
  const winXMax = Math.min(fullW, Math.ceil(bounds.xMax) + WINDOW_PAD);
  const winYMax = Math.min(fullH, Math.ceil(bounds.yMax) + WINDOW_PAD);
  const winW = winXMax - winX;
  const winH = winYMax - winY;
  const data = await image.readRasters({
    window: [winX, winY, winXMax, winYMax],
    interleave,
  });
  return { data, winX, winY, winW, winH };
}

async function bakeSiteHeights(site, image) {
  const width = image.getWidth();
  const height = image.getHeight();
  const bounds = pixelBoundsForSite(site, width, height, HEIGHT_GROUND_EXTENT_M);
  const { data, winX, winY, winW, winH } = await readSiteWindow(image, bounds, { interleave: true });

  const heightsM = new Float64Array(HEIGHT_OUT_SIZE * HEIGHT_OUT_SIZE);
  let minM = Infinity;
  let maxM = -Infinity;

  for (let r = 0; r < HEIGHT_OUT_SIZE; r++) {
    const yImg = bounds.yMin + (r / (HEIGHT_OUT_SIZE - 1)) * (bounds.yMax - bounds.yMin);
    for (let c = 0; c < HEIGHT_OUT_SIZE; c++) {
      const xImg = bounds.xMin + (c / (HEIGHT_OUT_SIZE - 1)) * (bounds.xMax - bounds.xMin);
      const pix = bilinearSample1(data, winW, winH, xImg - winX, yImg - winY);
      const m = pix * HEIGHT_SCALE + HEIGHT_OFFSET;
      heightsM[r * HEIGHT_OUT_SIZE + c] = m;
      if (m < minM) minM = m;
      if (m > maxM) maxM = m;
    }
  }

  if (!(maxM > minM)) {
    fail(`❌ ${site.id}: degenerate flat window (min=${minM} max=${maxM}) — coordinate-math bug`);
  }

  const range = maxM - minM;
  const heights = new Array(HEIGHT_OUT_SIZE * HEIGHT_OUT_SIZE);
  for (let i = 0; i < heightsM.length; i++) {
    const n = (heightsM[i] - minM) / range;
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      fail(`❌ ${site.id}: normalized height out of [0,1] at index ${i}: ${n}`);
    }
    heights[i] = n;
  }

  if (heights.length !== HEIGHT_OUT_SIZE * HEIGHT_OUT_SIZE) {
    fail(`❌ ${site.id}: heights.length=${heights.length} expected ${HEIGHT_OUT_SIZE * HEIGHT_OUT_SIZE}`);
  }

  return { minM, maxM, heights };
}

async function bakeSiteColor(site, image) {
  const width = image.getWidth();
  const height = image.getHeight();
  const bounds = pixelBoundsForSite(site, width, height, COLOR_GROUND_EXTENT_M);
  const { data, winX, winY, winW, winH } = await readSiteWindow(image, bounds, { interleave: false });
  if (!Array.isArray(data) || data.length !== 3) {
    fail(`❌ ${site.id}: LROC window: expected 3-band array, got ${Array.isArray(data) ? data.length : typeof data}`);
  }
  const [rBand, gBand, bBand] = data;

  const png = new PNG({ width: COLOR_OUT_SIZE, height: COLOR_OUT_SIZE, colorType: 2 /* RGB */ });
  // pngjs' Buffer is RGBA even for colorType 2 (it allocates 4 bytes/px and
  // discards alpha on encode). Pack as RGBA, alpha = 255. Track luminance
  // for both mean (sanity check) and std-dev (visible-detail check).
  const N = COLOR_OUT_SIZE * COLOR_OUT_SIZE;
  const lums = new Float64Array(N);
  let lumSum = 0;
  let li = 0;
  for (let r = 0; r < COLOR_OUT_SIZE; r++) {
    const yImg = bounds.yMin + (r / (COLOR_OUT_SIZE - 1)) * (bounds.yMax - bounds.yMin);
    const yWin = yImg - winY;
    for (let c = 0; c < COLOR_OUT_SIZE; c++) {
      const xImg = bounds.xMin + (c / (COLOR_OUT_SIZE - 1)) * (bounds.xMax - bounds.xMin);
      const xWin = xImg - winX;
      // 16-bit sRGB → 8-bit sRGB is a straight high-byte truncation. The
      // browser's PNG sampling assumes sRGB, so no gamma adjustment.
      const r16 = bilinearSample1(rBand, winW, winH, xWin, yWin);
      const g16 = bilinearSample1(gBand, winW, winH, xWin, yWin);
      const b16 = bilinearSample1(bBand, winW, winH, xWin, yWin);
      const r8 = Math.max(0, Math.min(255, Math.round(r16 / 257)));
      const g8 = Math.max(0, Math.min(255, Math.round(g16 / 257)));
      const b8 = Math.max(0, Math.min(255, Math.round(b16 / 257)));
      // Rec.709 luminance.
      const L = 0.2126 * r8 + 0.7152 * g8 + 0.0722 * b8;
      lums[li++] = L;
      lumSum += L;
      const idx = (r * COLOR_OUT_SIZE + c) * 4;
      png.data[idx]     = r8;
      png.data[idx + 1] = g8;
      png.data[idx + 2] = b8;
      png.data[idx + 3] = 255;
    }
  }
  const meanL01 = lumSum / N / 255;
  if (meanL01 < 0.05 || meanL01 > 0.95) {
    fail(`❌ ${site.id} color: mean luminance out of range (${meanL01.toFixed(3)})`);
  }
  // Std-dev of luminance in 0-255 space; > 3 means visible detail, < 1
  // means the crop is essentially flat (warning).
  const meanL255 = lumSum / N;
  let varSum = 0;
  for (let i = 0; i < N; i++) {
    const d = lums[i] - meanL255;
    varSum += d * d;
  }
  const stddevL = Math.sqrt(varSum / N);
  const buf = PNG.sync.write(png);
  return { buf, meanL: meanL01, stddevL };
}

function parseFlags() {
  const argv = process.argv.slice(2);
  const flags = {
    color: argv.includes('--color'),
    heights: argv.includes('--heights'),
    all: argv.includes('--all'),
    forceDownload: argv.includes('--force-download'),
    hires: argv.includes('--hires'),
  };
  // Default: --color (heightmaps were baked in PR #104; re-baking them
  // produces byte-identical output but creates noise for diff tools, so
  // require an explicit opt-in).
  if (!flags.color && !flags.heights && !flags.all) flags.color = true;
  if (flags.all) { flags.color = true; flags.heights = true; }
  return flags;
}

async function main() {
  const flags = parseFlags();
  await mkdir(OUT_DIR, { recursive: true });

  if (flags.heights) {
    await ensureAsset(ASSETS.ldem, flags.forceDownload);
    const { image } = await openTiff(ASSETS.ldem);
    for (const site of SITES) {
      const { minM, maxM, heights } = await bakeSiteHeights(site, image);
      const out = {
        site: site.id, lat: site.lat, lon: site.lon,
        size: HEIGHT_OUT_SIZE, groundExtentM: HEIGHT_GROUND_EXTENT_M,
        minM, maxM, heights,
      };
      const outPath = resolve(OUT_DIR, `${site.id}.json`);
      const json = JSON.stringify(out);
      await writeFile(outPath, json);
      const kb = Math.round(json.length / 1024);
      console.log(
        `✅ ${site.id}: ${HEIGHT_OUT_SIZE}×${HEIGHT_OUT_SIZE} heights, range ${minM.toFixed(1)} .. ${maxM.toFixed(1)} m (Δ ${(maxM - minM).toFixed(1)} m), ${kb} KB`,
      );
    }
  }

  if (flags.color) {
    const lrocAsset = flags.hires ? ASSETS.lroc16k : ASSETS.lroc;
    const extentKm = (COLOR_GROUND_EXTENT_M / 1000) | 0;
    await ensureAsset(lrocAsset, flags.forceDownload);
    const { image } = await openTiff(lrocAsset);
    for (const site of SITES) {
      const { buf, meanL, stddevL } = await bakeSiteColor(site, image);
      const outPath = resolve(OUT_DIR, `${site.id}_color.png`);
      await writeFile(outPath, buf);
      const { size } = await stat(outPath);
      // Warn-don't-fail: real moon terrain may produce surprisingly
      // compressible (or larger) PNGs; the mean-luminance + stddev
      // checks below are the real sanity guards.
      const kb = Math.round(size / 1024);
      if (size < lrocAsset.bakeSizeMin || size > lrocAsset.bakeSizeMax) {
        console.warn(
          `⚠️  ${site.id} color (${lrocAsset.tierLabel}): PNG size ${kb} KB outside expected ` +
          `[${(lrocAsset.bakeSizeMin / 1024) | 0}, ${(lrocAsset.bakeSizeMax / 1024) | 0}] KB`
        );
      }
      // Sidecar metadata so the runtime knows the colour-bake's
      // groundExtentM (which may differ from the heightmap's).
      const meta = {
        site: site.id,
        lat: site.lat,
        lon: site.lon,
        groundExtentM: COLOR_GROUND_EXTENT_M,
        sourceTif: lrocAsset.name,
        outputSize: COLOR_OUT_SIZE,
      };
      await writeFile(
        resolve(OUT_DIR, `${site.id}_color.json`),
        JSON.stringify(meta)
      );
      const detail = stddevL >= 3 ? '  (visible detail confirmed)' : '';
      console.log(
        `✅ ${site.id} color (${lrocAsset.tierLabel}, ${extentKm}km): ${COLOR_OUT_SIZE}×${COLOR_OUT_SIZE}, ` +
        `mean L=${meanL.toFixed(2)}, ${kb} KB`
      );
      console.log(`           stddev L = ${stddevL.toFixed(1)}${detail}`);
      if (stddevL < 1) {
        console.warn(`⚠️  ${site.id} color: stddev L=${stddevL.toFixed(2)} — crop likely too smooth, no visible detail`);
      }
    }
  }
}

main().catch((err) => {
  console.error('❌', err.stack || err.message || err);
  process.exit(1);
});
