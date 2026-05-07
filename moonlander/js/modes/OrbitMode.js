// modes/OrbitMode.js — v0.3.0
// Admin-only "Lunar Stationary Orbit" view. The moon is stationary at
// scene origin; the camera orbits around it. Lit by the live Sun→Moon
// vector (astronomy-engine), so the visible phase tracks today's geometry.
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
// Camera control (v0.3.0):
//   - Mouse drag / single-finger touch  → orbit (yaw + pitch)
//   - Mouse wheel / two-finger pinch    → zoom (altitude)
//   - On enter, yaw/pitch initialize to the live sub-Earth point so the
//     opening view matches what an Earth observer sees today (libration
//     and all). Once the user drags, the camera is fully theirs — the
//     library-computed sub-Earth direction stops moving the camera and
//     only feeds the HUD almanac readout.
//
// Sun lighting is camera-independent — a DirectionalLight pointed at
// the live sub-solar selenographic point (recomputed once/sec). When
// the user orbits to the far side, they see an unlit hemisphere; when
// over the near-side terminator they see today's phase shadow line.
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

// True scale for the companion bodies. The Sun lives ~1 AU from the
// Earth-Moon system; Earth ~384,400 km from the Moon (libration brings
// it ~363k–405k km). At our orbit altitude these subtend Earth ≈ 1.9°
// and Sun ≈ 0.53° — both visible discs with relative sizes that match
// what you'd see standing on the Moon. Far clip is extended below to
// accommodate the Sun's true distance.
const SUN_RADIUS_KM   = 696340;
const EARTH_RADIUS_KM = 6371;
const SUN_RADIUS_WU   = SUN_RADIUS_KM   * KM_TO_WU;
const EARTH_RADIUS_WU = EARTH_RADIUS_KM * KM_TO_WU;
const KM_PER_AU       = 149597870.7;

const INITIAL_ALTITUDE_KM = 6545;
const MIN_ALTITUDE_KM     = 200;
const MAX_ALTITUDE_KM     = 100000;

const FOV_DEG = 30;
const ZOOM_PER_WHEEL_NOTCH = 1.12;

// Drag-to-orbit tuning. 0.005 rad/px ≈ 0.286°/px — a horizontal sweep of
// ~1250 px gives a full 360° rotation, which feels natural across mouse
// and touch without losing precision near the poles. Pitch clamped at
// ±85° avoids gimbal lock at the singularity where the camera looks
// straight down the +Y axis (lookAt becomes ambiguous with up=+Y).
const ORBIT_RAD_PER_PX = 0.005;
const PITCH_MAX_RAD    = 85 * Math.PI / 180;

const MOON_COLOR_URL  = 'textures/moon/moon_color_2k.jpg';
const MOON_NORMAL_URL = 'textures/moon/moon_normal_1k.png';
const STARFIELD_URL   = 'assets/starfield.json';

// Stars are placed at this radius in scene WU (just inside the camera
// far clip of 3 AU). Three magnitude buckets render at three sizes so
// brightness reads correctly without per-vertex shader uniforms.
const STAR_DISTANCE_AU = 2.8;

// Texture / pole calibration. The LROC mosaic + Three.js SphereGeometry
// default UV mapping pin the texture's prime meridian to a particular
// world axis, but the actual selenographic 0,0 may be off by small
// angles depending on the source bake. These three are the *baked-in
// defaults* — set to whatever values you dial in via the in-mode
// CALIBRATE panel and then commit. The panel's localStorage override
// shadows these at runtime so iteration doesn't need a code change.
const CALIBRATION_DEFAULTS = {
  textureLonOffsetDeg: 0,    // additional Y rotation of moon mesh (+ shifts texture east)
  textureLatOffsetDeg: 0,    // additional X rotation of moon mesh (+ tilts top toward camera)
  textureRollDeg:      0,    // additional Z rotation of moon mesh (+ rolls clockwise)
};
const CALIBRATION_LS_KEY = 'moonlander.orbitCalibration';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Cached astronomy-engine module (resolved on first OrbitMode.enter()).
// `null` means not-yet-attempted; `false` means tried-and-failed.
let AE = null;
let aePromise = null;

// EQJ → selenographic-scene rotation matrix from the latest astronomy-
// engine ephemeris. Applied to every starfield Points object so the
// catalog vertex buffer (built once in EQJ) renders in the correct
// scene orientation. `null` when astronomy-engine hasn't loaded yet —
// stars stay hidden during that window.
let sceneToEQJMatrix = null;

const state = {
  altitudeWU: INITIAL_ALTITUDE_KM * KM_TO_WU,
  // Camera orbit angles (selenographic): yawRad measured from +Z toward
  // +X (east), pitchRad from equator toward +Y (north). Initialized to
  // (0,0) — straight at the prime meridian — and updated on enter() to
  // the live sub-Earth point once astronomy-engine resolves. After the
  // first user drag, `userControlsCamera` flips and library updates no
  // longer overwrite the angles.
  yawRad: 0,
  pitchRad: 0,
  userControlsCamera: false,
  lastOrientationRecompute: 0,
  // Sun direction (selenographic) is still smoothed across the
  // once-per-second recompute boundary so deep-zoom views don't jolt.
  sunDir: new THREE.Vector3(1, 0, 0),
  sunDirTarget: new THREE.Vector3(1, 0, 0),
  // Latest almanac snapshot for the HUD readout.
  almanac: null,
};

let scene = null;
let camera = null;
let moonMesh = null;
let sunMesh = null;
let earthSprite = null;
let sunLight = null;
let ambientLight = null;
let colorTex = null;
let normalTex = null;
let starfields = [];      // array of THREE.Points, one per magnitude bucket
let canvasRef = null;
let wheelHandler = null;
let pointerHandlers = null;
let activePointers = null;       // Map<pointerId, {x, y}>
let lastPinchDist = 0;           // px distance between two pointers, last frame
let disposables = [];
let backBtn = null;
let resetBtn = null;
let calibrateBtn = null;
let calibratePanel = null;
let almanacEl = null;
let calibration = { ...CALIBRATION_DEFAULTS };
let onExitCb = null;

export const OrbitMode = {
  enter({ renderer, canvas }, opts = {}) {
    console.log('🛰 OrbitMode.enter');
    canvasRef = canvas;
    onExitCb = typeof opts.onExit === 'function' ? opts.onExit : null;
    loadCalibration();

    scene = new THREE.Scene();
    // Deep-space black (a hint of blue for atmospheric haze, even though
    // the moon has no atmosphere — pure 0x000000 reads as "broken" to
    // most viewers). Real stars from the BSC5 catalog are drawn in front
    // of this in buildStarfield(), and they rotate with the scene's
    // EQJ→selenographic transform so the sky tracks real-time geometry.
    scene.background = new THREE.Color(0x000208);

    // Far clip pushed out to ~3 AU so the Sun (at 1 AU from the moon)
    // sits comfortably inside the frustum no matter where the user
    // orbits. Float32 precision degrades at coordinates this large
    // (~15 km absolute resolution at 1 AU), but the Sun's apparent
    // disc is 696,000 km wide so any positional jitter is sub-pixel.
    camera = new THREE.PerspectiveCamera(
      FOV_DEG, 1,
      KM_TO_WU * 10,
      KM_TO_WU * KM_PER_AU * 3,
    );

    buildMoon();
    buildSun();
    buildEarth();
    buildLights();
    // Stars are a fire-and-forget async fetch — they appear when ready
    // and are invisible until the first orientation matrix is applied.
    buildStarfield();

    GameState.mode = MODE.MENU;
    notify('mode');

    attachInputListeners();
    buildBackButton();
    buildResetButton();
    buildCalibrateButton();
    buildAlmanacOverlay();

    // Kick off the lazy load. When it resolves we'll snap the camera
    // angles to the canonical sub-Earth view if the user hasn't grabbed
    // control yet.
    ensureAstronomyEngine().then(() => {
      if (!state.userControlsCamera) {
        recomputeOrientation(new Date(), { snap: true, alignCamera: true });
      }
    });
    // Compute orientation immediately so lighting + almanac are correct
    // on frame 0. With the Meeus fallback the camera defaults to (0,0,
    // 0,0) — the canonical zero-libration view; once astronomy-engine
    // lands a few hundred ms later, the .then() above corrects the angles.
    recomputeOrientation(new Date(), { snap: true, alignCamera: true });
    placeCamera();
    applyLight();
    fetchDialAMoon();   // fire-and-forget; populates HUD on success
  },

  exit() {
    console.log('◀ OrbitMode.exit');
    detachInputListeners();
    destroyBackButton();
    destroyResetButton();
    destroyCalibrateUI();
    destroyAlmanacOverlay();
    onExitCb = null;
    for (const d of disposables) {
      d.geometry?.dispose();
      d.material?.dispose();
    }
    colorTex?.dispose();
    normalTex?.dispose();
    disposables = [];
    starfields = [];
    sceneToEQJMatrix = null;
    scene = null;
    camera = null;
    moonMesh = null;
    sunMesh = null;
    earthSprite = null;
    sunLight = null;
    ambientLight = null;
    colorTex = null;
    normalTex = null;
    canvasRef = null;
    state.almanac = null;
    // Reset orbit / pointer state so a re-enter starts at the canonical
    // libration-corrected view rather than wherever the previous session
    // left off.
    state.yawRad = 0;
    state.pitchRad = 0;
    state.userControlsCamera = false;
  },

  update(dt) {
    state.lastOrientationRecompute += dt;
    if (state.lastOrientationRecompute >= 1.0) {
      state.lastOrientationRecompute = 0;
      // The HUD needs the up-to-date sub-Earth point for the libration
      // readout; the camera doesn't follow it once the user has grabbed
      // control.
      recomputeOrientation(new Date(), { snap: false, alignCamera: false });
    }
    state.sunDir.lerp(state.sunDirTarget, Math.min(1, dt * 0.3)).normalize();
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
  // u=0.5 → +Z, u=0.75 (lon=+90°, east) → +X. The CALIBRATION_*
  // offsets compose on top of this so per-deployment misalignments
  // can be dialed in via the in-mode CALIBRATE panel.
  applyMoonRotation();
  scene.add(moonMesh);
  disposables.push({ geometry: geom, material });
}

/**
 * Compose the base -π/2 Y rotation with the runtime calibration deltas
 * and write it to the moon mesh. Order: Y(base+lon) · X(lat) · Z(roll),
 * applied as an Euler with order 'YXZ' so the Y rotation runs in the
 * scene's selenographic frame (not after the lat/roll tilts).
 */
function applyMoonRotation() {
  if (!moonMesh) return;
  const lon = -Math.PI / 2 + calibration.textureLonOffsetDeg * DEG2RAD;
  const lat = calibration.textureLatOffsetDeg * DEG2RAD;
  const roll = calibration.textureRollDeg * DEG2RAD;
  moonMesh.rotation.set(lat, lon, roll, 'YXZ');
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

function buildSun() {
  // Self-luminous sphere (MeshBasicMaterial — ignores scene lights). The
  // ~696,000 km radius is rendered at true scale; at 1 AU it subtends
  // ~0.53° from the moon, the same apparent size you'd see standing
  // there. We do NOT make the directional light's position track the
  // sun mesh; the light stays at small selenographic-scale coords to
  // avoid Float32 precision artifacts when computing shadow / view
  // matrices. Light direction matches the sun's direction either way.
  const geom = new THREE.SphereGeometry(SUN_RADIUS_WU, 32, 24);
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  sunMesh = new THREE.Mesh(geom, mat);
  scene.add(sunMesh);
  disposables.push({ geometry: geom, material: mat });
}

/**
 * Build the bright-star starfield from the baked BSC5 JSON. Each star's
 * (RA, Dec) is converted to a unit vector in J2000 equatorial (EQJ) and
 * scaled to STAR_DISTANCE_AU. The resulting Points objects sit in EQJ
 * orientation in the scene; per-second updates apply an EQJ→selenographic
 * rotation matrix to all of them at once, so the sky stays real-time
 * accurate as the moon's pole drifts (and as the user orbits, since the
 * camera moves but the stars don't, which is correct).
 *
 * Three magnitude buckets render at three sizes — Three.js PointsMaterial
 * has a single uniform size, so we use multiple Points objects rather
 * than a custom shader. Cheap and avoids per-star uniforms.
 */
async function buildStarfield() {
  let stars;
  try {
    const res = await fetch(STARFIELD_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    stars = await res.json();
  } catch (err) {
    console.warn('[OrbitMode] starfield.json failed to load — sky will be empty:', err?.message || err);
    return;
  }
  if (!Array.isArray(stars) || !stars.length) return;
  // Race: enter() may have completed and exit() been called while this
  // fetch was in-flight. Bail if the scene has already been torn down.
  if (!scene) return;

  const distance = STAR_DISTANCE_AU * KM_PER_AU * KM_TO_WU;

  // Magnitude buckets. Sized so the brightest stars are clearly visible
  // (Sirius, Canopus, Vega, etc.) and naked-eye-faint stars are pinprick
  // backdrops. sizeAttenuation:false locks each bucket's pixel size
  // regardless of camera distance — astronomically correct for sources
  // at infinity.
  const buckets = [
    { range: [-Infinity, 1.5], size: 3.5, color: 0xffffff },
    { range: [1.5, 3.5],       size: 2.0, color: 0xfafaff },
    { range: [3.5, 6.0],       size: 1.0, color: 0xddddee },
  ];
  for (const b of buckets) {
    const positions = [];
    for (const [ra, dec, mag] of stars) {
      if (mag < b.range[0] || mag >= b.range[1]) continue;
      const raR = ra * DEG2RAD;
      const decR = dec * DEG2RAD;
      const cd = Math.cos(decR);
      // EQJ unit vector: +Z = celestial north pole, +X = vernal equinox.
      const x = cd * Math.cos(raR);
      const y = cd * Math.sin(raR);
      const z = Math.sin(decR);
      positions.push(x * distance, y * distance, z * distance);
    }
    if (!positions.length) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: b.color,
      size: b.size,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,            // stars never occlude each other
    });
    const points = new THREE.Points(geom, mat);
    points.matrixAutoUpdate = false;          // we manage `matrix` directly
    points.visible = !!sceneToEQJMatrix;      // stay hidden until the first valid matrix lands
    if (sceneToEQJMatrix) points.matrix.copy(sceneToEQJMatrix);
    scene.add(points);
    starfields.push(points);
    disposables.push({ geometry: geom, material: mat });
  }
  console.log(`[OrbitMode] starfield: ${stars.length} stars in ${starfields.length} buckets`);
}

function buildEarth() {
  // The repo's existing earth.png is a transparent-corner round icon —
  // designed for billboarding, not equirectangular sphere wrapping. So
  // we use it on a Sprite, which is camera-facing and gets the texture
  // shape "for free." Sprite scale is its world-space size; setting it
  // to 2 × Earth radius makes the apparent angular size correct.
  const tex = getSharedTexture('textures/earth.png');
  if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex || null,
    color: tex ? 0xffffff : 0x4a7fbf,
    transparent: true,
    depthTest: true,
    depthWrite: false,            // sprites with alpha shouldn't fight z-buffer
  });
  earthSprite = new THREE.Sprite(mat);
  earthSprite.scale.set(EARTH_RADIUS_WU * 2, EARTH_RADIUS_WU * 2, 1);
  scene.add(earthSprite);
  disposables.push({ material: mat });   // SpriteMaterial; geometry is shared
}

function placeCamera() {
  if (!camera) return;
  const dist = MOON_RADIUS_WU + state.altitudeWU;
  // (yaw, pitch) → cartesian on a sphere. yaw=0,pitch=0 places the
  // camera on +Z (canonical sub-Earth view).
  const cp = Math.cos(state.pitchRad), sp = Math.sin(state.pitchRad);
  const cy = Math.cos(state.yawRad),   sy = Math.sin(state.yawRad);
  camera.position.set(cp * sy * dist, sp * dist, cp * cy * dist);
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
 * Recompute light direction and almanac from the given date. Optionally
 * also aligns the camera angles to the live sub-Earth point — used on
 * enter() (and again when astronomy-engine resolves) so the opening view
 * matches what a real Earth observer sees today. Once the user drags,
 * `state.userControlsCamera` flips and this function stops touching the
 * angles regardless of `alignCamera`.
 *
 * `opts.snap`        — if true, copy sun-dir target straight to current (no lerp)
 * `opts.alignCamera` — if true and !userControlsCamera, snap yaw/pitch to sub-Earth
 */
function recomputeOrientation(date, opts = {}) {
  const result = AE ? orientationFromAstronomyEngine(date) : orientationFromMeeus(date);
  state.sunDirTarget.copy(result.sunDir);
  if (opts.snap) state.sunDir.copy(result.sunDir);
  if (opts.alignCamera && !state.userControlsCamera) {
    state.pitchRad = Math.asin(Math.max(-1, Math.min(1, result.earthDir.y)));
    state.yawRad   = Math.atan2(result.earthDir.x, result.earthDir.z);
  }
  // Place the Sun and Earth at their true distances. Both move slowly
  // enough relative to the camera that a per-second update is invisible.
  if (sunMesh && isNum(result.sunDistKm)) {
    const d = result.sunDistKm * KM_TO_WU;
    sunMesh.position.set(result.sunDir.x * d, result.sunDir.y * d, result.sunDir.z * d);
  }
  if (earthSprite && isNum(result.earthDistKm)) {
    const d = result.earthDistKm * KM_TO_WU;
    earthSprite.position.set(result.earthDir.x * d, result.earthDir.y * d, result.earthDir.z * d);
  }
  // Apply the EQJ→selenographic rotation to every star Points object.
  // The rotation matrix only exists when astronomy-engine has loaded
  // (Meeus fallback doesn't compute moon-pole orientation), so the
  // starfield stays hidden in the fallback window.
  if (result.eqjToSceneMatrix) {
    sceneToEQJMatrix = result.eqjToSceneMatrix;
    for (const points of starfields) {
      points.matrix.copy(sceneToEQJMatrix);
      points.matrixWorldNeedsUpdate = true;
      points.visible = true;
    }
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
    sunDistKm: result.sunDistKm ?? prev.sunDistKm,
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
  const sunFromMoonAU = new THREE.Vector3(sun.x - moon.x, sun.y - moon.y, sun.z - moon.z);
  const earthFromMoonAU = new THREE.Vector3(-moon.x, -moon.y, -moon.z);
  const sunDistKm   = sunFromMoonAU.length() * KM_PER_AU;
  const earthDistKm = earthFromMoonAU.length() * KM_PER_AU;
  const sunDirEQJ   = sunFromMoonAU.clone().normalize();
  const earthDirEQJ = earthFromMoonAU.clone().normalize();

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

  // Permutation body-fixed → scene: scene(X,Y,Z) = body(Y,Z,X). I.e.
  // scene east = body 90°E, scene up = body pole, scene out = body PM.
  // Composing P·T into a single Matrix4 gives the EQJ→scene rotation
  // we apply to the starfield Points buffer (computed once in EQJ).
  const P = new THREE.Matrix4().set(
    0, 1, 0, 0,
    0, 0, 1, 0,
    1, 0, 0, 0,
    0, 0, 0, 1,
  );
  const eqjToScene = new THREE.Matrix4().multiplyMatrices(P, T);

  const sunDir = sunDirEQJ.clone().applyMatrix4(eqjToScene).normalize();
  const earthDir = earthDirEQJ.clone().applyMatrix4(eqjToScene).normalize();

  const ill = AE.Illumination(AE.Body.Moon, date);
  const lib = AE.Libration(date);
  const phase = AE.MoonPhase(date);                       // 0..360
  return {
    sunDir, earthDir,
    eqjToSceneMatrix: eqjToScene,
    sunDistKm,
    earthDistKm: lib.dist_km,    // canonical Moon→Earth distance from Libration()
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
    sunDistKm: KM_PER_AU,            // 1 AU annual mean — Earth's eccentricity ignored
    earthDistKm: 384400,             // mean Earth-Moon distance — orbital eccentricity ignored
    phaseAngleDeg: 180 - phaseLon,
    illumPct: illum * 100,
    phaseName: namePhase(phaseLon),
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
  const fmtSunKm = isNum(a.sunDistKm)
    ? `${(a.sunDistKm / 1e6).toFixed(2)} M km (${(a.sunDistKm / KM_PER_AU).toFixed(4)} AU)`
    : '—';
  const fmtDiam = isNum(a.diamDeg) ? `${(a.diamDeg * 60).toFixed(1)}′ (${a.diamDeg.toFixed(4)}°)` : '—';
  const fmtLatLon = (p) => p ? `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? 'N' : 'S'} · ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? 'E' : 'W'}` : '—';
  const phaseRow = `<b style="color:#9fe">${a.phaseName || ''}</b>${isNum(a.illumPct) ? ` · ${fmtPct} illuminated` : ''}`;
  almanacEl.innerHTML =
    `<div style="font-weight:bold;color:#9fe;letter-spacing:0.06em;margin-bottom:6px">LUNAR ALMANAC</div>` +
    `<div>${phaseRow}</div>` +
    `<div style="margin-top:4px"><span style="opacity:0.6">EARTH DIST</span> ${fmtKm}</div>` +
    `<div><span style="opacity:0.6">SUN DIST  </span>${fmtSunKm}</div>` +
    `<div><span style="opacity:0.6">APPARENT Ø</span> ${fmtDiam}</div>` +
    `<div><span style="opacity:0.6">SUB-EARTH </span>${fmtLatLon(a.subEarth)}<span style="opacity:0.5"> (libration)</span></div>` +
    `<div><span style="opacity:0.6">SUB-SOLAR </span>${fmtLatLon(a.subSolar)}<span style="opacity:0.5"> (sun overhead)</span></div>` +
    `<div style="margin-top:6px;opacity:0.5;font-size:10.5px">SOURCE · ${a.source || '—'}</div>`;
}

// ---- zoom / orbit input -------------------------------------------------
//
// Pointer Events API unifies mouse + touch + pen behind one code path.
// One pointer = drag-to-orbit; two pointers = pinch-to-zoom. The mouse
// wheel also zooms (kept for desktop ergonomics). `touch-action: none`
// on the canvas suppresses the browser's default pinch-zoom + scroll so
// our handlers see every gesture cleanly.

function attachInputListeners() {
  if (!canvasRef) return;

  wheelHandler = (e) => {
    e.preventDefault();
    const factor = (e.deltaY > 0) ? ZOOM_PER_WHEEL_NOTCH : 1 / ZOOM_PER_WHEEL_NOTCH;
    setAltitudeKm((state.altitudeWU / KM_TO_WU) * factor);
  };
  canvasRef.addEventListener('wheel', wheelHandler, { passive: false });

  activePointers = new Map();
  lastPinchDist = 0;

  pointerHandlers = {
    down: (e) => {
      // Ignore non-primary mouse buttons; let context menus & browser
      // gestures keep their normal meaning. Touch and pen always primary.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (typeof canvasRef.setPointerCapture === 'function') {
        try { canvasRef.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 1) {
        canvasRef.style.cursor = 'grabbing';
      }
      if (activePointers.size === 2) {
        const [a, b] = [...activePointers.values()];
        lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      e.preventDefault();
    },
    move: (e) => {
      const prev = activePointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 1) {
        // Single-pointer drag → orbit yaw/pitch.
        // Sign convention chosen so the moon under the cursor moves with
        // the cursor: dragging right swings the camera left around the
        // moon, which makes the moon visually slide right.
        state.yawRad   -= dx * ORBIT_RAD_PER_PX;
        state.pitchRad += dy * ORBIT_RAD_PER_PX;
        state.pitchRad = Math.max(-PITCH_MAX_RAD, Math.min(PITCH_MAX_RAD, state.pitchRad));
        // First user input "claims" the camera — library libration
        // updates stop nudging it after this point.
        state.userControlsCamera = true;
        placeCamera();
      } else if (activePointers.size >= 2) {
        // Two-pointer pinch → zoom.
        const [a, b] = [...activePointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinchDist > 0 && d > 0) {
          const factor = lastPinchDist / d;
          setAltitudeKm((state.altitudeWU / KM_TO_WU) * factor);
        }
        lastPinchDist = d;
      }
      e.preventDefault();
    },
    up: (e) => {
      activePointers.delete(e.pointerId);
      if (typeof canvasRef.releasePointerCapture === 'function') {
        try { canvasRef.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      if (activePointers.size < 2) lastPinchDist = 0;
      if (activePointers.size === 0) canvasRef.style.cursor = 'grab';
    },
  };

  canvasRef.style.touchAction = 'none';
  canvasRef.style.cursor = 'grab';
  canvasRef.addEventListener('pointerdown',   pointerHandlers.down);
  canvasRef.addEventListener('pointermove',   pointerHandlers.move);
  canvasRef.addEventListener('pointerup',     pointerHandlers.up);
  canvasRef.addEventListener('pointercancel', pointerHandlers.up);
  canvasRef.addEventListener('pointerleave',  pointerHandlers.up);
  // Block the browser's default right-click menu while in this mode —
  // future work may want middle-drag for pan, etc.
  canvasRef.addEventListener('contextmenu', preventContextMenu);
}

function preventContextMenu(e) { e.preventDefault(); }

function detachInputListeners() {
  if (canvasRef && wheelHandler) {
    canvasRef.removeEventListener('wheel', wheelHandler);
  }
  if (canvasRef && pointerHandlers) {
    canvasRef.removeEventListener('pointerdown',   pointerHandlers.down);
    canvasRef.removeEventListener('pointermove',   pointerHandlers.move);
    canvasRef.removeEventListener('pointerup',     pointerHandlers.up);
    canvasRef.removeEventListener('pointercancel', pointerHandlers.up);
    canvasRef.removeEventListener('pointerleave',  pointerHandlers.up);
    canvasRef.removeEventListener('contextmenu', preventContextMenu);
    canvasRef.style.touchAction = '';
    canvasRef.style.cursor = '';
  }
  wheelHandler = null;
  pointerHandlers = null;
  activePointers = null;
  lastPinchDist = 0;
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

function buildResetButton() {
  // Snap-back to the canonical Earth-observer view: clears
  // userControlsCamera so the live sub-Earth point reclaims the angles,
  // then forces an orientation recompute with alignCamera. After this,
  // libration tracking resumes — the next per-second tick will keep
  // refining as the moon's wobble continues.
  resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = '⌖ RESET VIEW';
  resetBtn.setAttribute('aria-label', 'Reset to default Earth-observer view');
  resetBtn.style.cssText =
    'position:fixed;top:14px;left:160px;z-index:50;padding:8px 14px;' +
    'background:rgba(0,0,0,0.65);color:#cfd;border:1px solid #4a6;' +
    'border-radius:4px;font:13px ui-monospace,Menlo,Consolas,monospace;' +
    'cursor:pointer;';
  resetBtn.addEventListener('click', () => {
    state.userControlsCamera = false;
    state.altitudeWU = INITIAL_ALTITUDE_KM * KM_TO_WU;
    recomputeOrientation(new Date(), { snap: true, alignCamera: true });
    placeCamera();
    applyLight();
  });
  document.body.appendChild(resetBtn);
}

function destroyResetButton() {
  if (resetBtn?.parentNode) resetBtn.parentNode.removeChild(resetBtn);
  resetBtn = null;
}

// ---- calibration panel --------------------------------------------------
//
// Exposes three nudge sliders (lon offset, lat offset, roll) that compose
// on top of the base -π/2 Y rotation of the moon mesh. Lets the operator
// align surface features against a reference image without touching code,
// then copy the resulting JSON back into CALIBRATION_DEFAULTS for a
// permanent bake. localStorage backs the live tuning so reloads don't
// lose progress.

function loadCalibration() {
  calibration = { ...CALIBRATION_DEFAULTS };
  try {
    const raw = localStorage.getItem(CALIBRATION_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    for (const k of Object.keys(CALIBRATION_DEFAULTS)) {
      if (typeof parsed[k] === 'number' && Number.isFinite(parsed[k])) {
        calibration[k] = parsed[k];
      }
    }
  } catch (_) { /* fall back to defaults */ }
}

function saveCalibration() {
  try { localStorage.setItem(CALIBRATION_LS_KEY, JSON.stringify(calibration)); }
  catch (_) { /* private mode etc. — calibration just doesn't persist */ }
}

function buildCalibrateButton() {
  calibrateBtn = document.createElement('button');
  calibrateBtn.type = 'button';
  calibrateBtn.textContent = '🔧 CALIBRATE';
  calibrateBtn.setAttribute('aria-label', 'Open texture calibration panel');
  calibrateBtn.style.cssText =
    'position:fixed;top:54px;left:14px;z-index:50;padding:8px 14px;' +
    'background:rgba(0,0,0,0.65);color:#cfd;border:1px solid #4a6;' +
    'border-radius:4px;font:13px ui-monospace,Menlo,Consolas,monospace;' +
    'cursor:pointer;';
  calibrateBtn.addEventListener('click', toggleCalibratePanel);
  document.body.appendChild(calibrateBtn);
}

function toggleCalibratePanel() {
  if (calibratePanel) {
    destroyCalibratePanel();
  } else {
    buildCalibratePanel();
  }
}

function buildCalibratePanel() {
  calibratePanel = document.createElement('div');
  calibratePanel.style.cssText =
    'position:fixed;top:100px;left:14px;z-index:50;width:min(340px,calc(100vw - 28px));' +
    'padding:12px 14px;background:rgba(2,6,14,0.92);color:#cfd;' +
    'border:1px solid #2a4a3a;border-radius:4px;' +
    'font:12px ui-monospace,Menlo,Consolas,monospace;line-height:1.55;' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';

  const sliders = [
    { key: 'textureLonOffsetDeg', label: 'LON offset (east+)', min: -180, max: 180, step: 0.25 },
    { key: 'textureLatOffsetDeg', label: 'LAT offset (north+)', min: -45,  max: 45,  step: 0.25 },
    { key: 'textureRollDeg',      label: 'ROLL (cw+)',          min: -45,  max: 45,  step: 0.25 },
  ];

  let html =
    `<div style="font-weight:bold;color:#9fe;letter-spacing:0.06em;margin-bottom:8px">` +
    `MOON CALIBRATION` +
    `</div>` +
    `<div style="opacity:0.65;font-size:10.5px;margin-bottom:8px">` +
    `Nudge until the visible features match a reference moon image, then ` +
    `copy values to bake.` +
    `</div>`;
  for (const s of sliders) {
    const v = calibration[s.key];
    html +=
      `<label style="display:block;margin-bottom:6px">` +
      `<div style="display:flex;justify-content:space-between"><span>${s.label}</span>` +
      `<span data-readout="${s.key}">${v.toFixed(2)}°</span></div>` +
      `<input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" ` +
        `value="${v}" style="width:100%;accent-color:#5d9">` +
      `</label>`;
  }
  html +=
    `<div style="display:flex;gap:8px;margin-top:8px">` +
    `<button data-action="copy"  style="flex:1;padding:6px;background:#152;color:#cfd;border:1px solid #4a6;border-radius:3px;cursor:pointer;font:inherit">📋 COPY</button>` +
    `<button data-action="reset" style="flex:1;padding:6px;background:#211;color:#fcc;border:1px solid #a44;border-radius:3px;cursor:pointer;font:inherit">RESET</button>` +
    `</div>` +
    `<div data-status style="margin-top:8px;opacity:0.7;font-size:10.5px;min-height:1em"></div>`;
  calibratePanel.innerHTML = html;

  // Wire sliders
  calibratePanel.querySelectorAll('input[type="range"]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.key;
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      calibration[key] = v;
      const readout = calibratePanel.querySelector(`[data-readout="${key}"]`);
      if (readout) readout.textContent = `${v.toFixed(2)}°`;
      applyMoonRotation();
      saveCalibration();
    });
  });

  // Wire buttons
  calibratePanel.querySelector('[data-action="copy"]').addEventListener('click', async () => {
    const text = JSON.stringify(calibration, null, 2);
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (_) { /* fall through */ }
    const status = calibratePanel.querySelector('[data-status]');
    if (status) status.textContent = ok ? '✅ Copied to clipboard' : '⚠️ Couldn\'t access clipboard — check console';
    if (!ok) console.log('[OrbitMode] calibration values:\n' + text);
  });
  calibratePanel.querySelector('[data-action="reset"]').addEventListener('click', () => {
    calibration = { ...CALIBRATION_DEFAULTS };
    saveCalibration();
    applyMoonRotation();
    // Refresh slider positions + readouts
    calibratePanel.querySelectorAll('input[type="range"]').forEach((input) => {
      const v = calibration[input.dataset.key];
      input.value = v;
      const readout = calibratePanel.querySelector(`[data-readout="${input.dataset.key}"]`);
      if (readout) readout.textContent = `${v.toFixed(2)}°`;
    });
    const status = calibratePanel.querySelector('[data-status]');
    if (status) status.textContent = '↺ Reset to baked defaults';
  });

  document.body.appendChild(calibratePanel);
}

function destroyCalibratePanel() {
  if (calibratePanel?.parentNode) calibratePanel.parentNode.removeChild(calibratePanel);
  calibratePanel = null;
}

function destroyCalibrateUI() {
  destroyCalibratePanel();
  if (calibrateBtn?.parentNode) calibrateBtn.parentNode.removeChild(calibrateBtn);
  calibrateBtn = null;
}
