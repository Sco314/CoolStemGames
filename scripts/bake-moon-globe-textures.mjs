// bake-moon-globe-textures.mjs — v0.1.0
//
// Produces the two whole-moon equirectangular textures consumed by
// moonlander/js/modes/OrbitMode.js:
//
//   moonlander/textures/moon/moon_color_2k.jpg   (2048×1024 RGB JPEG, ~500-1000 KB)
//   moonlander/textures/moon/moon_normal_1k.png  (1024×512 RGB PNG, normals from LDEM)
//
// Sources (already hosted on this repo's GitHub Releases via bake-terrain.mjs):
//   - lroc_color_16bit_srgb_4k.tif (4096×2048, 16-bit RGB)
//   - ldem_16_uint.tif             (5760×2880, 16-bit single-channel)
//
// Resolutions are conservative for Phase A (<2 MB total payload). Phase B
// can swap in 4k/2k variants and add device-cap LOD selection.
//
// Run:
//   cd scripts
//   npm install        # picks up jpeg-js alongside geotiff/pngjs
//   node bake-moon-globe-textures.mjs

import { writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fromFile } from 'geotiff';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const RELEASE_OWNER = 'Sco314';
const RELEASE_REPO = 'CoolStemGames';
const OUT_DIR = resolve(REPO_ROOT, 'moonlander/textures/moon');

const COLOR_OUT_W = 2048;
const COLOR_OUT_H = 1024;
const NORMAL_OUT_W = 1024;
const NORMAL_OUT_H = 512;

const MEAN_LUNAR_RADIUS_M = 1737400;
const HEIGHT_SCALE  = 0.5;        // CGI Moon Kit LDEM: pixel * 0.5 m above 1727.4 km reference
const HEIGHT_OFFSET = -10000;     // mean lunar surface @ 1737.4 km → subtract 10 km

// JPEG quality 88 puts the 2k color map in the 600–900 KB band on real
// LROC content. Higher (95) bloats to 1.5 MB+ for negligible visual gain
// at orbit distance.
const JPEG_QUALITY = 88;

// Identical asset descriptors to bake-terrain.mjs so a future refactor
// can hoist them into a shared module without changing values.
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
  lroc4k: {
    tag: 'assets/lroc-color-4k',
    name: 'lroc_color_16bit_srgb_4k.tif',
    cachePath: resolve(__dirname, 'lroc_color_16bit_srgb_4k.tif'),
    expectedDims: [4096, 2048],
    expectedBps: 16,
    expectedSpp: 3,
    sizeMinBytes: 50e6,
    sizeMaxBytes: 70e6,
  },
};

function fail(msg) { console.error(msg); process.exit(1); }

async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

function authHeaders() {
  const headers = { Accept: 'application/octet-stream' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function downloadAsset(asset) {
  const publicUrl =
    `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}` +
    `/releases/download/${asset.tag}/${asset.name}`;
  let res = await fetch(publicUrl, { headers: authHeaders(), redirect: 'follow' });
  if (!res.ok) {
    const token = process.env.GITHUB_TOKEN;
    if (token) {
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
      const hint = !token ? ' (private-repo asset? set GITHUB_TOKEN env var)' : '';
      fail(`❌ ${asset.name} download failed: HTTP ${res.status} ${res.statusText}${hint}`);
    }
  }
  console.log(`Downloading ${asset.name}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(asset.cachePath));
  const { size } = await stat(asset.cachePath);
  if (size < asset.sizeMinBytes || size > asset.sizeMaxBytes) {
    await unlink(asset.cachePath).catch(() => {});
    fail(`❌ ${asset.name} download invalid (size ${(size / 1e6).toFixed(1)} MB) — re-run`);
  }
  console.log(`✅ Downloaded ${(size / 1e6).toFixed(1)} MB`);
}

async function ensureAsset(asset, forceDownload) {
  if (forceDownload || !(await fileExists(asset.cachePath))) {
    if (forceDownload && (await fileExists(asset.cachePath))) await unlink(asset.cachePath);
    await downloadAsset(asset);
  } else {
    console.log(`Using cached ${asset.name}`);
  }
}

async function openTiff(asset) {
  console.log(`Parsing ${asset.name}...`);
  const tiff = await fromFile(asset.cachePath);
  const image = await tiff.getImage();
  const w = image.getWidth(), h = image.getHeight();
  const bps = image.getBitsPerSample(), spp = image.getSamplesPerPixel();
  const [eW, eH] = asset.expectedDims;
  if (w !== eW || h !== eH || bps !== asset.expectedBps || spp !== asset.expectedSpp) {
    fail(`❌ ${asset.name} has unexpected layout: ${w}×${h}, ${bps}-bit, ${spp}-channel`);
  }
  console.log(`✅ ${asset.name}: ${w}×${h}, ${bps}-bit, ${spp}-channel`);
  return image;
}

// Bilinear sample with longitude wrap (image x wraps; latitude clamps).
function sampleBilinearWrap(raster, w, h, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = ((x0 + 1) % w + w) % w;
  const xMod = ((x0 % w) + w) % w;
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - Math.floor(x);
  const fy = y - y0;
  const v00 = raster[y0 * w + xMod];
  const v10 = raster[y0 * w + x1];
  const v01 = raster[y1 * w + xMod];
  const v11 = raster[y1 * w + x1];
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) +
         (v01 * (1 - fx) + v11 * fx) * fy;
}

async function bakeColor(image) {
  console.log(`Reading full LROC raster (${image.getWidth()}×${image.getHeight()})...`);
  const data = await image.readRasters({ interleave: false });
  if (!Array.isArray(data) || data.length !== 3) {
    fail(`❌ LROC: expected 3-band array, got ${Array.isArray(data) ? data.length : typeof data}`);
  }
  const [rB, gB, bB] = data;
  const srcW = image.getWidth(), srcH = image.getHeight();

  // jpeg-js wants RGBA in raw 8-bit, then encodes.
  const rgba = Buffer.alloc(COLOR_OUT_W * COLOR_OUT_H * 4);
  for (let y = 0; y < COLOR_OUT_H; y++) {
    const ys = (y + 0.5) / COLOR_OUT_H * srcH - 0.5;
    for (let x = 0; x < COLOR_OUT_W; x++) {
      const xs = (x + 0.5) / COLOR_OUT_W * srcW - 0.5;
      const r16 = sampleBilinearWrap(rB, srcW, srcH, xs, ys);
      const g16 = sampleBilinearWrap(gB, srcW, srcH, xs, ys);
      const b16 = sampleBilinearWrap(bB, srcW, srcH, xs, ys);
      const i = (y * COLOR_OUT_W + x) * 4;
      // 16-bit sRGB → 8-bit sRGB: high-byte truncation. Rounded.
      rgba[i]     = Math.max(0, Math.min(255, Math.round(r16 / 257)));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round(g16 / 257)));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round(b16 / 257)));
      rgba[i + 3] = 255;
    }
  }
  const encoded = jpeg.encode({ data: rgba, width: COLOR_OUT_W, height: COLOR_OUT_H }, JPEG_QUALITY);
  const outPath = resolve(OUT_DIR, 'moon_color_2k.jpg');
  await writeFile(outPath, encoded.data);
  const { size } = await stat(outPath);
  console.log(`✅ moon_color_2k.jpg: ${COLOR_OUT_W}×${COLOR_OUT_H}, ${(size / 1024).toFixed(0)} KB (q=${JPEG_QUALITY})`);
}

async function bakeNormal(image) {
  console.log(`Reading full LDEM raster (${image.getWidth()}×${image.getHeight()})...`);
  // The LDEM is 5760×2880 single-channel 16-bit uint. interleave:false on
  // a single-band TIFF returns a TypedArray (not an array of bands).
  const data = await image.readRasters({ interleave: true });
  const heights16 = data; // Uint16Array
  const srcW = image.getWidth(), srcH = image.getHeight();

  // Convert to meters above mean lunar radius once into a Float32Array
  // (faster downstream sampling than recomputing scale + offset per read).
  const heightsM = new Float32Array(srcW * srcH);
  for (let i = 0; i < heightsM.length; i++) {
    heightsM[i] = heights16[i] * HEIGHT_SCALE + HEIGHT_OFFSET;
  }

  // Compute tangent-space normals on a sphere. At each output pixel we
  // sample heights on a small lat/lon stencil, compute partial heights
  // in METERS along east/north tangent directions, and synthesize a
  // unit normal. The cos(lat) correction in dx accounts for east-west
  // ground-distance shrinkage near the poles.
  const png = new PNG({ width: NORMAL_OUT_W, height: NORMAL_OUT_H, colorType: 2 });
  const buf = png.data; // RGBA Buffer
  const NORMAL_STRENGTH = 6.0; // unitless: amplifies the slope so subtle
                               // mare relief reads at orbit distance.
                               // 1.0 = geometrically accurate; >1 cheats.
  const TWO_PI = Math.PI * 2;
  const PI = Math.PI;
  const DEG2RAD = Math.PI / 180;
  const m_per_deg_lat = (Math.PI * MEAN_LUNAR_RADIUS_M) / 180;

  for (let y = 0; y < NORMAL_OUT_H; y++) {
    // v ∈ [0,1] → lat ∈ [+90,-90]
    const v = (y + 0.5) / NORMAL_OUT_H;
    const lat = (0.5 - v) * 180;                      // degrees
    const cosLat = Math.max(0.05, Math.cos(lat * DEG2RAD));
    const m_per_deg_lon = m_per_deg_lat * cosLat;
    const ys = v * srcH - 0.5;

    for (let x = 0; x < NORMAL_OUT_W; x++) {
      // Center sample.
      const u = (x + 0.5) / NORMAL_OUT_W;
      const xs = u * srcW - 0.5;

      // 1-source-pixel step in source coords.
      const xsE = xs + 1;
      const xsW = xs - 1;
      const ysS = Math.min(srcH - 1, ys + 1);
      const ysN = Math.max(0, ys - 1);
      const hE = sampleBilinearWrap(heightsM, srcW, srcH, xsE, ys);
      const hW = sampleBilinearWrap(heightsM, srcW, srcH, xsW, ys);
      const hN = sampleBilinearWrap(heightsM, srcW, srcH, xs,  ysN);
      const hS = sampleBilinearWrap(heightsM, srcW, srcH, xs,  ysS);

      // Distance in meters between adjacent source pixels.
      const dxLon = (360 / srcW) * m_per_deg_lon * 2;     // 2 source pixels in lon
      const dyLat = (180 / srcH) * m_per_deg_lat * 2;     // 2 source pixels in lat
      // Tangent-space slopes (m/m).
      const sx = (hE - hW) / dxLon;     // east slope
      const sy = (hS - hN) / dyLat;     // south slope (v grows southward)

      // Tangent-space normal: (-sx, -sy, 1) normalized. Convention:
      // normal map's R channel encodes east tangent (X), G encodes
      // south tangent, B encodes outward. Three.js MeshStandardMaterial
      // expects normalScale.y inverted for some authoring tools — we
      // bake green-up by negating sy in the encode step below. If the
      // material renders inverted, flip normalScale.y in OrbitMode.
      const nx = -sx * NORMAL_STRENGTH;
      const ny = -sy * NORMAL_STRENGTH;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const NX = nx / len, NY = ny / len, NZ = nz / len;

      const idx = (y * NORMAL_OUT_W + x) * 4;
      // [-1,1] → [0,255]. Standard tangent-space encoding.
      buf[idx]     = Math.round((NX * 0.5 + 0.5) * 255);
      buf[idx + 1] = Math.round((-NY * 0.5 + 0.5) * 255);   // green-up convention
      buf[idx + 2] = Math.round((NZ * 0.5 + 0.5) * 255);
      buf[idx + 3] = 255;
    }
  }

  const encoded = PNG.sync.write(png, { colorType: 2, deflateLevel: 9 });
  const outPath = resolve(OUT_DIR, 'moon_normal_1k.png');
  await writeFile(outPath, encoded);
  const { size } = await stat(outPath);
  console.log(`✅ moon_normal_1k.png: ${NORMAL_OUT_W}×${NORMAL_OUT_H}, ${(size / 1024).toFixed(0)} KB`);
}

function parseFlags() {
  const argv = process.argv.slice(2);
  const flags = {
    color: argv.includes('--color'),
    normal: argv.includes('--normal'),
    all: argv.includes('--all') || (!argv.includes('--color') && !argv.includes('--normal')),
    forceDownload: argv.includes('--force-download'),
  };
  if (flags.all) { flags.color = true; flags.normal = true; }
  return flags;
}

async function main() {
  const flags = parseFlags();
  await mkdir(OUT_DIR, { recursive: true });

  if (flags.color) {
    await ensureAsset(ASSETS.lroc4k, flags.forceDownload);
    const image = await openTiff(ASSETS.lroc4k);
    await bakeColor(image);
  }

  if (flags.normal) {
    await ensureAsset(ASSETS.ldem, flags.forceDownload);
    const image = await openTiff(ASSETS.ldem);
    await bakeNormal(image);
  }
}

main().catch((err) => {
  console.error('❌', err.stack || err.message || err);
  process.exit(1);
});
