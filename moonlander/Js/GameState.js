// GameState.js — v0.1.0
// This is the "store" discussed in the design conversation. Both the lander
// mode and the walk mode read from and write to this object. Nothing else
// crosses the boundary between modes.
//
// Keep this file SEMANTIC, not VISUAL. Store fuel amounts, mission progress,
// landing coordinates — never camera positions, mesh references, or particle
// pools. Those belong to whichever mode owns them and get disposed on exit.

import { STARTING_FUEL, MODE } from './Constants.js';

export const GameState = {
  // ----- Mission state -----
  mode: MODE.BOOT,              // current top-level mode
  previousMode: null,           // useful for transitions and unpausing

  // ----- Resources -----
  fuel: {
    current: STARTING_FUEL,
    capacity: STARTING_FUEL
  },
  supplies: {
    repairKits: 0,
    oxygenCanisters: 0
  },

  // ----- Scoring -----
  score: 0,
  timeElapsed: 0,               // seconds since game start
  landingsCompleted: 0,

  // ----- Handoff between modes -----
  // When the lander touches down we record where, so the walk scene can
  // spawn the astronaut next to the parked lander. When the astronaut
  // returns and re-enters, we read this back.
  lastLanding: {
    x: 0,                       // world x-coordinate of landing site
    terrainSegmentIndex: -1,    // which segment of the terrain polyline
    surfaceNormal: null         // THREE.Vector2 — set by lander on land
  },

  // ----- Flags -----
  hasLanded: false,
  hasFuel: true,
  isAlerted: false,              // low-fuel alert currently showing
  debug: false
};

// ----- Tiny event bus so the HUD (or anything else) can react to changes
// without polling. Not reactive-framework-fancy; just enough to be useful. -----
const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(changeKey = '*') {
  for (const fn of listeners) fn(GameState, changeKey);
}

// Convenience mutator that auto-notifies. Use when you want subscribers to hear.
// For high-frequency per-frame updates (position, velocity), mutate GameState
// directly without notify() and let the renderer/HUD pull on each frame.
export function update(fn, changeKey = '*') {
  fn(GameState);
  notify(changeKey);
}

// ----- Save/load -----
// Because GameState is a plain object of semantic values, serialization is trivial.
// Version the save format so future-you can migrate old saves.
const SAVE_KEY = 'moonlander.save.v1';

export function save() {
  try {
    const snapshot = JSON.parse(JSON.stringify(GameState)); // deep clone via JSON
    // Strip things that shouldn't persist (e.g., transient mode).
    snapshot.mode = MODE.BOOT;
    snapshot.previousMode = null;
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
    console.log('✅ Game saved');
    return true;
  } catch (err) {
    console.error('❌ Save failed:', err.message);
    return false;
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      console.log('ℹ️ No save found — starting fresh');
      return false;
    }
    const data = JSON.parse(raw);
    Object.assign(GameState, data);
    notify('load');
    console.log('✅ Save loaded');
    return true;
  } catch (err) {
    console.error('❌ Load failed:', err.message, '— starting fresh');
    return false;
  }
}
