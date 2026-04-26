// GameState.js — v0.3.0
// This is the "store" discussed in the design conversation. Both the lander
// mode and the walk mode read from and write to this object. Nothing else
// crosses the boundary between modes.
//
// Keep this file SEMANTIC, not VISUAL. Store fuel amounts, mission progress,
// landing coordinates — never camera positions, mesh references, or particle
// pools. Those belong to whichever mode owns them and get disposed on exit.
//
// Phase 6 additions:
//   - `level` counter (run-local, bumps on each successful landing)
//   - `highScores`, `achievements`, `stats` (profile-level, persist forever)
//   - `settings` (master volume, invert-Y — applied on load)
//   - startNewRun() / commitRunToHighScores() / unlockAchievement()

import {
  STARTING_FUEL, MODE, OBJECTIVES, LEVEL_OBJECTIVES, ACHIEVEMENTS, HIGH_SCORE_SLOTS,
  LANDER_MAX_HP, ASTRO_MAX_HP,
  apolloSiteForLevel
} from './Constants.js';

export const GameState = {
  // ----- Mission state -----
  mode: MODE.BOOT,
  previousMode: null,

  // ----- Resources (run-local) -----
  fuel:     { current: STARTING_FUEL, capacity: STARTING_FUEL },
  supplies: { repairKits: 0, scienceSamples: 0 },
  lander:   { hp: LANDER_MAX_HP, maxHp: LANDER_MAX_HP, wrecked: false },
  astronaut:{ hp: ASTRO_MAX_HP,  maxHp: ASTRO_MAX_HP },
  // Snapshot of the most recent stow action (Batch 4 #11). Cleared once the
  // carry-summary panel has displayed for the walk→lander transition.
  lastStowed: null,
  // Items the astronaut is carrying in walk mode but hasn't deposited at
  // the lander yet. Each entry: { type, amount }. Cleared on stow.
  // **Persists across runs** (Rev 2 #14): startNewRun deliberately leaves
  // this alone, and save() already serializes it, so the next commander
  // inherits whatever the previous one was holding when they died / quit.
  carrying: [],
  // Items dropped on the moon surface from the carry inventory. Each
  // entry: { id, type, x, z }. Persisted across runs alongside carrying.
  // WalkMode.spawnInteractables respawns them at the same world coords;
  // picking one back up removes it from this list by `id`.
  droppedItems: [],
  // Monotonic id assigned to dropped-and-persisted items so picking one
  // up can target the exact entry without index-shift races.
  nextDropId: 1,

  // ----- Scoring (run-local) -----
  score: 0,
  timeElapsed: 0,
  landingsCompleted: 0,
  level: 0,                     // bumps on each successful landing

  // ----- Handoff between modes -----
  lastLanding: {
    x: 0,
    terrainSegmentIndex: -1,
    surfaceNormal: null,
    fuelAtLanding: STARTING_FUEL, // snapshot for the hot-swap achievement
    padCenterX: 0,                // world-x of the landed pad's center
    padWidth: 0,                  // width of the landed pad
    padKind: 'plain',             // 'beginner' | 'bonus' | 'plain'
    padMultiplier: 1              // X2/X3/X5 on bonus pads
  },

  // ----- Flags (run-local) -----
  hasLanded: false,
  hasFuel: true,
  isAlerted: false,
  debug: false,
  flags: {
    probeRepaired:    false,
    walkTutorialSeen: false,
    habitatVisited:   false,         // any habitat visited this run
    apolloVisited:    {},            // map of apollo-id → true
    boardedThisLevel: false,         // flips true when the astronaut climbs back into the lander
    lowFuelReturnFired: false        // gates the CAPCOM low-fuel-return blip per walk session
  },

  // ----- Objective tracker (run-local) -----
  objectives: OBJECTIVES.map(o => ({ id: o.id, label: o.label, done: false })),

  // ----- High scores (profile-level) -----
  // { score, level, landings, timestamp } sorted score-desc, top HIGH_SCORE_SLOTS.
  highScores: [],

  // ----- Achievements (profile-level) -----
  // Map id → { unlocked: true, at: timestampMs }. Undefined means locked.
  achievements: {},

  // ----- Profile stats (cumulative across runs, for achievements) -----
  stats: {
    totalSamples: 0,
    totalProbesRepaired: 0,
    partsStowed: 0,           // repair parts deposited at the lander (career)
    mathSolved: 0             // STEM-challenge correct answers (career)
  },

  // ----- User settings (profile-level) -----
  // `muted` ships true — the game starts silent so the page doesn't blast
  // anything before the player has engaged with it. Unmute via the corner
  // button or the settings panel. When unmuted, the Sound layer applies
  // `masterVolume`; when muted, every sound is effectively zero.
  settings: {
    masterVolume: 0.8,
    musicVolume:  0.4,    // music slider, independent of master (Batch 4 #13)
    muted:        true,
    invertY:      false,
    // Decorative slider on the settings overlay. Stored 0–100 (integer).
    // The triplet (master=19, music=69, lunar=11) is a hidden cheat code
    // that drops the player straight into walk-mode level 1 with low fuel
    // next to a drum — see HUD.js:checkLunarCheat for the trigger and
    // Main.js:startCheatRun for the destination.
    lunar:        0
  }
};

// ----- Event bus -----
const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(changeKey = '*') {
  for (const fn of listeners) fn(GameState, changeKey);
}

export function update(fn, changeKey = '*') {
  fn(GameState);
  notify(changeKey);
}

/**
 * Synthetic "return to the lander and board" objective appended to every
 * level. Predicate is GameState.flags.boardedThisLevel — set in WalkMode
 * when the astronaut presses E next to the lander, cleared in LanderMode
 * after each successful landing so the next level re-arms the prompt.
 */
const RETURN_TO_LANDER_OBJECTIVE = {
  id: 'return-to-lander',
  label: 'Return to the lander and board',
  predicate: s => s.flags.boardedThisLevel === true
};

/**
 * Build a lookup of every defined objective predicate (career + per-level).
 * Used by refreshObjectives so it can find a matching def regardless of
 * which list the objective came from.
 */
function _allObjectiveDefs() {
  const out = [...OBJECTIVES, RETURN_TO_LANDER_OBJECTIVE];
  for (const arr of Object.values(LEVEL_OBJECTIVES)) out.push(...arr);
  return out;
}

/**
 * Re-evaluates every objective predicate against the current state. Returns
 * the ids that flipped to done on this call.
 */
export function refreshObjectives() {
  const allDefs = _allObjectiveDefs();
  const justCompleted = [];
  for (const entry of GameState.objectives) {
    if (entry.done) continue;
    const def = allDefs.find(d => d.id === entry.id);
    if (def && def.predicate(GameState)) {
      entry.done = true;
      justCompleted.push(entry.id);
    }
  }
  return justCompleted;
}

/**
 * Replace GameState.objectives with the career list + the current level's
 * per-Apollo-site objectives. Preserves done-state for matching ids so
 * career objectives and re-visited per-level ones stay checked.
 */
export function setObjectivesForLevel(level) {
  const site = apolloSiteForLevel(level);
  const lvlDefs = (site && LEVEL_OBJECTIVES[site.id]) || [];
  // Career objectives, this level's per-Apollo briefs, then the synthetic
  // "return to the lander" closer so the player always sees the trip home
  // as the final unchecked item.
  const merged = [...OBJECTIVES, ...lvlDefs, RETURN_TO_LANDER_OBJECTIVE];
  const doneById = {};
  for (const o of (GameState.objectives || [])) doneById[o.id] = o.done;
  GameState.objectives = merged.map(def => ({
    id: def.id,
    label: def.label,
    done: !!doneById[def.id]
  }));
  // Re-evaluate immediately so already-true predicates aren't shown as
  // unchecked just because we rebuilt the list.
  refreshObjectives();
  notify('objectives');
}

/**
 * Reset run-local state for a new attempt but keep profile-level data
 * (high scores, achievements, stats, settings) intact.
 */
export function startNewRun() {
  GameState.fuel.current = GameState.fuel.capacity;
  GameState.supplies.repairKits = 0;
  GameState.supplies.scienceSamples = 0;
  GameState.lander = { hp: LANDER_MAX_HP, maxHp: LANDER_MAX_HP, wrecked: false };
  GameState.astronaut = { hp: ASTRO_MAX_HP, maxHp: ASTRO_MAX_HP };
  // GameState.carrying intentionally NOT reset — Rev 2 #14 persists the
  // astronaut's pack across runs. Save() already serializes it; whatever
  // the player was holding when their last run ended (or quit) carries
  // forward into the next commander's pack and stows on first arrival.
  // GameState.droppedItems is also intentionally preserved — drops sit
  // on the moon waiting to be picked up across runs (matches the
  // moon's physical permanence — there's no janitor).
  // The carry-summary cinematic still clears `lastStowed` between
  // transitions, but reset it defensively so a stale snapshot can't
  // resurface in the new run's first stow beat.
  GameState.lastStowed = null;
  GameState.score = 0;
  GameState.timeElapsed = 0;
  GameState.landingsCompleted = 0;
  GameState.level = 0;
  GameState.hasLanded = false;
  GameState.hasFuel = true;
  GameState.isAlerted = false;
  // walkTutorialSeen is profile-level, not run-level — preserve across restarts.
  GameState.flags = {
    probeRepaired:      false,
    walkTutorialSeen:   GameState.flags?.walkTutorialSeen === true,
    habitatVisited:     false,
    apolloVisited:      {},
    boardedThisLevel:   false,
    lowFuelReturnFired: false
  };
  GameState.objectives = OBJECTIVES.map(o => ({ id: o.id, label: o.label, done: false }));
  GameState.lastLanding = {
    x: 0,
    terrainSegmentIndex: -1,
    surfaceNormal: null,
    fuelAtLanding: GameState.fuel.capacity,
    padCenterX: 0,
    padWidth: 0,
    padKind: 'plain',
    padMultiplier: 1
  };
  notify('new-run');
}

/**
 * Commit the current run's final score to highScores and persist. Returns
 * the rank (1-indexed) on the board or null if the score didn't qualify.
 */
export function commitRunToHighScores() {
  const entry = {
    score: GameState.score,
    level: GameState.level,
    landings: GameState.landingsCompleted,
    timestamp: Date.now()
  };
  GameState.highScores.push(entry);
  GameState.highScores.sort((a, b) => b.score - a.score);
  GameState.highScores.length = Math.min(GameState.highScores.length, HIGH_SCORE_SLOTS);
  save();
  const rank = GameState.highScores.indexOf(entry);
  return rank >= 0 ? rank + 1 : null;
}

/**
 * Unlock an achievement if it's not already unlocked. Returns the definition
 * on the first-unlock call so the caller can show a toast; returns null on
 * repeat calls.
 */
export function unlockAchievement(id) {
  if (GameState.achievements[id]?.unlocked) return null;
  const def = ACHIEVEMENTS.find(a => a.id === id);
  if (!def) { console.warn(`Unknown achievement id: ${id}`); return null; }
  GameState.achievements[id] = { unlocked: true, at: Date.now() };
  save();
  notify('achievement');
  return def;
}

// ----- Save/load -----
// Because GameState is a plain object of semantic values, serialization is trivial.
// v3 (Phase 6): added level, highScores, achievements, stats, settings; old
// saves are read-forward compatible — unknown keys are ignored, missing keys
// fall back to defaults.
const SAVE_KEY = 'moonlander.save.v3';

export function save() {
  try {
    const snapshot = JSON.parse(JSON.stringify(GameState));
    // Strip things that shouldn't persist across sessions.
    snapshot.mode = MODE.BOOT;
    snapshot.previousMode = null;
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
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
    // Shallow-merge at the top level so defaults for newer fields survive.
    for (const k of Object.keys(data)) {
      if (k in GameState) GameState[k] = data[k];
    }
    // Run-local fields should never persist; force a clean run slate.
    GameState.mode = MODE.BOOT;
    GameState.previousMode = null;
    notify('load');
    console.log('✅ Save loaded');
    return true;
  } catch (err) {
    console.error('❌ Load failed:', err.message, '— starting fresh');
    return false;
  }
}
