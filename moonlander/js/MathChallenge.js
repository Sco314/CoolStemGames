// MathChallenge.js — v0.1.0
// STEM-themed math question generator + answer validator. Powers the
// "STEM CHALLENGE" corner button in walk mode. Questions are bounded
// (small integers / one-decimal answers) so kids can solve mentally and
// type into a number input.
//
// Each generator returns:
//   { title, body, answer, unit, tolerance, score }
// `tolerance` is absolute (0 = exact) and applies to numeric comparisons.

const GENERATORS = [
  o2Tank,
  fuelBurn,
  fallSpeed,
  walkTime
];

/** Pick a random generator and produce a fresh challenge. */
export function generateChallenge() {
  const fn = GENERATORS[Math.floor(Math.random() * GENERATORS.length)];
  return fn();
}

/** Validate a player's typed answer. Returns { correct: bool, expected }. */
export function validate(spec, raw) {
  if (raw == null || raw === '') return { correct: false, expected: spec.answer };
  const v = Number(raw);
  if (!Number.isFinite(v)) return { correct: false, expected: spec.answer };
  const tol = spec.tolerance ?? 0;
  return { correct: Math.abs(v - spec.answer) <= tol, expected: spec.answer };
}

// ---------- generators ----------

function o2Tank() {
  // O₂ tank: rate L/min, capacity L → minutes of breathing.
  const rate = pickFromArr([0.4, 0.5, 0.8, 1.0]);    // L/min
  const minutes = randInt(8, 20);
  const tank = +(rate * minutes).toFixed(1);
  return {
    title: 'O₂ MATH',
    body:
      `Your suit's O₂ regulator burns ${rate} L per minute. The tank holds ` +
      `${tank} L. How many minutes of life support do you have?`,
    answer: minutes,
    unit: 'minutes',
    tolerance: 0,
    score: 100
  };
}

function fuelBurn() {
  // Burn rate × seconds of thrust.
  const rate = pickFromArr([4, 6, 8, 10, 12]);       // fuel/sec
  const seconds = randInt(3, 15);
  return {
    title: 'FUEL MATH',
    body:
      `The descent engine burns ${rate} fuel per second. If you fire it ` +
      `for ${seconds} seconds, how much fuel do you spend?`,
    answer: rate * seconds,
    unit: 'fuel',
    tolerance: 0,
    score: 100
  };
}

function fallSpeed() {
  // v = g·t with moon gravity 1.62 m/s²; round answer to one decimal.
  const t = pickFromArr([2, 3, 4, 5, 6]);            // seconds of free fall
  const g = 1.62;
  const v = +(g * t).toFixed(2);
  return {
    title: 'GRAVITY MATH',
    body:
      `Moon gravity is ${g} m/s². Starting from rest, after ${t} seconds ` +
      `of free fall, how fast are you moving (m/s)? Round to one decimal.`,
    answer: +v.toFixed(1),
    unit: 'm/s',
    tolerance: 0.05,
    score: 150
  };
}

function walkTime() {
  // distance / speed = time in seconds.
  const speed = 18;                                  // matches WALK_SPEED
  const dist  = pickFromArr([18, 36, 54, 72, 90]);   // walk-mode units
  return {
    title: 'WALK MATH',
    body:
      `Your astronaut walks at ${speed} units per second. How many seconds ` +
      `does it take to cross ${dist} units of regolith?`,
    answer: dist / speed,
    unit: 'seconds',
    tolerance: 0.05,
    score: 100
  };
}

// ---------- helpers ----------

function randInt(lo, hi) { return Math.floor(lo + Math.random() * (hi - lo + 1)); }
function pickFromArr(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
