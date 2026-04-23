// Input.js — v0.1.0
// Centralized keyboard state. Each mode reads what it cares about each frame
// rather than wiring its own listeners (avoids leaks on mode switch).
//
// Usage:
//   import { Input, initInput } from './Input.js';
//   initInput();
//   if (Input.isDown('ArrowUp')) { ... }
//   if (Input.wasPressed('p'))   { ... }  // edge-triggered, clears after read

const down = new Set();
const pressedThisFrame = new Set();

export const Input = {
  isDown(key)      { return down.has(key); },
  wasPressed(key)  {
    if (pressedThisFrame.has(key)) {
      pressedThisFrame.delete(key);
      return true;
    }
    return false;
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

export function initInput() {
  window.addEventListener('keydown', (e) => {
    if (!down.has(e.key)) pressedThisFrame.add(e.key);
    down.add(e.key);
  });
  window.addEventListener('keyup', (e) => {
    down.delete(e.key);
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
