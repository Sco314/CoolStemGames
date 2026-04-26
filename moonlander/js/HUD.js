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

import { GameState, subscribe, update as updateState, refreshObjectives, save as saveGameState } from './GameState.js';
import { MODE, MISSION_MESSAGES } from './Constants.js';
import { setMasterVolume, setMuted, isMuted, setMusicVolume } from './Sound.js';
import { generateChallenge, validate as validateMath } from './MathChallenge.js';

// ---------- cached DOM refs ----------
const el = {
  score:   document.getElementById('hud-score'),
  time:    document.getElementById('hud-time'),
  fuel:    document.getElementById('hud-fuel'),
  hull:    document.getElementById('hud-hull'),
  health:  document.getElementById('hud-health'),
  kits:    document.getElementById('hud-kits'),
  samples: document.getElementById('hud-samples'),
  carry:    document.getElementById('hud-carry'),
  carryRow: document.getElementById('hud-carry-row'),
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
  setMusicVolume:   document.getElementById('set-music-volume'),
  setMusicVolLabel: document.getElementById('set-music-volume-label'),
  setInvertY:       document.getElementById('set-invert-y'),
  setLunar:         document.getElementById('set-lunar'),
  setLunarLabel:    document.getElementById('set-lunar-label'),
  btnFullscreen:    document.getElementById('btn-fullscreen'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  muteBtn:          document.getElementById('mute-btn'),
  muteIcon:         document.querySelector('#mute-btn .mute-icon'),
  toastTitle:       document.querySelector('#achievement-toast .toast-title'),
  toastIcon:        document.getElementById('toast-icon'),
  toastDesc:        document.querySelector('#achievement-toast .toast-desc'),
  walkTutorial:     document.getElementById('walk-tutorial'),
  walkTutorialClose:document.getElementById('walk-tutorial-close'),
  landerTutorial:     document.getElementById('lander-tutorial'),
  landerTutorialClose:document.getElementById('lander-tutorial-close'),
  mapBtn:           document.getElementById('map-btn'),
  mapOverlay:       document.getElementById('map-overlay'),
  mapFrame:         document.getElementById('map-frame'),
  btnCloseMap:      document.getElementById('btn-close-map'),
  stemBtn:          document.getElementById('stem-btn'),
  mathOverlay:      document.getElementById('math-overlay'),
  mathTitle:        document.getElementById('math-title'),
  mathBody:         document.getElementById('math-body'),
  mathInput:        document.getElementById('math-input'),
  mathUnit:         document.getElementById('math-unit'),
  mathResult:       document.getElementById('math-result'),
  btnMathSubmit:    document.getElementById('btn-math-submit'),
  btnMathSkip:      document.getElementById('btn-math-skip'),
  missionMsg:       document.getElementById('mission-msg'),
  missionMsgTitle:  document.getElementById('mission-msg-title'),
  missionMsgBody:   document.getElementById('mission-msg-body')
};

let missionMsgTimer = null;

const MAX_STEM_PER_SESSION = 3;
let stemUsedThisSession = 0;
let activeChallenge = null;

let mapDataProvider = null;
let mapAnimRaf = null;
// Batch 5 #9 — optional callback set by WalkMode to drive the scripted
// up-the-ladder animation. signature: (onTop:Function) => void.
let mapClimbProvider = null;
let mapDescendProvider = null;

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
// Cheat-code callback fired from the settings overlay when the player
// dials in the magic triplet (see checkLunarCheat). Wired by Main.js
// inside its showSettings(...) calls.
let lunarCheatCb = null;
let lunarCheatFired = false;   // one-shot per settings session

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
    checkLunarCheat();
  });
  overlay.setMusicVolume?.addEventListener('input', (e) => {
    const pct = Number(e.target.value);
    const v = pct / 100;
    if (overlay.setMusicVolLabel) overlay.setMusicVolLabel.textContent = String(pct);
    setMusicVolume(v);
    GameState.settings.musicVolume = v;
    persistSettings();
    checkLunarCheat();
  });
  overlay.setInvertY.addEventListener('change', (e) => {
    GameState.settings.invertY = !!e.target.checked;
    persistSettings();
  });
  overlay.setLunar?.addEventListener('input', (e) => {
    const pct = Number(e.target.value);
    if (overlay.setLunarLabel) overlay.setLunarLabel.textContent = String(pct);
    GameState.settings.lunar = pct;
    persistSettings();
    checkLunarCheat();
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
  // Batch 5 #22: lander-mode first-time tutorial.
  overlay.landerTutorialClose?.addEventListener('click', dismissLanderTutorial);

  // Satellite map open/close. Gated behind lander proximity per the
  // ladder-climb lore — the player has to walk to the lander before the
  // satellite uplink is available.
  overlay.mapBtn?.addEventListener('click', () => requestOpenMap());
  overlay.btnCloseMap?.addEventListener('click', () => hideMap());

  // STEM challenge — corner button pops a math modal. Capped per session.
  overlay.stemBtn?.addEventListener('click', () => openStemChallenge());
  overlay.btnMathSubmit?.addEventListener('click', () => submitMathAnswer());
  overlay.btnMathSkip?.addEventListener('click', () => closeStemChallenge());
  overlay.mathInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitMathAnswer();
  });
}

export function resetStemSession() { stemUsedThisSession = 0; }

function openStemChallenge() {
  if (!overlay.mathOverlay) return;
  if (stemUsedThisSession >= MAX_STEM_PER_SESSION) {
    showComms(`STEM CHALLENGE LIMIT REACHED THIS TRIP (${MAX_STEM_PER_SESSION})`);
    return;
  }
  activeChallenge = generateChallenge();
  overlay.mathTitle.textContent = activeChallenge.title;
  overlay.mathBody.textContent  = activeChallenge.body;
  overlay.mathUnit.textContent  = activeChallenge.unit || '';
  overlay.mathInput.value = '';
  overlay.mathResult.hidden = true;
  overlay.mathResult.textContent = '';
  overlay.mathResult.classList.remove('correct', 'wrong');
  overlay.mathOverlay.hidden = false;
  requestAnimationFrame(() => overlay.mathInput.focus());
}

function submitMathAnswer() {
  if (!activeChallenge) return;
  const { correct, expected } = validateMath(activeChallenge, overlay.mathInput.value);
  overlay.mathResult.hidden = false;
  if (correct) {
    overlay.mathResult.classList.remove('wrong');
    overlay.mathResult.classList.add('correct');
    overlay.mathResult.textContent = `CORRECT — +${activeChallenge.score} SCORE`;
    updateState(s => {
      s.score += activeChallenge.score | 0;
      s.stats.mathSolved = (s.stats.mathSolved | 0) + 1;
      refreshObjectives();
    }, 'stem-correct');
    stemUsedThisSession += 1;
    setTimeout(closeStemChallenge, 1100);
  } else {
    overlay.mathResult.classList.remove('correct');
    overlay.mathResult.classList.add('wrong');
    overlay.mathResult.textContent = `NOT QUITE — answer was ${expected}${activeChallenge.unit ? ' ' + activeChallenge.unit : ''}`;
    stemUsedThisSession += 1;     // wrong answer also counts vs the session cap
    setTimeout(closeStemChallenge, 1600);
  }
}

function closeStemChallenge() {
  if (overlay.mathOverlay) overlay.mathOverlay.hidden = true;
  activeChallenge = null;
}

/**
 * WalkMode registers itself as the data source on enter() so HUD doesn't
 * have to import WalkMode (avoids circular module init order). Provider
 * returns a {bounds, astronaut, lander, items} snapshot or null when no
 * walk session is active.
 */
export function setMapDataProvider(fn) {
  mapDataProvider = typeof fn === 'function' ? fn : null;
}

/**
 * Batch 5 #9 — register the scripted ladder-climb / descend animation
 * functions from WalkMode. When provided, requestOpenMap() / hideMap()
 * route through them so the player sees an actual climb instead of a
 * blind 750ms timeout. Cleared on WalkMode.exit() so we don't poll a
 * dead session.
 */
export function setLadderProviders({ climb, descend } = {}) {
  mapClimbProvider   = typeof climb   === 'function' ? climb   : null;
  mapDescendProvider = typeof descend === 'function' ? descend : null;
}

/**
 * Click handler for the corner MAP button. If the astronaut is at the
 * lander, plays a brief "climbing ladder" comms beat before showing the
 * overlay. Otherwise rejects with a comms blip telling the player where
 * to go. Direct showMap() callers (e.g. tests) skip the gate.
 */
function requestOpenMap() {
  if (!mapDataProvider) return;
  const data = mapDataProvider();
  if (!data) return;
  if (!data.nearLander) {
    showComms('UPLINK UNAVAILABLE — RETURN TO LANDER');
    return;
  }
  showComms('CLIMBING LADDER… ACCESSING SATELLITE UPLINK');
  // Batch 5 #9: hand control to the scripted climb if WalkMode registered
  // one. Falls back to the original 750 ms timeout when no provider is
  // wired (defensive — keeps tests / direct callers working).
  if (mapClimbProvider) {
    mapClimbProvider(() => showMap());
  } else {
    setTimeout(() => showMap(), 750);
  }
}

export function showMap() {
  if (!overlay.mapOverlay) return;
  if (!mapDataProvider) return;             // not in walk mode
  overlay.mapOverlay.hidden = false;
  // Render loop ticks per animation frame — cheap (just DOM updates).
  const tick = () => {
    renderMap();
    mapAnimRaf = requestAnimationFrame(tick);
  };
  tick();
}

export function hideMap() {
  if (overlay.mapOverlay) overlay.mapOverlay.hidden = true;
  if (mapAnimRaf) cancelAnimationFrame(mapAnimRaf);
  mapAnimRaf = null;
  // Batch 5 #9: send the astronaut back down the ladder if WalkMode
  // registered a descend provider. No-op if the player closed the map
  // from outside walk mode (tests, etc.).
  if (mapDescendProvider) mapDescendProvider();
}

export function isMapOpen() {
  return !!(overlay.mapOverlay && !overlay.mapOverlay.hidden);
}

function renderMap() {
  const data = mapDataProvider?.();
  if (!data || !overlay.mapFrame) return;
  // World x/z range [-bounds, bounds] → CSS percent [0%, 100%]. Z grows
  // "into the screen" in Three.js; map "down" on screen corresponds to
  // the +z direction so the player's instinct ("up on the map = forward
  // when yaw=0") matches the chase-cam.
  const B = data.bounds;
  const toMap = (worldCoord) => ((worldCoord + B) / (2 * B)) * 100;

  // Cheap-but-correct: rebuild children each frame. Item count is small
  // (< 20 dots) so we don't bother diffing.
  overlay.mapFrame.innerHTML = '';

  // Lander
  appendDot(overlay.mapFrame, 'lander', toMap(data.lander.x), toMap(data.lander.z),
            'LANDER', '#ffee88', false);

  // Items
  for (const it of data.items) {
    const cls = `dot-pin item-${it.kind}` + (it.used ? ' used' : '');
    const pin = document.createElement('div');
    pin.className = cls;
    pin.style.left = toMap(it.x) + '%';
    pin.style.top  = toMap(it.z) + '%';
    pin.style.background = it.color;
    overlay.mapFrame.appendChild(pin);
    if (it.kind === 'landmark' || it.kind === 'apollo') {
      const lbl = document.createElement('div');
      lbl.className = 'dot-label';
      lbl.textContent = it.label;
      lbl.style.left = toMap(it.x) + '%';
      lbl.style.top  = toMap(it.z) + '%';
      overlay.mapFrame.appendChild(lbl);
    }
  }

  // Astronaut last, so it always renders on top.
  appendDot(overlay.mapFrame, 'astronaut',
    toMap(data.astronaut.x), toMap(data.astronaut.z),
    null, null, false, data.astronaut.yaw);
}

function appendDot(parent, cls, leftPct, topPct, label, color, used, rotation) {
  const pin = document.createElement('div');
  pin.className = `dot-pin ${cls}` + (used ? ' used' : '');
  pin.style.left = leftPct + '%';
  pin.style.top  = topPct + '%';
  if (color) pin.style.background = color;
  if (typeof rotation === 'number') {
    // Astronaut is a triangle; rotate to indicate facing.
    pin.style.transform = `rotate(${rotation}rad)`;
    pin.style.transformOrigin = 'center';
  }
  parent.appendChild(pin);
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

/**
 * Batch 5 #22: lander-mode first-time tutorial. Same once-per-profile
 * pattern as the walk-mode card.
 */
export function showLanderTutorial() {
  if (GameState.flags?.landerTutorialSeen) return;
  if (!overlay.landerTutorial) return;
  overlay.landerTutorial.hidden = false;
}

export function hideLanderTutorial() {
  if (overlay.landerTutorial) overlay.landerTutorial.hidden = true;
}

function dismissLanderTutorial() {
  hideLanderTutorial();
  GameState.flags = GameState.flags || {};
  GameState.flags.landerTutorialSeen = true;
  persistSettings();
}

function applySettings(settings) {
  setMasterVolume(settings.masterVolume ?? 0.8);
  setMusicVolume(settings.musicVolume ?? 0.4);
  setMuted(settings.muted !== false); // default to muted on first boot
  overlay.setVolume.value = String(Math.round((settings.masterVolume ?? 0.8) * 100));
  overlay.setVolLabel.textContent = overlay.setVolume.value;
  if (overlay.setMusicVolume) {
    overlay.setMusicVolume.value = String(Math.round((settings.musicVolume ?? 0.4) * 100));
    if (overlay.setMusicVolLabel) overlay.setMusicVolLabel.textContent = overlay.setMusicVolume.value;
  }
  overlay.setInvertY.checked = !!settings.invertY;
  if (overlay.setLunar) {
    const lunar = settings.lunar | 0;
    overlay.setLunar.value = String(lunar);
    if (overlay.setLunarLabel) overlay.setLunarLabel.textContent = String(lunar);
  }
  refreshMuteIcon();
}

/**
 * Hidden cheat: dialing master=19, music=69, lunar=11 in the settings
 * overlay drops the player straight into walk-mode level 1 with 5% fuel
 * and a fuel drum within reach. Fires only once per settings session so
 * adjusting another slider afterward doesn't re-trigger it. Cleared on
 * the next showSettings() call.
 */
function checkLunarCheat() {
  if (lunarCheatFired || !lunarCheatCb) return;
  const s = GameState.settings;
  const masterPct = Math.round((s.masterVolume ?? 0) * 100);
  const musicPct  = Math.round((s.musicVolume  ?? 0) * 100);
  const lunarPct  = s.lunar | 0;
  if (masterPct === 19 && musicPct === 69 && lunarPct === 11) {
    lunarCheatFired = true;
    lunarCheatCb();
  }
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

// ---------- mission control text messages ----------

/**
 * Show a longer-form Mission Control message at the top of the screen.
 * `key` looks up an entry in MISSION_MESSAGES; pass `null` and supply
 * `title` + `body` to render an ad-hoc message. Auto-fades after `ttl`.
 */
export function showMissionMessage(key, opts = {}) {
  if (!overlay.missionMsg || !overlay.missionMsgTitle || !overlay.missionMsgBody) return;
  const def = key ? MISSION_MESSAGES[key] : null;
  const title = opts.title || def?.title || 'MISSION CONTROL';
  const body  = opts.body  || def?.body  || '';
  if (!body) return;
  overlay.missionMsgTitle.textContent = title;
  overlay.missionMsgBody.textContent  = body;
  overlay.missionMsg.hidden = false;
  // Force reflow so the transition kicks in.
  void overlay.missionMsg.offsetWidth;
  overlay.missionMsg.classList.add('show');
  if (missionMsgTimer) clearTimeout(missionMsgTimer);
  const ttl = opts.ttl ?? 7000;
  missionMsgTimer = setTimeout(() => {
    overlay.missionMsg.classList.remove('show');
    setTimeout(() => { overlay.missionMsg.hidden = true; }, 450);
    missionMsgTimer = null;
  }, ttl);
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

export function showSettings({ onClose, onLunarCheat } = {}) {
  closeSettingsCb = onClose || (() => { hideSettings(); });
  lunarCheatCb = onLunarCheat || null;
  lunarCheatFired = false;
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

// Batch 5 #18: inline SVG glyphs per achievement, no extra asset fetches.
// Each entry is a complete <svg> string sized 32×32; the toast injects it
// into #toast-icon. Unknown ids fall back to a star.
const ACHIEVEMENT_ICONS = {
  'first-landing':
    `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <rect x="6" y="22" width="20" height="2" fill="#9aa"/>
      <path d="M16 6 L11 14 L21 14 Z" fill="#cfd"/>
      <rect x="14" y="14" width="4" height="6" fill="#9af"/>
      <circle cx="16" cy="11" r="1.4" fill="#fc6"/>
    </svg>`,
  'perfect-landing':
    `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <polygon points="16,4 19.6,12.4 28.8,13 21.6,18.8 24,27.6 16,22.6 8,27.6 10.4,18.8 3.2,13 12.4,12.4"
               fill="#fc6" stroke="#a80" stroke-width="1"/>
    </svg>`,
  'hot-swap-refuel':
    `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <path d="M6 12 L12 7 L12 11 L22 11 L22 13 L12 13 L12 17 Z" fill="#fc4"/>
      <path d="M26 20 L20 25 L20 21 L10 21 L10 19 L20 19 L20 15 Z" fill="#f86"/>
    </svg>`,
  'sample-collector':
    `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <rect x="11" y="6" width="10" height="3" rx="1" fill="#bbe"/>
      <path d="M13 9 L13 24 Q13 27 16 27 Q19 27 19 24 L19 9 Z"
            fill="#7cf" stroke="#36a" stroke-width="1"/>
      <circle cx="16" cy="20" r="1" fill="#fff"/>
      <circle cx="14.5" cy="22" r="0.7" fill="#fff"/>
    </svg>`,
  'probe-rescuer':
    `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <rect x="9" y="11" width="14" height="10" rx="1" fill="#bcd"/>
      <rect x="11" y="13" width="10" height="6" fill="#346"/>
      <rect x="3"  y="15" width="6"  height="2" fill="#bcd"/>
      <rect x="23" y="15" width="6"  height="2" fill="#bcd"/>
      <path d="M14 6 L18 6 L17 11 L15 11 Z" fill="#f66"/>
    </svg>`,
  'marathon':
    `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="16" cy="16" r="11" fill="none" stroke="#fc6" stroke-width="2"/>
      <text x="16" y="20" text-anchor="middle" font-size="11" font-weight="700" fill="#fc6">10</text>
    </svg>`,
  'alien-visit':
    `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <ellipse cx="16" cy="14" rx="7" ry="9" fill="#4dc"/>
      <ellipse cx="13" cy="13" rx="1.4" ry="2.2" fill="#222"/>
      <ellipse cx="19" cy="13" rx="1.4" ry="2.2" fill="#222"/>
      <path d="M12 19 Q16 22 20 19" stroke="#066" stroke-width="1.4" fill="none"/>
    </svg>`
};

function iconSvgFor(id) {
  return ACHIEVEMENT_ICONS[id] || ACHIEVEMENT_ICONS['perfect-landing'];
}

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
  if (overlay.toastIcon) overlay.toastIcon.innerHTML = iconSvgFor(def.id);
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
  if (el.hull && state.lander) {
    el.hull.textContent = `${state.lander.hp | 0}/${state.lander.maxHp | 0}`;
    const hpFrac = state.lander.maxHp ? state.lander.hp / state.lander.maxHp : 0;
    const hullState = hpFrac <= 0.2 ? 'danger' : hpFrac <= 0.5 ? 'warn' : 'ok';
    setGaugeClass(el.hull, hullState);
  }
  if (el.health && state.astronaut) {
    el.health.textContent = `${state.astronaut.hp | 0}/${state.astronaut.maxHp | 0}`;
    const aFrac = state.astronaut.maxHp ? state.astronaut.hp / state.astronaut.maxHp : 0;
    const healthState = aFrac <= 0.2 ? 'danger' : aFrac <= 0.5 ? 'warn' : 'ok';
    setGaugeClass(el.health, healthState);
  }
  if (el.carryRow && el.carry) {
    const carry = state.carrying || [];
    if (carry.length === 0) {
      el.carryRow.hidden = true;
    } else {
      el.carryRow.hidden = false;
      // Group by type so we don't show "FUEL × 3 / FUEL × 3 / PART × 5"
      const counts = {};
      for (const c of carry) counts[c.type] = (counts[c.type] || 0) + 1;
      el.carry.textContent = Object.entries(counts)
        .map(([t, n]) => `${t.toUpperCase()}×${n}`)
        .join(' · ');
    }
  }

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
