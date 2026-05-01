// modes/OrbitMode.js — v0.1.0
// Admin-only "Lunar Stationary Orbit" view. Parks the camera ~6,545 km
// off the lunar surface (between Earth and Moon) looking at a textured
// moon sphere against the existing starfield. Lit by the live Sun→Moon
// direction so the visible phase matches today's actual moon phase.
//
// World-unit convention is shared with BakedTerrain.js: 1 WU = 0.6275 m.
// Moon radius and altitude are converted to WU on enter().
//
// Texture sourcing:
//   - moonlander/textures/moon/moon_color_2k.jpg (LROC WAC color, equirect)
//   - moonlander/textures/moon/moon_normal_1k.png (LOLA-derived normal map)
// Both are produced by scripts/bake-moon-globe-textures.mjs from the same
// LDEM/LROC GitHub-Releases assets the per-site bake uses. If either
// texture is missing the mode falls back to a flat gray sphere so admin
// can still verify framing/zoom on a fresh checkout.
//
// Architectural note: the mutable spatial state (camera distance, moon
// rotation, sun-direction cache) lives in a single `state` object so a
// future Phase B can animate any of those fields without touching the
// per-frame render path.

import * as THREE from 'three';
import { getSharedTexture } from '../AssetCache.js';
import { MODE } from '../Constants.js';
import { GameState, notify } from '../GameState.js';

// 1 WU = 0.6275 m. Inverse of METERS_TO_WU = 3.2/2.008. Same constant
// the per-site bakes use in BakedTerrain.js.
const METERS_PER_WU = 2.008 / 3.2;
const KM_TO_WU = 1000 / METERS_PER_WU;

const MOON_RADIUS_KM = 1737.4;
const MOON_RADIUS_WU = MOON_RADIUS_KM * KM_TO_WU;

const INITIAL_ALTITUDE_KM = 6545;          // user-specified parking altitude
const MIN_ALTITUDE_KM     = 200;           // closer than this and the 4k texture pixelates badly
const MAX_ALTITUDE_KM     = 100000;        // far enough that moon is a small disk

const FOV_DEG = 30;                        // moon ~24° across at 6,545 km — 30° leaves comfortable margin
const ZOOM_PER_WHEEL_NOTCH = 1.12;         // multiplicative zoom step per wheel notch

const MOON_COLOR_URL  = 'textures/moon/moon_color_2k.jpg';
const MOON_NORMAL_URL = 'textures/moon/moon_normal_1k.png';

const state = {
  altitudeWU: INITIAL_ALTITUDE_KM * KM_TO_WU,
  moonRotationY: 0,                        // future Phase B will animate this
  sunDirCache: new THREE.Vector3(1, 0, 0), // last computed; lerped each frame
  sunDirTarget: new THREE.Vector3(1, 0, 0),
  lastSunRecompute: 0,
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
let pinchTouches = null;     // {id1, id2, lastDist} | null
let touchHandlers = null;
let disposables = [];
let backBtn = null;
let onExitCb = null;

export const OrbitMode = {
  enter({ renderer, canvas }, opts = {}) {
    console.log('🛰 OrbitMode.enter');
    canvasRef = canvas;
    onExitCb = typeof opts.onExit === 'function' ? opts.onExit : null;

    scene = new THREE.Scene();
    // Reuse the shared starfield texture WalkMode loads — same call,
    // same cache, no second GPU upload.
    const starfield = getSharedTexture('textures/starfield.png');
    if (starfield) {
      starfield.colorSpace = THREE.SRGBColorSpace;
      scene.background = starfield;
    } else {
      scene.background = new THREE.Color(0x000308);
    }

    camera = new THREE.PerspectiveCamera(
      FOV_DEG,
      1,                                    // aspect overwritten by Main.onResize()
      KM_TO_WU * 10,                        // 10 km near clip
      KM_TO_WU * 1_000_000                  // 1,000,000 km far clip — covers max zoom-out
    );
    placeCameraFromAltitude();

    buildMoon();
    buildLights();

    GameState.mode = MODE.MENU;             // park in menu-mode for HUD purposes
    notify('mode');

    attachZoomListeners();
    buildBackButton();

    // Compute the sun direction once on enter so the first frame renders
    // with the correct phase (without waiting for the 1-second throttle).
    state.sunDirTarget.copy(computeSunDirInMoonFixed(new Date()));
    state.sunDirCache.copy(state.sunDirTarget);
    applySunDirection();
  },

  exit() {
    console.log('◀ OrbitMode.exit');
    detachZoomListeners();
    destroyBackButton();
    onExitCb = null;
    for (const d of disposables) {
      d.geometry?.dispose();
      d.material?.dispose();
    }
    // The shared starfield is owned by AssetCache — do NOT dispose it.
    // Color/normal textures ARE mode-owned (we loaded them directly via
    // TextureLoader, not getSharedTexture) so we dispose them here.
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
  },

  update(dt) {
    // Recompute the sun direction at most once per second — the apparent
    // sun moves ~0.5°/hour relative to the moon's surface so per-frame
    // recomputation is wasted work.
    state.lastSunRecompute += dt;
    if (state.lastSunRecompute >= 1.0) {
      state.lastSunRecompute = 0;
      state.sunDirTarget.copy(computeSunDirInMoonFixed(new Date()));
    }
    // Lerp toward target so the light direction doesn't snap on the
    // 1-second cadence. The lerp is slow enough to be invisible but
    // covers a step that would otherwise be perceptible at deep zoom.
    state.sunDirCache.lerp(state.sunDirTarget, Math.min(1, dt * 0.3));
    applySunDirection();

    if (moonMesh) moonMesh.rotation.y = state.moonRotationY;
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

  // Try to load the bake-script outputs. On 404 / load error fall back to
  // a flat-shaded gray sphere so the mode still works on a fresh checkout
  // before someone has run `node scripts/bake-moon-globe-textures.mjs`.
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
  // The LROC equirect texture's prime meridian sits at u=0.5 (image
  // center). Three.js SphereGeometry maps u=0.5 to the -X axis, so a
  // π/2 rotation about Y brings the sub-Earth point to +Z (the camera
  // direction). The sign was chosen so east increases on screen-right
  // when looking from +Z (+X is screen-right after the rotation).
  moonMesh.rotation.y = Math.PI / 2;
  state.moonRotationY = moonMesh.rotation.y;
  scene.add(moonMesh);
  disposables.push({ geometry: geom, material });
}

function buildLights() {
  // Direction-only light. Position is set every frame from the live
  // Sun→Moon direction; intensity 1.5 so the lit limb is bright without
  // blowing out the maria. No shadow casting (one mesh, no occluders).
  sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
  sunLight.position.set(1, 0, 0);          // overwritten per frame
  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Faint fill so the unlit limb isn't pure black — Earthshine, ~1% of
  // direct sunlight in reality. We exaggerate slightly for legibility.
  ambientLight = new THREE.AmbientLight(0x101418, 0.4);
  scene.add(ambientLight);
}

function placeCameraFromAltitude() {
  // Camera sits on the +Z axis from moon center. lookAt(0,0,0) keeps
  // the disk centered. Distance from center = radius + altitude.
  const dist = MOON_RADIUS_WU + state.altitudeWU;
  camera.position.set(0, 0, dist);
  camera.lookAt(0, 0, 0);
}

function applySunDirection() {
  if (!sunLight) return;
  // Three.js DirectionalLight shines from `position` toward `target`.
  // We point `position` along the sun direction (in moon-fixed coords);
  // the magnitude is irrelevant for direction but a large value keeps
  // the math out of float-precision territory.
  const k = MOON_RADIUS_WU * 1000;
  sunLight.position.set(
    state.sunDirCache.x * k,
    state.sunDirCache.y * k,
    state.sunDirCache.z * k,
  );
}

// ---- zoom / input -------------------------------------------------------

function attachZoomListeners() {
  if (!canvasRef) return;
  wheelHandler = (e) => {
    e.preventDefault();
    // Negative deltaY = wheel up = zoom in = smaller altitude.
    const factor = (e.deltaY > 0) ? ZOOM_PER_WHEEL_NOTCH : 1 / ZOOM_PER_WHEEL_NOTCH;
    setAltitudeKm((state.altitudeWU / KM_TO_WU) * factor);
  };
  canvasRef.addEventListener('wheel', wheelHandler, { passive: false });

  // Two-finger pinch on touch. We track only the first two contacts; if
  // a third arrives we ignore it. Using `touchstart`/`move`/`end` rather
  // than gesture events for cross-browser support.
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
        const factor = pinchTouches.lastDist / d;     // pinch-in (d shrinks) = zoom out
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
  placeCameraFromAltitude();
}

// ---- back button --------------------------------------------------------

function buildBackButton() {
  // Inline-styled DOM button rather than a CSS-class addition because the
  // mode is admin-only and unlikely to need theme customization. Lives
  // outside the canvas so its click target survives canvas pointer events.
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

// ---- astronomy ----------------------------------------------------------

/**
 * Low-precision Sun direction in a moon-fixed frame where:
 *   +Z = sub-Earth direction (the near side faces +Z)
 *   +Y = ecliptic north (~moon's spin axis, off by ~1.5° axial tilt — ignored)
 *   +X = +Y × +Z = direction of moon's orbital motion
 *
 * Uses the Meeus-style low-precision Sun longitude formula and a one-term
 * Moon longitude formula. Accuracy: sub-solar longitude within ~1° — good
 * enough that the lit hemisphere clearly matches the day's phase. For
 * Phase B, swap in `astronomy-engine` if you want libration + pole tilt.
 *
 * Returns a unit Vector3.
 */
function computeSunDirInMoonFixed(date) {
  const jd = (date.getTime() / 86400000) + 2440587.5;   // Unix ms → Julian Date
  const d = jd - 2451545.0;                             // days since J2000

  const DEG = Math.PI / 180;

  // Sun's geocentric ecliptic longitude (~0.01° accurate over centuries).
  const Lsun = 280.460 + 0.9856474 * d;
  const gsun = (357.528 + 0.9856003 * d) * DEG;
  const lamSun = (Lsun + 1.915 * Math.sin(gsun) + 0.020 * Math.sin(2 * gsun)) * DEG;

  // Moon's geocentric ecliptic longitude (one-term ≈ 0.5° accurate — fine
  // for a phase visualization).
  const Lmoon = 218.316 + 13.176396 * d;
  const Mmoon = (134.963 + 13.064993 * d) * DEG;
  const lamMoon = (Lmoon + 6.289 * Math.sin(Mmoon)) * DEG;

  // Sub-solar selenographic longitude, measured from the sub-Earth point.
  // At full moon (lamSun ≈ lamMoon ± π) this is 0 → near side fully lit.
  // At new moon (lamSun ≈ lamMoon)        this is ±π → far side lit.
  let theta = lamSun - lamMoon + Math.PI;
  // Normalize to [-π, π] for numerical stability of sin/cos at large d.
  theta = ((theta % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

  // Ecliptic latitude of sun is ≤ ~0° (sun stays on ecliptic). We ignore
  // the moon's ~5° orbital tilt + ~1.5° axial tilt — the resulting
  // sub-solar latitude excursion is small enough that the visible phase
  // looks correct at orbit distance.
  return new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta));
}
