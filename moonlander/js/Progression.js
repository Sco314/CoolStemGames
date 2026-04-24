// Progression.js — v0.1.0
// Pure, stateless helpers that turn a `level` integer (GameState.level) into
// the effective gameplay values used by LanderMode and WalkMode. Keeping
// these in one place makes the difficulty curve tunable from a single file
// and avoids LanderMode growing a `if level > X` ladder.
//
// Usage:
//   import { effectiveGravity } from './Progression.js';
//   const g = effectiveGravity(GameState.level);

import {
  GRAVITY,
  LANDING_VELOCITY_TOLERANCE, LANDING_EDGE_MARGIN_FRAC,
  DIFFICULTY_GRAVITY_PER_LEVEL, DIFFICULTY_TOLERANCE_FLOOR, DIFFICULTY_TOLERANCE_STEP,
  DIFFICULTY_EDGE_MARGIN_STEP, DIFFICULTY_EDGE_MARGIN_CAP,
  DIFFICULTY_SPAWN_VEL_BASE, DIFFICULTY_SPAWN_VEL_STEP,
  DIFFICULTY_FUEL_GAIN_STEP, DIFFICULTY_FUEL_GAIN_FLOOR_FRAC
} from './Constants.js';

export function effectiveGravity(level) {
  return GRAVITY * (1 + level * DIFFICULTY_GRAVITY_PER_LEVEL);
}

export function effectiveLandingVelocityTolerance(level) {
  return Math.max(
    DIFFICULTY_TOLERANCE_FLOOR,
    LANDING_VELOCITY_TOLERANCE - level * DIFFICULTY_TOLERANCE_STEP
  );
}

export function effectiveEdgeMarginFrac(level) {
  return Math.min(
    DIFFICULTY_EDGE_MARGIN_CAP,
    LANDING_EDGE_MARGIN_FRAC + level * DIFFICULTY_EDGE_MARGIN_STEP
  );
}

export function effectiveSpawnVelocity(level) {
  return DIFFICULTY_SPAWN_VEL_BASE + level * DIFFICULTY_SPAWN_VEL_STEP;
}

export function effectiveFuelGain(level, base) {
  const floor = base * DIFFICULTY_FUEL_GAIN_FLOOR_FRAC;
  return Math.max(floor, base - level * DIFFICULTY_FUEL_GAIN_STEP);
}
