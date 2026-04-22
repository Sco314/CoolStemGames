// HUD.js — v0.2.0
// DOM-based HUD. Overlays the Three.js canvas with plain HTML/CSS. Per mode:
//   LANDER → altitude, h-speed, v-speed, angle, fuel, score
//   WALK   → fuel, score, walk inventory (kits/samples), objective tracker,
//            interaction prompts, comms blips

import { GameState, subscribe } from './GameState.js';
import { MODE } from './Constants.js';

// Cache DOM references once.
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

// Per-frame pull state — lander mode writes these before renderFrame().
const landerTelemetry = {
  altitude: 0,
  hSpeed:   0,
  vSpeed:   0,
  angleDeg: 0
};

let commsTimer = null;

export function initHUD() {
  subscribe(onStateChange);
  onStateChange(GameState, 'init');
  console.log('✅ HUD initialized');
}

export function setLanderTelemetry({ altitude, hSpeed, vSpeed, angleDeg }) {
  landerTelemetry.altitude = altitude;
  landerTelemetry.hSpeed   = hSpeed;
  landerTelemetry.vSpeed   = vSpeed;
  landerTelemetry.angleDeg = angleDeg;
}

export function renderFrame() {
  if (GameState.mode === MODE.LANDER || GameState.mode === MODE.TRANSITION) {
    el.alt.textContent    = pad(landerTelemetry.altitude.toFixed(0), 4);
    el.hspeed.textContent = landerTelemetry.hSpeed.toFixed(1).padStart(6);
    el.vspeed.textContent = landerTelemetry.vSpeed.toFixed(1).padStart(6);
    el.angle.textContent  = landerTelemetry.angleDeg.toFixed(1).padStart(6);
  }

  const t = GameState.timeElapsed;
  el.time.textContent = `${(t / 60) | 0}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

export function setCenterMessage(text) {
  el.center.textContent = text || '';
}

/**
 * Show a short comms blip that fades in and out. Subsequent calls replace the
 * current message and reset the fade-out timer.
 */
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

// ---- internal ----

function onStateChange(state /*, changeKey */) {
  // Score / fuel are shared across modes.
  el.score.textContent = pad(state.score, 4);
  el.fuel.textContent  = pad(state.fuel.current.toFixed(0), 4);

  // Walk-mode inventory rows are toggled by a body class; their values
  // update regardless so swap-in is instant when the mode changes.
  el.kits.textContent    = state.supplies.repairKits;
  el.samples.textContent = state.supplies.scienceSamples;

  // Mode-scoped HUD sections live behind a body.mode-walk class so the CSS
  // decides what's visible and the JS doesn't fight the layout.
  document.body.classList.toggle('mode-walk',   state.mode === MODE.WALK);
  document.body.classList.toggle('mode-lander', state.mode === MODE.LANDER);

  // Right-side telemetry is hidden in walk mode via CSS too, but leaving the
  // explicit visibility toggle in place keeps boot rendering stable.
  el.right.style.visibility = (state.mode === MODE.WALK) ? 'hidden' : 'visible';

  // Low-fuel / out-of-fuel alert.
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
  // Rebuild the list each change. Tiny DOM so the cost is negligible.
  el.objList.innerHTML = '';
  for (const o of state.objectives) {
    const li = document.createElement('li');
    li.textContent = o.label;
    if (o.done) li.classList.add('done');
    el.objList.appendChild(li);
  }
}

function pad(n, width) { return String(n).padStart(width, '0'); }
