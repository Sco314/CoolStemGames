// HUD.js — v0.1.0
// DOM-based HUD. Unlike tblazevic's canvas HUD rendered into a second Three.js
// scene, we use plain HTML/CSS overlaid on the canvas. Simpler, cheaper,
// survives mode switches unchanged, and styleable with CSS.
//
// The HUD shows different info per mode:
//   LANDER → altitude, h-speed, v-speed, angle, fuel, score
//   WALK   → simpler: fuel, score, interaction prompts

import { GameState, subscribe } from './GameState.js';
import { MODE } from './Constants.js';

// Cache DOM references once.
const el = {
  score:  document.getElementById('hud-score'),
  time:   document.getElementById('hud-time'),
  fuel:   document.getElementById('hud-fuel'),
  alert:  document.getElementById('hud-alert'),
  alt:    document.getElementById('hud-alt'),
  hspeed: document.getElementById('hud-hspeed'),
  vspeed: document.getElementById('hud-vspeed'),
  angle:  document.getElementById('hud-angle'),
  center: document.getElementById('hud-center'),
  right:  document.getElementById('hud-right')
};

// Per-frame pull state — lander mode writes these before renderFrame().
const landerTelemetry = {
  altitude: 0,
  hSpeed:   0,
  vSpeed:   0,
  angleDeg: 0
};

export function initHUD() {
  // Subscribe to semantic state changes (score, fuel, mode). These don't
  // happen every frame so the event-bus approach is cheap.
  subscribe(onStateChange);
  onStateChange(GameState, 'init');
  console.log('✅ HUD initialized');
}

// Called every frame by Main.js after mode update, with fresh telemetry.
export function setLanderTelemetry({ altitude, hSpeed, vSpeed, angleDeg }) {
  landerTelemetry.altitude = altitude;
  landerTelemetry.hSpeed   = hSpeed;
  landerTelemetry.vSpeed   = vSpeed;
  landerTelemetry.angleDeg = angleDeg;
}

export function renderFrame() {
  // Only update telemetry DOM if we're in a mode that shows it.
  if (GameState.mode === MODE.LANDER || GameState.mode === MODE.TRANSITION) {
    el.alt.textContent    = pad(landerTelemetry.altitude.toFixed(0), 4);
    el.hspeed.textContent = landerTelemetry.hSpeed.toFixed(1).padStart(6);
    el.vspeed.textContent = landerTelemetry.vSpeed.toFixed(1).padStart(6);
    el.angle.textContent  = landerTelemetry.angleDeg.toFixed(1).padStart(6);
  }

  // Update the timer (semantic but too fine-grained for the event bus).
  const t = GameState.timeElapsed;
  el.time.textContent = `${(t / 60) | 0}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

export function setCenterMessage(text) {
  el.center.textContent = text || '';
}

// ---- internal ----

function onStateChange(state /*, changeKey */) {
  el.score.textContent = pad(state.score, 4);
  el.fuel.textContent  = pad(state.fuel.current.toFixed(0), 4);

  // Hide the right-side telemetry panel when walking — it's irrelevant.
  el.right.style.visibility = (state.mode === MODE.WALK) ? 'hidden' : 'visible';

  // Low fuel / out of fuel alert
  if (state.isAlerted) {
    el.alert.hidden = false;
    el.alert.textContent = state.hasFuel ? 'LOW ON FUEL' : 'OUT OF FUEL';
  } else {
    el.alert.hidden = true;
  }
}

function pad(n, width) { return String(n).padStart(width, '0'); }
