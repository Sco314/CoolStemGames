// modes/OrbitMode.js — v0.2.0
// Admin-only "Lunar Stationary Orbit" view. Parks the camera ~6,545 km off
// the lunar surface and renders a textured moon sphere lit by the live
// Sun→Moon vector, so the visible phase, libration, and pole orientation
// match today's actual lunar geometry.
//
// World-unit convention is shared with BakedTerrain.js: 1 WU = 0.6275 m.
// The scene frame is selenographic by construction:
//   +X = east  (selenographic longitude +90°, latitude 0°)
//   +Y = north pole (the moon's spin axis)
//   +Z = sub-Earth's mean direction (selenographic 0°N, 0°E — the prime
//                                    meridian on the equator, near side)
// The moon mesh is rotated -π/2 about Y so its equirectangular texture
// (lon=0 at u=0.5) maps to selenographic in the same frame.
//
// Camera and light are positioned per the live ephemeris:
//   - Camera at (R + altitude) * selenoToCart(elat, elon) — moves with
//     libration so the visible-face wobble is real.
//   - DirectionalLight at scaled selenoToCart(slat, slon) — sub-solar
//     point in selenographic coordinates.
// Both are recomputed once per second (the apparent sun moves ~0.5°/hour).
//
// Texture sourcing (built by scripts/bake-moon-globe-textures.mjs):
//   - moonlander/textures/moon/moon_color_2k.jpg  (LROC WAC color)
//   - moonlander/textures/moon/moon_normal_1k.png (LOLA-derived normals)
// Missing textures fall back to a flat gray sphere so admin UI still works.
//
// Astronomy: astronomy-engine (cosinekitty, MIT) loaded lazily via dynamic
// `import()` on first enter() — keeps the ~410 KB out of the boot path.
// Falls back to a low-precision Meeus formula if the import fails (e.g.
// offline / blocked CDN), so the lighting still tracks the day's phase
// even without network. The HUD readout marks the source either way.
//
// Dial-A-Moon: NASA SVS publishes hourly canonical phase / sub-solar /
// libration data at https://svs.gsfc.nasa.gov/api/dialamoon/{ts}. We
// fetch it once on enter() to drive the HUD readout — a cosmetic touch
// that ensures our printed numbers match NASA's published almanac.
// Failure (404, CORS, offline) falls through to astronomy-engine numbers.

import * as THREE from 'three';
import { getSharedTexture } from '../AssetCache.js';
import { MODE } from '../Constants.js';
import { GameState, notify } from '../GameState.js';

const METERS_PER_WU = 2.008 / 3.2;
const KM_TO_WU = 1000 / METERS_PER_WU;

const MOON_RADIUS_KM = 1737.4;
const MOON_RADIUS_WU = MOON_RADIUS_KM * KM_TO_WU;

const INITIAL_ALTITUDE_KM = 6545;
const MIN_ALTITUDE_KM     = 200;
const MAX_ALTITUDE_KM     = 100000;

const FOV_DEG = 30;
const ZOOM_PER_WHEEL_NOTCH = 1.12;

const MOON_COLOR_URL  = 'textures/moon/moon_color_2k.jpg';
const MOON_NORMAL_URL = 'textures/moon/moon_normal_1k.png';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Cached astronomy-engine module (resolved on first OrbitMode.enter()).
// `null` means not-yet-attempted; `false` means tried-and-failed.
let AE = null;
let aePromise = null;

const state = {
  altitudeWU: INITIAL_ALTITUDE_KM * KM_TO_WU,
  lastOrientationRecompute: 0,
  // Smoothed direction vectors so the per-second recompute step doesn't
  // produce a visible jolt at deep zoom.
  earthDir: new THREE.Vector3(0, 0, 1),
  earthDirTarget: new THREE.Vector3(0, 0, 1),
  sunDir: new THREE.Vector3(1, 0, 0),
  sunDirTarget: new THREE.Vector3(1, 0, 0),
  // Latest almanac snapshot for the HUD readout.
  almanac: null,
};

let scene = null;
let camera = null;
let moonMesh = null;
let sunLight = null;
let ambientLight = null;
let colorTex = null;
let normalTex = null;
let canvasRef = null;
let wheelHandler = null;
let pinchTouches = null;
let touchHandlers = null;
let disposables = [];
let backBtn = null;
let almanacEl = null;
let onExitCb = null;

export const OrbitMode = {
  enter({ renderer, canvas }, opts = {}) {
    console.log('🛰 OrbitMode.enter');
    canvasRef = canvas;
    onExitCb = typeof opts.onExit === 'function' ? opts.onExit : null;

    scene = new THREE.Scene();
    const starfield = getSharedTexture('textures/starfield.png');
    if (starfield) {
      starfield.colorSpace = THREE.SRGBColorSpace;
      scene.background = starfield;
    } else {
      scene.background = new THREE.Color(0x000308);
    }

    camera = new THREE.PerspectiveCamera(
      FOV_DEG, 1,
      KM_TO_WU * 10,
      KM_TO_WU * 1_000_000
    );

    buildMoon();
    buildLights();

    GameState.mode = MODE.MENU;
    notify('mode');

    attachZoomListeners();
    buildBackButton();
    buildAlmanacOverlay();

    // Kick off the lazy load. Once it lands the next per-second tick
    // upgrades from the Meeus-formula fallback to library-grade values.
    ensureAstronomyEngine();
    // Compute orientation immediately so the first render frame already
    // shows the correct phase + libration (don't wait for tick #1).
    recomputeOrientation(new Date(), { snap: true });
    placeCamera();
    applyLight();
    fetchDialAMoon();   // fire-and-forget; populates HUD on success
  },

  exit() {
    console.log('◀ OrbitMode.exit');
    detachZoomListeners();
    destroyBackButton();
    destroyAlmanacOverlay();
    onExitCb = null;
    for (const d of disposables) {
      d.geometry?.dispose();
      d.material?.dispose();
    }
    colorTex?.dispose();
    normalTex?.dispose();
    disposables = [];
    scene = null;
    camera = null;
    moonMesh = null;
    sunLight = null;
    ambientLight = null;
    colorTex = null;
    normalTex = null;
    canvasRef = null;
    state.almanac = null;
  },

  update(dt) {
    state.lastOrientationRecompute += dt;
    if (state.lastOrientationRecompute >= 1.0) {
      state.lastOrientationRecompute = 0;
      recomputeOrientation(new Date(), { snap: false });
    }
    // Slow lerp toward target keeps the per-second recompute invisible.
    const k = Math.min(1, dt * 0.3);
    state.earthDir.lerp(state.earthDirTarget, k).normalize();
    state.sunDir.lerp(state.sunDirTarget, k).normalize();
    placeCamera();
    applyLight();
  },

  render(renderer) {
    if (!scene || !camera) return;
    renderer.render(scene, camera);
  },

  getCamera() { return camera; },
  getScene()  { return scene; },
};

// ---- builders -----------------------------------------------------------

function buildMoon() {
  const geom = new THREE.SphereGeometry(MOON_RADIUS_WU, 128, 96);

  const loader = new THREE.TextureLoader();
  let material;
  try {
    colorTex  = loader.load(MOON_COLOR_URL,  () => {}, undefined, () => {
      console.warn('[OrbitMode] color texture failed to load — run scripts/bake-moon-globe-textures.mjs');
    });
    normalTex = loader.load(MOON_NORMAL_URL, () => {}, undefined, () => {
      console.warn('[OrbitMode] normal texture failed to load — run scripts/bake-moon-globe-textures.mjs');
    });
    colorTex.colorSpace = THREE.SRGBColorSpace;
    colorTex.anisotropy = 8;
    normalTex.anisotropy = 4;
    material = new THREE.MeshStandardMaterial({
      map: colorTex,
      normalMap: normalTex,
      roughness: 1.0,
      metalness: 0.0,
    });
  } catch (err) {
    console.warn('[OrbitMode] falling back to flat gray sphere:', err?.message || err);
    material = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 1.0,
      metalness: 0.0,
    });
  }

  moonMesh = new THREE.Mesh(geom, material);
  // Three.js SphereGeometry default mapping puts texture u=0.5 (the
  // prime meridian on a standard equirect moon map) at world +X. We
  // want the prime meridian at +Z (so a no-libration camera at +Z
  // looks straight at the sub-Earth point) and east longitudes at +X
  // (screen-right). Rotating the mesh -π/2 about Y achieves both:
  // u=0.5 → +Z, u=0.75 (lon=+90°, east) → +X.
  moonMesh.rotation.y = -Math.PI / 2;
  scene.add(moonMesh);
  disposables.push({ geometry: geom, material });
}

function buildLights() {
  // The Sun's light is parallel-rays at the Moon's distance (~150M km),
  // so a DirectionalLight is physically correct. Intensity 1.5 is tuned
  // against the ACES tone-mapping curve added in PR #132 — the lit limb
  // reads bright without blowing out the maria's albedo.
  sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
  sunLight.position.set(1, 0, 0);
  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Earthshine: the dark limb is reflectively lit by Earth (~7% albedo,
  // ~3.7° apparent diameter from the Moon — much bigger than Earth's Moon
  // appears to us). Modeled as a faint blue-leaning ambient.
  ambientLight = new THREE.AmbientLight(0x101418, 0.4);
  scene.add(ambientLight);
}

function placeCamera() {
  if (!camera) return;
  const dist = MOON_RADIUS_WU + state.altitudeWU;
  camera.position.set(
    state.earthDir.x * dist,
    state.earthDir.y * dist,
    state.earthDir.z * dist,
  );
  camera.up.set(0, 1, 0);          // selenographic north
  camera.lookAt(0, 0, 0);
}

function applyLight() {
  if (!sunLight) return;
  const k = MOON_RADIUS_WU * 1000;
  sunLight.position.set(
    state.sunDir.x * k,
    state.sunDir.y * k,
    state.sunDir.z * k,
  );
}

// ---- astronomy ----------------------------------------------------------

/**
 * Convert selenographic (lat, lon) in degrees → unit vector in scene
 * frame (X=east, Y=north pole, Z=PM).
 */
function selenoToCart(latDeg, lonDeg) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const cl = Math.cos(lat);
  return new THREE.Vector3(
    cl * Math.sin(lon),
    Math.sin(lat),
    cl * Math.cos(lon),
  );
}

function cartToSeleno(v) {
  const lat = Math.asin(Math.max(-1, Math.min(1, v.y))) * RAD2DEG;
  const lon = Math.atan2(v.x, v.z) * RAD2DEG;
  return { lat, lon };
}

/**
 * Lazy-load astronomy-engine the first time OrbitMode is entered. Returns
 * a Promise that resolves to the module, or `null` on import failure (in
 * which case the caller continues with the Meeus-formula fallback).
 */
function ensureAstronomyEngine() {
  if (AE) return Promise.resolve(AE);
  if (aePromise) return aePromise;
  aePromise = import('astronomy-engine')
    .then((mod) => {
      AE = mod;
      console.log('[OrbitMode] astronomy-engine loaded — switched to library ephemeris');
      return mod;
    })
    .catch((err) => {
      console.warn('[OrbitMode] astronomy-engine import failed; using Meeus fallback:', err?.message || err);
      AE = false;
      return null;
    });
  return aePromise;
}

/**
 * Recompute camera/light directions and the almanac snapshot from the
 * given date. Falls back to a low-precision in-house formula if
 * astronomy-engine isn't loaded yet (or failed to load).
 *
 * `opts.snap`: if true, copy targets straight to current vectors (no
 * lerp) — used on enter() so the first frame is correct.
 */
function recomputeOrientation(date, opts = {}) {
  const result = AE ? orientationFromAstronomyEngine(date) : orientationFromMeeus(date);
  state.earthDirTarget.copy(result.earthDir);
  state.sunDirTarget.copy(result.sunDir);
  if (opts.snap) {
    state.earthDir.copy(result.earthDir);
    state.sunDir.copy(result.sunDir);
  }
  // Fold computed values into the almanac, leaving any Dial-A-Moon
  // override fields intact.
  const prev = state.almanac || {};
  state.almanac = {
    ...prev,
    source: prev.dialamoonSource || (AE ? 'astronomy-engine' : 'low-precision'),
    subEarth: cartToSeleno(result.earthDir),
    subSolar: cartToSeleno(result.sunDir),
    phaseAngleDeg: result.phaseAngleDeg ?? prev.phaseAngleDeg,
    illumPct: result.illumPct ?? prev.illumPct,
    distanceKm: result.distanceKm ?? prev.distanceKm,
    diamDeg: result.diamDeg ?? prev.diamDeg,
    phaseName: result.phaseName ?? prev.phaseName,
  };
  renderAlmanac();
}

/**
 * Library-grade orientation. Builds the IAU EQJ→body-fixed rotation from
 * RotationAxis(), then transforms the geocentric Sun−Moon and −Moon
 * vectors into selenographic. Sub-Earth and sub-solar lat/lon emerge
 * directly from the resulting unit vectors.
 */
function orientationFromAstronomyEngine(date) {
  const sun = AE.GeoVector(AE.Body.Sun, date, false);
  const moon = AE.GeoVector(AE.Body.Moon, date, false);
  const sunDirEQJ = new THREE.Vector3(sun.x - moon.x, sun.y - moon.y, sun.z - moon.z).normalize();
  const earthDirEQJ = new THREE.Vector3(-moon.x, -moon.y, -moon.z).normalize();

  // IAU passive transform EQJ → body-fixed (X=PM, Y=90°E, Z=pole):
  //   T = R_z(W) · R_x(π/2 − δ₀) · R_z(π/2 + α₀)
  // Three.js makeRotation* are active rotations. Passive R(θ) = active
  // R(−θ), so we negate every angle to get an active-equivalent matrix
  // that re-expresses an inertial vector in body-fixed components when
  // applied via .applyMatrix4().
  const axis = AE.RotationAxis(AE.Body.Moon, date);
  const alpha0 = axis.ra * 15 * DEG2RAD;     // RA hours → degrees → radians
  const delta0 = axis.dec * DEG2RAD;
  const W = axis.spin * DEG2RAD;
  const m1 = new THREE.Matrix4().makeRotationZ(-(Math.PI / 2 + alpha0));
  const m2 = new THREE.Matrix4().makeRotationX(-(Math.PI / 2 - delta0));
  const m3 = new THREE.Matrix4().makeRotationZ(-W);
  const T = new THREE.Matrix4().multiplyMatrices(m3, m2).multiply(m1);

  const sunBody = sunDirEQJ.clone().applyMatrix4(T);     // body: X=PM, Y=90E, Z=pole
  const earthBody = earthDirEQJ.clone().applyMatrix4(T);

  // Permute body-fixed → scene: scene(X,Y,Z) = body(Y,Z,X). I.e. scene
  // east = body 90°E, scene up = body pole, scene out = body PM.
  const sunDir = new THREE.Vector3(sunBody.y, sunBody.z, sunBody.x).normalize();
  const earthDir = new THREE.Vector3(earthBody.y, earthBody.z, earthBody.x).normalize();

  const ill = AE.Illumination(AE.Body.Moon, date);
  const lib = AE.Libration(date);
  const phase = AE.MoonPhase(date);                       // 0..360
  return {
    sunDir, earthDir,
    phaseAngleDeg: ill.phase_angle,
    illumPct: ill.phase_fraction * 100,
    distanceKm: lib.dist_km,
    diamDeg: lib.diam_deg,
    phaseName: namePhase(phase),
  };
}

/**
 * Meeus-style fallback. Used until astronomy-engine finishes loading,
 * or as a permanent fallback if the import fails. Same formula as v0.1.0
 * — accuracy ~1° in sub-solar longitude, ignores libration and pole tilt
 * (sub-Earth pinned at lat 0, lon 0; sub-solar latitude pinned at 0).
 */
function orientationFromMeeus(date) {
  const jd = (date.getTime() / 86400000) + 2440587.5;
  const d = jd - 2451545.0;
  const Lsun = 280.460 + 0.9856474 * d;
  const gsun = (357.528 + 0.9856003 * d) * DEG2RAD;
  const lamSun = (Lsun + 1.915 * Math.sin(gsun) + 0.020 * Math.sin(2 * gsun)) * DEG2RAD;
  const Lmoon = 218.316 + 13.176396 * d;
  const Mmoon = (134.963 + 13.064993 * d) * DEG2RAD;
  const lamMoon = (Lmoon + 6.289 * Math.sin(Mmoon)) * DEG2RAD;
  let theta = lamSun - lamMoon + Math.PI;
  theta = ((theta % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  // Meeus phase angle (Sun-Moon-Earth angle ≈ 180° − elongation): convert
  // longitudinal phase into illuminated fraction via (1 − cos(θ))/2.
  const phaseLon = ((lamMoon - lamSun) * RAD2DEG + 360) % 360;
  const illum = 0.5 * (1 - Math.cos(phaseLon * DEG2RAD));
  return {
    sunDir: new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta)),
    earthDir: new THREE.Vector3(0, 0, 1),
    phaseAngleDeg: 180 - phaseLon,                    // approximate
    illumPct: illum * 100,
    phaseName: namePhase(phaseLon),
    // distance + diameter not available in the fallback; HUD shows "—"
  };
}

/**
 * Map the longitudinal phase angle (0..360, 0=new, 180=full) to a
 * canonical name. Boundaries at 22.5° intervals around the four cardinal
 * phases — same convention as the SVS Dial-A-Moon labels.
 */
function namePhase(phaseLon) {
  const p = ((phaseLon % 360) + 360) % 360;
  if (p < 22.5)  return 'New Moon';
  if (p < 67.5)  return 'Waxing Crescent';
  if (p < 112.5) return 'First Quarter';
  if (p < 157.5) return 'Waxing Gibbous';
  if (p < 202.5) return 'Full Moon';
  if (p < 247.5) return 'Waning Gibbous';
  if (p < 292.5) return 'Last Quarter';
  if (p < 337.5) return 'Waning Crescent';
  return 'New Moon';
}

// ---- Dial-A-Moon HUD ---------------------------------------------------

/**
 * One-shot fetch of NASA SVS Dial-A-Moon for the current UTC hour. On
 * success, overlays the canonical NASA values onto the almanac (so the
 * displayed phase percentage / distance match the official SVS table).
 * Failure is silent — we already render astronomy-engine values as a
 * fallback. Network access from coolstemgames.com → svs.gsfc.nasa.gov
 * relies on NASA's CORS allowance; if it doesn't fly, the readout simply
 * keeps the library numbers and labels its source accordingly.
 */
async function fetchDialAMoon() {
  try {
    const now = new Date();
    const ts = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}:00`;
    const url = `https://svs.gsfc.nasa.gov/api/dialamoon/${ts}`;
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) {
      console.warn(`[OrbitMode] Dial-A-Moon HTTP ${res.status} — keeping library numbers`);
      return;
    }
    const data = await res.json();
    // Field names per NASA SVS Dial-A-Moon API: `phase` (0..100),
    // `distance` (km), `diameter` (arcsec), `j2000_ra`, `j2000_dec`,
    // `subsolar_lat`, `subsolar_lon`, `subearth_lat`, `subearth_lon`,
    // `posangle`, `image` (URL). Our HUD pulls a subset.
    const prev = state.almanac || {};
    state.almanac = {
      ...prev,
      dialamoonSource: 'NASA SVS Dial-A-Moon',
      source: 'NASA SVS Dial-A-Moon',
      illumPct: numOr(data.phase, prev.illumPct),
      distanceKm: numOr(data.distance, prev.distanceKm),
      // NASA reports diameter in arcseconds; convert to degrees so we
      // share a unit with the astronomy-engine value.
      diamDeg: data.diameter ? data.diameter / 3600 : prev.diamDeg,
      subSolar: (isNum(data.subsolar_lat) && isNum(data.subsolar_lon))
        ? { lat: data.subsolar_lat, lon: data.subsolar_lon }
        : prev.subSolar,
      subEarth: (isNum(data.sub_obs_lat) && isNum(data.sub_obs_lon))
        ? { lat: data.sub_obs_lat, lon: data.sub_obs_lon }
        : (isNum(data.subearth_lat) && isNum(data.subearth_lon)
            ? { lat: data.subearth_lat, lon: data.subearth_lon }
            : prev.subEarth),
      phaseName: prev.phaseName,
    };
    renderAlmanac();
  } catch (err) {
    // Most likely cause: CORS preflight blocked. Not actionable from
    // here, but logged for diagnosis.
    console.warn('[OrbitMode] Dial-A-Moon fetch failed:', err?.message || err);
  }
}

function pad2(n) { return n < 10 ? `0${n}` : `${n}`; }
function isNum(x)  { return typeof x === 'number' && Number.isFinite(x); }
function numOr(x, fallback) { return isNum(x) ? x : fallback; }

function buildAlmanacOverlay() {
  almanacEl = document.createElement('div');
  almanacEl.id = 'orbit-almanac';
  almanacEl.setAttribute('aria-label', 'Lunar almanac');
  almanacEl.style.cssText =
    'position:fixed;bottom:14px;right:14px;z-index:50;' +
    'min-width:260px;max-width:340px;padding:10px 12px;' +
    'background:rgba(2,6,14,0.78);color:#cfd;border:1px solid #2a4a3a;' +
    'border-radius:4px;font:12px ui-monospace,Menlo,Consolas,monospace;' +
    'line-height:1.5;pointer-events:none;backdrop-filter:blur(4px);' +
    '-webkit-backdrop-filter:blur(4px);';
  document.body.appendChild(almanacEl);
  renderAlmanac();
}

function destroyAlmanacOverlay() {
  if (almanacEl?.parentNode) almanacEl.parentNode.removeChild(almanacEl);
  almanacEl = null;
}

function renderAlmanac() {
  if (!almanacEl) return;
  const a = state.almanac;
  if (!a) {
    almanacEl.innerHTML = `<div style="opacity:0.6">LUNAR ALMANAC — loading…</div>`;
    return;
  }
  const fmtPct = isNum(a.illumPct) ? `${a.illumPct.toFixed(1)}%` : '—';
  const fmtKm = isNum(a.distanceKm) ? `${Math.round(a.distanceKm).toLocaleString('en-US')} km` : '—';
  const fmtDiam = isNum(a.diamDeg) ? `${(a.diamDeg * 60).toFixed(1)}′ (${a.diamDeg.toFixed(4)}°)` : '—';
  const fmtLatLon = (p) => p ? `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? 'N' : 'S'} · ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? 'E' : 'W'}` : '—';
  const phaseRow = `<b style="color:#9fe">${a.phaseName || ''}</b>${isNum(a.illumPct) ? ` · ${fmtPct} illuminated` : ''}`;
  almanacEl.innerHTML =
    `<div style="font-weight:bold;color:#9fe;letter-spacing:0.06em;margin-bottom:6px">LUNAR ALMANAC</div>` +
    `<div>${phaseRow}</div>` +
    `<div style="margin-top:4px"><span style="opacity:0.6">DISTANCE  </span>${fmtKm}</div>` +
    `<div><span style="opacity:0.6">APPARENT Ø</span> ${fmtDiam}</div>` +
    `<div><span style="opacity:0.6">SUB-EARTH </span>${fmtLatLon(a.subEarth)}<span style="opacity:0.5"> (libration)</span></div>` +
    `<div><span style="opacity:0.6">SUB-SOLAR </span>${fmtLatLon(a.subSolar)}<span style="opacity:0.5"> (sun overhead)</span></div>` +
    `<div style="margin-top:6px;opacity:0.5;font-size:10.5px">SOURCE · ${a.source || '—'}</div>`;
}

// ---- zoom / input -------------------------------------------------------

function attachZoomListeners() {
  if (!canvasRef) return;
  wheelHandler = (e) => {
    e.preventDefault();
    const factor = (e.deltaY > 0) ? ZOOM_PER_WHEEL_NOTCH : 1 / ZOOM_PER_WHEEL_NOTCH;
    setAltitudeKm((state.altitudeWU / KM_TO_WU) * factor);
  };
  canvasRef.addEventListener('wheel', wheelHandler, { passive: false });

  touchHandlers = {
    start: (e) => {
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        pinchTouches = {
          id1: a.identifier, id2: b.identifier,
          lastDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        };
      }
    },
    move: (e) => {
      if (!pinchTouches || e.touches.length < 2) return;
      e.preventDefault();
      const a = findTouch(e.touches, pinchTouches.id1);
      const b = findTouch(e.touches, pinchTouches.id2);
      if (!a || !b) return;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchTouches.lastDist > 0) {
        const factor = pinchTouches.lastDist / d;
        setAltitudeKm((state.altitudeWU / KM_TO_WU) * factor);
      }
      pinchTouches.lastDist = d;
    },
    end: () => { pinchTouches = null; },
  };
  canvasRef.addEventListener('touchstart',  touchHandlers.start, { passive: true });
  canvasRef.addEventListener('touchmove',   touchHandlers.move,  { passive: false });
  canvasRef.addEventListener('touchend',    touchHandlers.end,   { passive: true });
  canvasRef.addEventListener('touchcancel', touchHandlers.end,   { passive: true });
}

function detachZoomListeners() {
  if (canvasRef && wheelHandler) canvasRef.removeEventListener('wheel', wheelHandler);
  if (canvasRef && touchHandlers) {
    canvasRef.removeEventListener('touchstart',  touchHandlers.start);
    canvasRef.removeEventListener('touchmove',   touchHandlers.move);
    canvasRef.removeEventListener('touchend',    touchHandlers.end);
    canvasRef.removeEventListener('touchcancel', touchHandlers.end);
  }
  wheelHandler = null;
  touchHandlers = null;
  pinchTouches = null;
}

function findTouch(touches, id) {
  for (let i = 0; i < touches.length; i++) {
    if (touches[i].identifier === id) return touches[i];
  }
  return null;
}

function setAltitudeKm(km) {
  const clamped = Math.max(MIN_ALTITUDE_KM, Math.min(MAX_ALTITUDE_KM, km));
  state.altitudeWU = clamped * KM_TO_WU;
  placeCamera();
}

// ---- back button --------------------------------------------------------

function buildBackButton() {
  backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.textContent = '← MAIN MENU';
  backBtn.setAttribute('aria-label', 'Exit lunar stationary orbit view');
  backBtn.style.cssText =
    'position:fixed;top:14px;left:14px;z-index:50;padding:8px 14px;' +
    'background:rgba(0,0,0,0.65);color:#cfd;border:1px solid #4a6;' +
    'border-radius:4px;font:13px ui-monospace,Menlo,Consolas,monospace;' +
    'cursor:pointer;';
  backBtn.addEventListener('click', () => {
    if (onExitCb) onExitCb();
  });
  document.body.appendChild(backBtn);
}

function destroyBackButton() {
  if (backBtn?.parentNode) backBtn.parentNode.removeChild(backBtn);
  backBtn = null;
}
