// Main.js — v0.3.0
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
//   0.1.0 — Initial skeleton.
//   0.2.0 — Phase-5 cinematic transitions (letterbox, fade, crossfade,
//           disembark/embark scripts) wired around cinematicSwap().
//   0.3.0 — Phase-6 game loop: boot into MainMenuMode, game-over routing on
//           fuel-zero crash, settings toggle on Escape.

import * as THREE from 'three';
import { MODE, GAME_WIDTH, GAME_HEIGHT } from './Constants.js';
import {
  GameState, notify,
  startNewRun, commitRunToHighScores,
  load as loadSave
} from './GameState.js';
import { initInput } from './Input.js';
import { initSound } from './Sound.js';
import {
  initHUD, renderFrame as renderHUDFrame,
  showMainMenu, hideMainMenu,
  showGameOver, hideGameOver,
  showSettings, hideSettings, isSettingsOpen,
  toggleMute
} from './HUD.js';
import { LanderMode }     from './modes/LanderMode.js';
import { WalkMode }       from './modes/WalkMode.js';
import { TransitionMode } from './modes/TransitionMode.js';
import { MainMenuMode }   from './modes/MainMenuMode.js';
import { sampleFps }      from './Quality.js';
import { preloadAssets }  from './Preload.js';
import { initTouchControls } from './Touch.js';

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvas = renderer.domElement;
  document.body.appendChild(canvas);

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onGlobalKey);
  // iOS Safari fires visualViewport.resize when the URL bar tucks away —
  // window.resize doesn't always. Listen on both so the canvas re-fits.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize);
    window.visualViewport.addEventListener('scroll', onResize);
  }

  // Set canvas size + letterbox now; onResize handles both the renderer
  // size and absolute-position centering.
  onResize();
  // Re-fit on the next frame and again shortly after — iOS Safari's
  // post-load layout settle (URL bar slide) often arrives after window.load
  // and would otherwise leave the canvas locked to a smaller initial size.
  requestAnimationFrame(onResize);
  setTimeout(onResize, 250);

  // --- shared systems ---
  // Load order matters: initHUD applies settings, so loadSave has to populate
  // GameState.settings first or we'd wire the Sound master volume off defaults.
  initInput();
  initSound();
  loadSave();
  initHUD();
  initTouchControls();

  // --- preload → main menu ---
  // Block the boot behind a progress bar until every texture/audio file has
  // been prefetched. Missing assets still advance the bar so we never hang.
  preloadAssets().then(() => {
    const overlay = document.getElementById('preload');
    if (overlay) overlay.hidden = true;
    openMainMenu();
  });
}

// ---------- frame loop ----------
let recovering = false;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  sampleFps(dt);

  if (GameState.mode !== MODE.PAUSED && currentMode) {
    if (GameState.mode === MODE.LANDER || GameState.mode === MODE.WALK || GameState.mode === MODE.TRANSITION) {
      GameState.timeElapsed += dt;
    }
    // Error boundary: if a mode's update/render throws, log it and drop back
    // to the main menu instead of freezing the frame loop.
    try {
      currentMode.update(dt);
      currentMode.render(renderer);
    } catch (err) {
      handleFrameError(err);
    }
  }

  try {
    renderHUDFrame();
  } catch (err) {
    // A HUD error shouldn't kill the game; log and carry on.
    console.error('[HUD error]', err);
  }
}

function handleFrameError(err) {
  console.error('[frame error]', err);
  if (recovering) return;                 // avoid re-entering the recovery path
  recovering = true;
  try {
    if (currentMode && currentMode !== MainMenuMode) {
      // Best-effort cleanup of whatever mode was running.
      try { currentMode.exit?.(); } catch (_) { /* swallow */ }
    }
    openMainMenu();
  } catch (fatal) {
    console.error('[fatal] main-menu recovery failed', fatal);
  } finally {
    // Let the next frame reset the guard after recovery completes.
    setTimeout(() => { recovering = false; }, 200);
  }
}

// ---------- mode switching ----------
function goToMode(nextMode, opts = {}) {
  if (currentMode) currentMode.exit();
  currentMode = nextMode;
  currentMode.enter({ renderer, canvas }, opts);
  // Fit the new mode's camera to the current viewport. Without this, an
  // ortho camera built with the static GAME_WIDTH×GAME_HEIGHT bounds in
  // its constructor would ignore any portrait/ultrawide adjustments.
  onResize();
}

function cinematicSwap(fromMode, toMode, enterOpts = {}) {
  toMode.enter({ renderer, canvas }, enterOpts);
  toMode.getCamera().userData.scene = toMode.getScene();

  const direction = (toMode === WalkMode) ? 'lander-to-walk' : 'walk-to-lander';

  const prevMode = fromMode;
  currentMode = TransitionMode;
  TransitionMode.enter({ renderer, canvas }, {
    fromCamera: fromMode.getCamera(),
    fromScene:  fromMode.getScene(),
    toCamera:   toMode.getCamera(),
    direction,
    onComplete: () => {
      TransitionMode.exit();
      prevMode.exit();
      currentMode = toMode;
      GameState.mode = (toMode === WalkMode) ? MODE.WALK : MODE.LANDER;
      notify('mode');
      onResize();              // re-fit the new mode's camera
      if (direction === 'lander-to-walk' && typeof toMode.startDisembark === 'function') {
        toMode.startDisembark();
      }
    }
  });
}

// ---------- menu / game-over flow ----------
function openMainMenu() {
  goToMode(MainMenuMode);
  showMainMenu({
    onStart: () => {
      hideMainMenu();
      startRun();
    },
    onSettings: () => {
      showSettings({ onClose: hideSettings, onLunarCheat: triggerLunarCheat });
    }
  });
}

function startRun() {
  startNewRun();
  goToMode(LanderMode, { onLanded: handleLanded, onCrashed: handleCrashed });
}

/**
 * Hidden cheat triggered from the settings overlay (master=19, music=69,
 * lunar=11). Skips the 2D descent and drops the player straight into
 * walk-mode level 1 with 5% fuel and a fuel drum within reach. The
 * dismount happens after a tick so the settings-input event finishes
 * cleanly before mode swap.
 */
function triggerLunarCheat() {
  console.log('🌙 LUNAR CHEAT — 19 69 11');
  hideSettings();
  hideMainMenu();
  setTimeout(() => {
    startNewRun();
    // 5% fuel, as ordered.
    GameState.fuel.current = GameState.fuel.capacity * 0.05;
    // Pretend we just landed cleanly on a plain pad at the world origin,
    // matching the parked-lander default position. WalkMode reads
    // lastLanding.padKind to decide what extra loot to spawn — 'plain'
    // skips the beginner-pad fuel drum freebie so the only nearby drum
    // is the one in LEVEL1_FIXED_LOOT (the cheat-spawn target).
    GameState.hasLanded = true;
    GameState.lastLanding.padCenterX = 0;
    GameState.lastLanding.padWidth = 30;
    GameState.lastLanding.padKind = 'plain';
    GameState.lastLanding.padMultiplier = 1;
    goToMode(WalkMode, {
      onReturnToLander: handleReturnToLander,
      cheatSpawn: true
    });
    GameState.mode = MODE.WALK;
    notify('mode');
  }, 50);
}

function openGameOver(lastCrashReason) {
  const rank = commitRunToHighScores();
  goToMode(MainMenuMode);     // park in a quiet scene behind the overlay
  // MainMenuMode set mode=MENU; but we want GAME_OVER semantically so the HUD
  // logic (e.g. walk-only rows) stays hidden. Override here.
  GameState.mode = MODE.GAME_OVER;
  notify('mode');
  showGameOver({
    score:    GameState.score,
    level:    GameState.level,
    landings: GameState.landingsCompleted,
    rank,
    onRestart: () => {
      hideGameOver();
      startRun();
    },
    onMenu: () => {
      hideGameOver();
      openMainMenu();
    }
  });
  console.log(`🏁 Game over (${lastCrashReason || 'fuel out'}). Score ${GameState.score}, rank ${rank ?? '—'}`);
}

// ---------- handlers wired into mode callbacks ----------
function handleLanded(result) {
  console.log('🛬 Landed on segment', result.segmentIndex);
  setTimeout(() => {
    cinematicSwap(LanderMode, WalkMode, {
      onReturnToLander: handleReturnToLander
    });
  }, 1000);
}

function handleCrashed(result) {
  console.log('💥 Crashed:', result.reason);
  const fuelGone = GameState.fuel.current <= 0;
  const wrecked  = !!result?.wrecked || GameState.lander?.wrecked;
  setTimeout(() => {
    if (fuelGone || wrecked) {
      openGameOver(wrecked ? result.reason + ' (HULL DESTROYED)' : result.reason);
    } else {
      goToMode(LanderMode, { onLanded: handleLanded, onCrashed: handleCrashed });
    }
  }, 2000);
}

function handleReturnToLander() {
  console.log('↩ Returning to lander mode');
  if (typeof WalkMode.startEmbark === 'function') {
    WalkMode.startEmbark(() => {
      cinematicSwap(WalkMode, LanderMode, { onLanded: handleLanded, onCrashed: handleCrashed });
    });
  } else {
    cinematicSwap(WalkMode, LanderMode, { onLanded: handleLanded, onCrashed: handleCrashed });
  }
}

// ---------- keyboard routing ----------
function onGlobalKey(e) {
  if (e.key === 'Escape') {
    // Escape toggles the settings overlay. Only allow opening outside of
    // transitions/cinematics to avoid leaving cameras half-lerped.
    const transitioning = GameState.mode === MODE.TRANSITION;
    if (isSettingsOpen()) {
      hideSettings();
    } else if (!transitioning) {
      showSettings({ onClose: hideSettings, onLunarCheat: triggerLunarCheat });
    }
  } else if (e.key === 'm' || e.key === 'M') {
    // Mute toggle — the corner button is unreachable while pointer-locked
    // in walk mode, so keep a keyboard shortcut available everywhere.
    toggleMute();
  }
}

// ---------- misc ----------
/**
 * Resize the canvas to the full viewport, then fit the active mode's camera
 * frustum to that viewport. The fit logic preserves world-aspect:
 *   - Landscape viewport (≥ game aspect) → show full GAME_WIDTH; frustum
 *     height auto-derived. Camera stays centered.
 *   - Portrait viewport (< game aspect) → show full GAME_HEIGHT and a
 *     narrower slice of width. LanderMode follows the lander horizontally
 *     to keep the action on-screen.
 *
 * Stashing viewWidth/viewHeight on `cam.userData` so LanderMode's per-frame
 * camera-follow knows whether to clamp to the lander's x.
 */
function onResize() {
  // Prefer visualViewport when available — on iOS Safari it correctly
  // tracks the area between the top status bar and the (dynamic) bottom
  // URL bar. window.innerHeight locks to boot-time on that browser and
  // doesn't update when the URL bar dismisses.
  const vv = window.visualViewport;
  const ww = (vv ? vv.width  : window.innerWidth);
  const wh = (vv ? vv.height : window.innerHeight);
  renderer.setSize(ww, wh);
  canvas.style.position = 'fixed';
  canvas.style.left = '0';
  canvas.style.top  = '0';

  const cam = currentMode?.getCamera?.();
  const aspect = (wh > 0) ? (ww / wh) : 1;
  if (cam?.isOrthographicCamera) {
    fitOrthoToViewport(cam, aspect);
  } else if (cam?.isPerspectiveCamera) {
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  }
}

function fitOrthoToViewport(cam, aspect) {
  const gameAspect = GAME_WIDTH / GAME_HEIGHT;
  let viewW, viewH;
  if (aspect >= gameAspect) {
    // Landscape: show full game width, frustum gains some vertical sky.
    viewW = GAME_WIDTH;
    viewH = viewW / aspect;
  } else {
    // Portrait: show full game height, frustum loses some horizontal world.
    // LanderMode will pan to follow the lander.
    viewH = GAME_HEIGHT;
    viewW = viewH * aspect;
  }
  cam.left   = -viewW / 2;
  cam.right  =  viewW / 2;
  cam.top    =  viewH / 2;
  cam.bottom = -viewH / 2;
  cam.userData.viewWidth  = viewW;
  cam.userData.viewHeight = viewH;
  cam.updateProjectionMatrix();
}

function showFatalError(err) {
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;top:20px;left:20px;color:#ff6060;background:#000;padding:20px;z-index:9999;font:14px/1.4 monospace;';
  pre.textContent = `Boot failed:\n${err.message}\n\nCheck the console for the stack trace.`;
  document.body.appendChild(pre);
}
