// Input.js — v0.2.0
// Centralized keyboard / pointer-type state. Each mode reads what it cares
// about each frame rather than wiring its own listeners (avoids leaks on
// mode switch).
//
// Usage:
//   import { Input, initInput } from './Input.js';
//   import { BINDINGS } from './Constants.js';
//   initInput();
//   if (Input.isAnyDown(BINDINGS.WALK_FORWARD))   { ... }
//   if (Input.wasAnyPressed(BINDINGS.WALK_ACTION)) { ... }  // edge-triggered
//   if (Input.lastInputType === 'touch') { /* show touch prompt */ }
//
// Bindings live in Constants.js (`BINDINGS`) so the same array of keys is
// used across modes — adding an alternate key (e.g. ArrowUp as walk
// forward) is a one-line change there, not a hunt across files.

import { PREVENT_DEFAULT_KEYS } from './Constants.js';

const down = new Set();
const pressedThisFrame = new Set();

// Track which input device the player most recently used so prompts and
// HUD strings can adapt ("E or Space" vs an on-screen button label).
// Mutated by initInput()'s listeners + Touch.js's pointer/touch events.
let lastInputType = 'keyboardMouse';   // 'keyboardMouse' | 'touch'

export const Input = {
  isDown(key)      { return down.has(key); },
  wasPressed(key)  {
    if (pressedThisFrame.has(key)) {
      pressedThisFrame.delete(key);
      return true;
    }
    return false;
  },
  /** True if any of the keys in the binding array is currently held. */
  isAnyDown(keys) {
    for (let i = 0; i < keys.length; i++) {
      if (down.has(keys[i])) return true;
    }
    return false;
  },
  /** Edge-triggered: returns true once if any of the keys was pressed this
   *  frame, then clears the edge state for ALL keys in the array (so a
   *  binding like `['e', 'E', ' ']` doesn't fire twice when shift+E is
   *  used or Space and E are both bound). */
  wasAnyPressed(keys) {
    let hit = false;
    for (let i = 0; i < keys.length; i++) {
      if (pressedThisFrame.has(keys[i])) {
        pressedThisFrame.delete(keys[i]);
        hit = true;
      }
    }
    return hit;
  },
  /** Last device the player used. Read-only from outside this module. */
  get lastInputType() { return lastInputType; },
  /** Touch.js calls this on pointer/touch events to flip the type. */
  noteInputType(type) {
    if (type === 'touch' || type === 'keyboardMouse') {
      lastInputType = type;
    }
  },
  clearFrame() { /* reserved — call at end of frame if we add more edge state */ }
};

/**
 * Inject a synthetic key state, used by the touch-controls module so mobile
 * buttons flow through the same Input queries the desktop keyboard uses.
 */
export function setSyntheticKey(key, isDown) {
  if (isDown) {
    if (!down.has(key)) pressedThisFrame.add(key);
    down.add(key);
  } else {
    down.delete(key);
  }
}

/**
 * Skip preventDefault when the user is typing in a form / input — math
 * answer field, settings sliders, name-entry overlay, etc. Otherwise a
 * Space press in the answer box would silently get swallowed.
 */
function isTypingInForm() {
  const a = document.activeElement;
  if (!a || a === document.body) return false;
  const tag = a.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (a.isContentEditable) return true;
  return false;
}

export function initInput() {
  window.addEventListener('keydown', (e) => {
    // Suppress page scroll on Space + arrow keys when the game has focus.
    // Skip if the user is typing in a form so settings/math entries work.
    if (PREVENT_DEFAULT_KEYS.has(e.key) && !isTypingInForm()) {
      e.preventDefault();
    }
    if (!down.has(e.key)) pressedThisFrame.add(e.key);
    down.add(e.key);
    lastInputType = 'keyboardMouse';
  });
  window.addEventListener('keyup', (e) => {
    down.delete(e.key);
  });
  // A real mouse / trackpad pointer also flips the type back from 'touch'.
  // Pointer events with `pointerType === 'touch'` are handled by Touch.js
  // calling `Input.noteInputType('touch')`.
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      lastInputType = 'keyboardMouse';
    }
  });
  // Lose focus → release everything. Prevents "stuck thruster" bug when
  // user alt-tabs mid-burn.
  window.addEventListener('blur', () => {
    down.clear();
    pressedThisFrame.clear();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) down.clear();
  });
  console.log('✅ Input initialized');
}
