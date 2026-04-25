// HUD.js — v0.3.0
// DOM-based HUD + menus. Per mode:
//   LANDER → altitude, h-speed, v-speed, angle, fuel, score
//   WALK   → fuel, score, inventory, objectives, interaction prompts, comms
//   MENU / GAME_OVER → fullscreen overlay with buttons
//
// Phase 6 additions:
//   - Main menu overlay with high-score board
//   - Game-over overlay with final run summary + rank
//   - Settings overlay (master volume, invert-Y, fullscreen)
//   - Achievement toast that queues and auto-dismisses

import { GameState, subscribe, save as saveGameState } from './GameState.js';
import { MODE } from './Constants.js';
import { setMasterVolume, setMuted, isMuted } from './Sound.js';

// ---------- cached DOM refs ----------
const el = {
  score:   document.getElementById('hud-score'),
  time:    document.getElementById('hud-time'),
  fuel:    document.getElementById('hud-fuel'),
  kits:    document.getElementById('hud-kits'),
  samples: document.getElementById('hud-samples'),
  alert:   document.getElementById('hud-alert'),
  alt:     document.getElementById('hud-alt'),
  hspeed:  document.getElementById('hud-hspeed'),
  vspeed:  document.getElementById('hud-vspeed'),
  angle:   document.getElementById('hud-angle'),
  center:  document.getElementById('hud-center'),
  right:   document.getElementById('hud-right'),
  objectives: document.getElementById('hud-objectives'),
  objList:    document.getElementById('hud-obj-list'),
  comms:      document.getElementById('hud-comms')
};

const overlay = {
  mainMenu:         document.getElementById('main-menu'),
  gameOver:         document.getElementById('game-over'),
  settings:         document.getElementById('settings-menu'),
  toast:            document.getElementById('achievement-toast'),
  hsList:           document.getElementById('hs-list'),
  btnStart:         document.getElementById('btn-start'),
  btnSettingsMenu:  document.getElementById('btn-settings-menu'),
  goScore:          document.getElementById('go-score'),
  goLevel:          document.getElementById('go-level'),
  goLandings:       document.getElementById('go-landings'),
  goRank:           document.getElementById('go-rank'),
  btnRestart:       document.getElementById('btn-restart'),
  btnMenu:          document.getElementById('btn-menu'),
  setVolume:        document.getElementById('set-volume'),
  setVolLabel:      document.getElementById('set-volume-label'),
  setInvertY:       document.getElementById('set-invert-y'),
  btnFullscreen:    document.getElementById('btn-fullscreen'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  muteBtn:          document.getElementById('mute-btn'),
  muteIcon:         document.querySelector('#mute-btn .mute-icon'),
  toastTitle:       document.querySelector('#achievement-toast .toast-title'),
  toastDesc:        document.querySelector('#achievement-toast .toast-desc'),
  walkTutorial:     document.getElementById('walk-tutorial'),
  walkTutorialClose:document.getElementById('walk-tutorial-close')
};

// Per-frame pull state — lander mode writes these before renderFrame().
// State strings drive the green/yellow/red gauge color classes.
const landerTelemetry = {
  altitude: 0, hSpeed: 0, vSpeed: 0, angleDeg: 0,
  vSpeedState: 'ok', hSpeedState: 'ok', angleState: 'ok'
};

let commsTimer = null;
let toastTimer = null;
const toastQueue = [];

// Callbacks registered by whoever opens an overlay. Stored so the buttons can
// dispatch without re-binding handlers every show.
let startCb = () => {};
let settingsCb = () => {};
let restartCb = () => {};
let menuCb = () => {};
let closeSettingsCb = () => {};

// ---------- init ----------
export function initHUD() {
  subscribe(onStateChange);
  onStateChange(GameState, 'init');

  bindOverlayButtons();
  applySettings(GameState.settings);

  console.log('✅ HUD initialized');
}

function bindOverlayButtons() {
  overlay.btnStart.addEventListener('click',          () => startCb());
  overlay.btnSettingsMenu.addEventListener('click',   () => settingsCb());
  overlay.btnRestart.addEventListener('click',        () => restartCb());
  overlay.btnMenu.addEventListener('click',           () => menuCb());
  overlay.btnCloseSettings.addEventListener('click',  () => closeSettingsCb());

  overlay.setVolume.addEventListener('input', (e) => {
    const pct = Number(e.target.value);
    const v = pct / 100;
    overlay.setVolLabel.textContent = String(pct);
    setMasterVolume(v);
    GameState.settings.masterVolume = v;
    persistSettings();
  });
  overlay.setInvertY.addEventListener('change', (e) => {
    GameState.settings.invertY = !!e.target.checked;
    persistSettings();
  });
  overlay.btnFullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  });

  // Always-visible corner mute toggle. Click flips state, persists,
  // retunes every live Sound. The same path is exposed as toggleMute()
  // so a keyboard shortcut works while the canvas has pointer-lock.
  overlay.muteBtn.addEventListener('click', () => toggleMute());

  // Walk-mode first-time tutorial close button. Dismiss sets the
  // profile-level flag so the card doesn't reappear next run.
  overlay.walkTutorialClose?.addEventListener('click', dismissWalkTutorial);
}

/**
 * Show the first-time walk tutorial card. Call from WalkMode when the
 * astronaut disembarks. No-op if the player has already seen it.
 */
export function showWalkTutorial() {
  if (GameState.flags?.walkTutorialSeen) return;
  if (!overlay.walkTutorial) return;
  overlay.walkTutorial.hidden = false;
}

export function hideWalkTutorial() {
  if (overlay.walkTutorial) overlay.walkTutorial.hidden = true;
}

function dismissWalkTutorial() {
  hideWalkTutorial();
  GameState.flags = GameState.flags || {};
  GameState.flags.walkTutorialSeen = true;
  persistSettings();
}

function applySettings(settings) {
  setMasterVolume(settings.masterVolume ?? 0.8);
  setMuted(settings.muted !== false); // default to muted on first boot
  overlay.setVolume.value = String(Math.round((settings.masterVolume ?? 0.8) * 100));
  overlay.setVolLabel.textContent = overlay.setVolume.value;
  overlay.setInvertY.checked = !!settings.invertY;
  refreshMuteIcon();
}

/**
 * Flip the global mute state, retune every live Sound, refresh the corner
 * icon, and persist. Call from the corner button click OR a keyboard
 * shortcut — the latter is the only way to mute while pointer-locked in
 * walk mode.
 */
export function toggleMute() {
  const next = !isMuted();
  setMuted(next);
  GameState.settings.muted = next;
  refreshMuteIcon();
  persistSettings();
}

function refreshMuteIcon() {
  const muted = isMuted();
  if (overlay.muteIcon) overlay.muteIcon.textContent = muted ? '🔇' : '🔊';
  if (overlay.muteBtn) {
    overlay.muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    overlay.muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }
}

function persistSettings() {
  saveGameState();
}

// ---------- per-frame ----------
export function setLanderTelemetry({
  altitude, hSpeed, vSpeed, angleDeg,
  vSpeedState = 'ok', hSpeedState = 'ok', angleState = 'ok'
}) {
  landerTelemetry.altitude     = altitude;
  landerTelemetry.hSpeed       = hSpeed;
  landerTelemetry.vSpeed       = vSpeed;
  landerTelemetry.angleDeg     = angleDeg;
  landerTelemetry.vSpeedState  = vSpeedState;
  landerTelemetry.hSpeedState  = hSpeedState;
  landerTelemetry.angleState   = angleState;
}

export function renderFrame() {
  if (GameState.mode === MODE.LANDER || GameState.mode === MODE.TRANSITION) {
    el.alt.textContent    = pad(landerTelemetry.altitude.toFixed(0), 4);
    el.hspeed.textContent = landerTelemetry.hSpeed.toFixed(1).padStart(6);
    el.vspeed.textContent = landerTelemetry.vSpeed.toFixed(1).padStart(6);
    el.angle.textContent  = landerTelemetry.angleDeg.toFixed(1).padStart(6);
    setGaugeClass(el.vspeed, landerTelemetry.vSpeedState);
    setGaugeClass(el.hspeed, landerTelemetry.hSpeedState);
    setGaugeClass(el.angle,  landerTelemetry.angleState);
  }

  const t = GameState.timeElapsed;
  el.time.textContent = `${(t / 60) | 0}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

/** Apply a tri-state color class ('ok' | 'warn' | 'danger') to a gauge element. */
function setGaugeClass(node, state) {
  if (!node) return;
  node.classList.remove('gauge-ok', 'gauge-warn', 'gauge-danger');
  if (state === 'ok')     node.classList.add('gauge-ok');
  if (state === 'warn')   node.classList.add('gauge-warn');
  if (state === 'danger') node.classList.add('gauge-danger');
}

export function setCenterMessage(text) {
  el.center.textContent = text || '';
}

// ---------- comms blip ----------
export function showComms(text, durationMs = 3800) {
  if (!el.comms) return;
  el.comms.textContent = text;
  el.comms.classList.add('show');
  if (commsTimer) clearTimeout(commsTimer);
  commsTimer = setTimeout(() => {
    el.comms.classList.remove('show');
    commsTimer = null;
  }, durationMs);
}

// ---------- Phase-6 overlays ----------
export function showMainMenu({ onStart, onSettings }) {
  startCb    = onStart    || (() => {});
  settingsCb = onSettings || (() => {});
  renderHighScores();
  overlay.mainMenu.hidden = false;
  // Autofocus the primary action so Enter works without touching the mouse.
  requestAnimationFrame(() => overlay.btnStart.focus());
}
export function hideMainMenu() { overlay.mainMenu.hidden = true; }

export function showGameOver({ score, level, landings, rank, onRestart, onMenu }) {
  overlay.goScore.textContent    = score;
  overlay.goLevel.textContent    = level;
  overlay.goLandings.textContent = landings;
  overlay.goRank.textContent     = rank ? `HIGH SCORE — RANK #${rank}` : '';
  restartCb = onRestart || (() => {});
  menuCb    = onMenu    || (() => {});
  overlay.gameOver.hidden = false;
  requestAnimationFrame(() => overlay.btnRestart.focus());
}
export function hideGameOver() { overlay.gameOver.hidden = true; }

export function showSettings({ onClose } = {}) {
  closeSettingsCb = onClose || (() => { hideSettings(); });
  applySettings(GameState.settings);
  overlay.settings.hidden = false;
  requestAnimationFrame(() => overlay.btnCloseSettings.focus());
}
export function hideSettings() { overlay.settings.hidden = true; }

export function isSettingsOpen() { return !overlay.settings.hidden; }
export function isMenuOpen() { return !overlay.mainMenu.hidden; }
export function isGameOverOpen() { return !overlay.gameOver.hidden; }

function renderHighScores() {
  overlay.hsList.innerHTML = '';
  const list = GameState.highScores || [];
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'NO SCORES YET';
    overlay.hsList.appendChild(li);
    return;
  }
  list.forEach((h, i) => {
    const li = document.createElement('li');
    const rank = document.createElement('span');
    rank.textContent = `${String(i + 1).padStart(2, ' ')}.`;
    const score = document.createElement('span');
    score.textContent = `${h.score}  L${h.level}`;
    li.appendChild(rank);
    li.appendChild(score);
    overlay.hsList.appendChild(li);
  });
}

// ---------- achievement toast ----------
export function showAchievementToast(def) {
  if (!def) return;
  toastQueue.push(def);
  if (!toastTimer) runToastQueue();
}

function runToastQueue() {
  if (!toastQueue.length) return;
  const def = toastQueue.shift();
  overlay.toastTitle.textContent = def.title;
  overlay.toastDesc.textContent  = def.description;
  overlay.toast.hidden = false;
  // Force reflow so the transition kicks in.
  void overlay.toast.offsetWidth;
  overlay.toast.classList.add('show');
  toastTimer = setTimeout(() => {
    overlay.toast.classList.remove('show');
    setTimeout(() => {
      overlay.toast.hidden = true;
      toastTimer = null;
      if (toastQueue.length) runToastQueue();
    }, 400);
  }, 3800);
}

// ---- internal subscribe callback ----

function onStateChange(state /*, changeKey */) {
  el.score.textContent = pad(state.score, 4);
  el.fuel.textContent  = pad(state.fuel.current.toFixed(0), 4);
  el.kits.textContent    = state.supplies.repairKits;
  el.samples.textContent = state.supplies.scienceSamples;

  // Fuel gauge color — green at comfortable, amber at "plan your descent",
  // red at critical. Matches the low-fuel alarm threshold at 30%.
  const fuelFrac = state.fuel.capacity ? state.fuel.current / state.fuel.capacity : 0;
  const fuelState =
    fuelFrac <= 0.15 ? 'danger' :
    fuelFrac <= 0.35 ? 'warn'   : 'ok';
  setGaugeClass(el.fuel, fuelState);

  document.body.classList.toggle('mode-walk',   state.mode === MODE.WALK);
  document.body.classList.toggle('mode-lander', state.mode === MODE.LANDER);

  el.right.style.visibility = (state.mode === MODE.WALK) ? 'hidden' : 'visible';

  if (state.isAlerted) {
    el.alert.hidden = false;
    el.alert.textContent = state.hasFuel ? 'LOW ON FUEL' : 'OUT OF FUEL';
  } else {
    el.alert.hidden = true;
  }

  renderObjectives(state);
}

function renderObjectives(state) {
  if (!el.objList) return;
  el.objList.innerHTML = '';
  for (const o of state.objectives) {
    const li = document.createElement('li');
    li.textContent = o.label;
    if (o.done) li.classList.add('done');
    el.objList.appendChild(li);
  }
}

function pad(n, width) { return String(n).padStart(width, '0'); }
