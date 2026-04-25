// Touch.js — v0.1.0
// Mobile touch controls. Renders on touch-capable devices only. Three buttons
// for lander mode (LEFT, THRUST, RIGHT) and a small joystick + INTERACT
// button for walk mode. The buttons inject synthetic keypresses through the
// existing Input module so LanderMode / WalkMode need no awareness of touch.
//
// Mode gating is done via body.mode-* classes (already toggled by HUD.js):
//   body.mode-lander → lander buttons visible
//   body.mode-walk   → walk joystick visible
// Other modes: controls hidden.

import { setSyntheticKey } from './Input.js';

const TOUCH_SUPPORTED = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

/** Called once at boot. No-op on non-touch devices. */
export function initTouchControls() {
  if (!TOUCH_SUPPORTED) return;
  document.body.classList.add('touch');

  bindHoldButton('touch-left',   'ArrowLeft');
  bindHoldButton('touch-right',  'ArrowRight');
  bindHoldButton('touch-thrust', 'ArrowUp');
  // No-op if the element is missing — the walk-mode E button was removed
  // in favor of canvas tap-to-interact (see js/modes/WalkMode.js bindMouse).
  bindTapButton('touch-interact', 'e');

  bindJoystick();
}

/** Button that sets the synthetic key while being touched/held. */
function bindHoldButton(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  const press = (e) => { e.preventDefault(); setSyntheticKey(key, true); el.classList.add('pressed'); };
  const release = (e) => { e.preventDefault(); setSyntheticKey(key, false); el.classList.remove('pressed'); };
  el.addEventListener('touchstart', press, { passive: false });
  el.addEventListener('touchend',   release);
  el.addEventListener('touchcancel', release);
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup',   release);
  el.addEventListener('pointerleave', release);
}

/** Button that edge-triggers a keypress on tap (short hold). */
function bindTapButton(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  const tap = (e) => {
    e.preventDefault();
    setSyntheticKey(key, true);
    setTimeout(() => setSyntheticKey(key, false), 50);
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 120);
  };
  el.addEventListener('touchstart', tap, { passive: false });
  el.addEventListener('pointerdown', tap);
}

// ----- Walk-mode joystick -----
// Four-directional: a drag inside the pad maps to WASD. We don't try to be
// analog-precise — the keyboard events are discrete anyway.

function bindJoystick() {
  const pad   = document.getElementById('touch-pad');
  const thumb = document.getElementById('touch-thumb');
  if (!pad || !thumb) return;

  let activeId = null;
  let centerX = 0, centerY = 0;
  let radius = 40;

  const setKeys = (dx, dy) => {
    const mag = Math.hypot(dx, dy);
    if (mag < radius * 0.25) {
      setSyntheticKey('w', false); setSyntheticKey('s', false);
      setSyntheticKey('a', false); setSyntheticKey('d', false);
      return;
    }
    setSyntheticKey('w', dy < -radius * 0.25);
    setSyntheticKey('s', dy >  radius * 0.25);
    setSyntheticKey('a', dx < -radius * 0.25);
    setSyntheticKey('d', dx >  radius * 0.25);
  };

  const start = (e) => {
    if (activeId !== null) return;
    const t = e.touches ? e.touches[0] : e;
    activeId = t.identifier ?? 'mouse';
    const rect = pad.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top  + rect.height / 2;
    radius  = Math.min(rect.width, rect.height) / 2;
    move(e);
  };
  const move = (e) => {
    if (activeId === null) return;
    const touches = e.touches || [e];
    let t = null;
    for (const touch of touches) {
      if ((touch.identifier ?? 'mouse') === activeId) { t = touch; break; }
    }
    if (!t) return;
    const dx = t.clientX - centerX;
    const dy = t.clientY - centerY;
    const mag = Math.hypot(dx, dy);
    const clamped = Math.min(1, mag / radius);
    const nx = mag ? (dx / mag) : 0;
    const ny = mag ? (dy / mag) : 0;
    thumb.style.transform = `translate(${nx * clamped * radius}px, ${ny * clamped * radius}px)`;
    setKeys(dx, dy);
  };
  const end = (e) => {
    if (activeId === null) return;
    const touches = e.touches || [];
    let stillThere = false;
    for (const touch of touches) {
      if ((touch.identifier ?? 'mouse') === activeId) { stillThere = true; break; }
    }
    if (!stillThere) {
      activeId = null;
      thumb.style.transform = 'translate(0, 0)';
      setKeys(0, 0);
    }
  };

  pad.addEventListener('touchstart', start, { passive: true });
  pad.addEventListener('touchmove',  move,  { passive: true });
  pad.addEventListener('touchend',   end);
  pad.addEventListener('touchcancel', end);
}
