// Main.js — v0.1.0
// Entry point. Owns the renderer, the frame loop, and the current mode.
// Everything else is in modules under /js.
//
// Architecture:
//   - Single WebGLRenderer shared across all modes (no lazy-load, no dispose).
//   - One "current mode" at a time. Swapping modes = currentMode.exit() then
//     nextMode.enter(), with an optional TransitionMode in between for polish.
//   - GameState (shared store) survives mode switches untouched.
//   - HUD is DOM, also survives mode switches.
//
// Changelog:
//   0.1.0 — Initial skeleton. LanderMode playable (stub terrain collision),
//           WalkMode walkable, cinematic TransitionMode wired between them.
//           Particles, sounds, textures, and proper collision are stubbed.

import * as THREE from 'three';
import { MODE } from './Constants.js';
import { GameState, notify, load as loadSave } from './GameState.js';
import { initInput } from './Input.js';
import { initSound } from './Sound.js';
import { initHUD, renderFrame as renderHUDFrame } from './HUD.js';
import { LanderMode }     from './modes/LanderMode.js';
import { WalkMode }       from './modes/WalkMode.js';
import { TransitionMode } from './modes/TransitionMode.js';

let renderer, canvas;
let currentMode = null;
let lastFrameTime = performance.now();

// ---------- bootstrap ----------
window.addEventListener('load', () => {
  try {
    init();
    requestAnimationFrame(animate);
    console.log('✅ Moonlander booted');
  } catch (err) {
    console.error('❌ Boot failed:', err);
    showFatalError(err);
  }
});

function init() {
  // --- renderer ---
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvas = renderer.domElement;
  document.body.appendChild(canvas);

  window.addEventListener('resize', onResize);

  // --- shared systems ---
  initInput();
  initSound();
  initHUD();
  loadSave(); // no-op if there's no save — logs which

  // --- start in LanderMode ---
  goToMode(LanderMode, {
    onLanded:  handleLanded,
    onCrashed: handleCrashed
  });
}

// ---------- frame loop ----------
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000); // clamp huge gaps (tab-switch)
  lastFrameTime = now;

  if (GameState.mode !== MODE.PAUSED && currentMode) {
    GameState.timeElapsed += dt;
    currentMode.update(dt);
    currentMode.render(renderer);
  }
  renderHUDFrame();
}

// ---------- mode switching ----------
/**
 * Swap the active mode. Calls exit() on the old, enter() on the new.
 * @param {Mode} nextMode — a mode module (LanderMode / WalkMode / TransitionMode)
 * @param {object} opts   — passed through to nextMode.enter()
 */
function goToMode(nextMode, opts = {}) {
  if (currentMode) currentMode.exit();
  currentMode = nextMode;
  currentMode.enter({ renderer, canvas }, opts);
}

/**
 * Cinematic swap: old mode stays rendered while a transition camera eases
 * into the new mode's starting pose. Used for lander→walk and walk→lander.
 */
function cinematicSwap(fromMode, toMode, enterOpts = {}) {
  // Enter the destination mode FIRST so its scene and camera exist. We just
  // don't render it yet — the transition does.
  toMode.enter({ renderer, canvas }, enterOpts);

  // Stash the destination scene on its camera so TransitionMode can find it
  // without a separate parameter.
  toMode.getCamera().userData.scene = toMode.getScene();

  // Hand control to the TransitionMode. On complete, drop it and make the
  // destination mode the "current" one — its enter() already ran.
  const prevMode = fromMode;
  currentMode = TransitionMode;
  TransitionMode.enter({ renderer, canvas }, {
    fromCamera: fromMode.getCamera(),
    fromScene:  fromMode.getScene(),
    toCamera:   toMode.getCamera(),
    onComplete: () => {
      TransitionMode.exit();
      prevMode.exit();           // NOW dispose the old mode's scene
      currentMode = toMode;
      GameState.mode = (toMode === WalkMode) ? MODE.WALK : MODE.LANDER;
      notify('mode');
    }
  });
}

// ---------- handlers wired into mode callbacks ----------
function handleLanded(result) {
  console.log('🛬 Landed on segment', result.segmentIndex);
  // Pause a beat, then cinematic into walk mode.
  setTimeout(() => {
    cinematicSwap(LanderMode, WalkMode, {
      onReturnToLander: handleReturnToLander
    });
  }, 1000); // matches POST_LAND_PAUSE_S — could pull from Constants instead
}

function handleCrashed(result) {
  console.log('💥 Crashed:', result.reason);
  // Simpler path: just restart lander mode. No walk-mode trip earned.
  setTimeout(() => {
    goToMode(LanderMode, { onLanded: handleLanded, onCrashed: handleCrashed });
  }, 2000);
}

function handleReturnToLander() {
  console.log('↩ Returning to lander mode');
  cinematicSwap(WalkMode, LanderMode, {
    onLanded:  handleLanded,
    onCrashed: handleCrashed
  });
}

// ---------- misc ----------
function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  const cam = currentMode?.getCamera?.();
  if (cam?.isPerspectiveCamera) {
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
  }
  // Ortho cameras in LanderMode are sized in world units, not pixels — no
  // update needed on resize. The canvas scales via CSS.
}

function showFatalError(err) {
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;top:20px;left:20px;color:#ff6060;background:#000;padding:20px;z-index:9999;font:14px/1.4 monospace;';
  pre.textContent = `Boot failed:\n${err.message}\n\nCheck the console for the stack trace.`;
  document.body.appendChild(pre);
}
