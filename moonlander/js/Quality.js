// Quality.js — v0.1.0
// Adaptive-quality controller. Watches frame times, flips a "low" flag if
// the running average drops below 30 FPS for a sustained window, and flips
// back to "high" once the average recovers above 55 FPS.
//
// Consumers read getQualityFactor() before emitting particles and subscribe
// via onQualityChange() to toggle more expensive effects (fog, shadows).
//
// The thresholds match Phase-7 guidance in gamecreationguide.md.

const FRAME_WINDOW     = 120;   // ≈ 2 s at 60 fps
const LOW_FPS_THRESH   = 30;
const HIGH_FPS_THRESH  = 55;

let samples = [];
let quality = 'high';                // 'high' | 'low'
const listeners = new Set();

export function sampleFps(dt) {
  if (dt <= 0) return;
  samples.push(1 / dt);
  if (samples.length > FRAME_WINDOW) samples.shift();
  evaluate();
}

export function getQuality() { return quality; }

/** Multiplier applied to particle emit rates and max-count budgets. */
export function getQualityFactor() {
  return quality === 'low' ? 0.4 : 1.0;
}

export function onQualityChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function evaluate() {
  if (samples.length < FRAME_WINDOW * 0.5) return;
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (avg < LOW_FPS_THRESH && quality === 'high') {
    quality = 'low';
    console.log(`[Quality] LOW (avg ${avg.toFixed(1)} fps)`);
    fire();
  } else if (avg > HIGH_FPS_THRESH && quality === 'low') {
    quality = 'high';
    console.log(`[Quality] HIGH (avg ${avg.toFixed(1)} fps)`);
    fire();
  }
}

function fire() {
  for (const fn of listeners) {
    try { fn(quality); } catch (err) { console.error('[Quality listener]', err); }
  }
}
