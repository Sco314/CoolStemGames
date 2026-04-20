import * as THREE from 'three';
import { valueKey } from './valueUtils.js';

const COLOR_ACTIVE_HIT = new THREE.Color(1.0, 0.85, 0.3);
const COLOR_DORMANT = new THREE.Color(0.3, 0.35, 0.5);
const COLOR_TERMINAL_LOOP = new THREE.Color(0.92, 0.22, 0.92);
// Non-trivial cycle (a repeat on a value that isn't 4/2/1) — reserved
// cyan that reads distinctly from the magenta terminal-loop and from
// any run's hue. Only reachable under custom rule variants.
const COLOR_NON_TRIVIAL_LOOP = new THREE.Color(0.25, 0.9, 1.0);
// Zero sink — custom rule variants that generate 0 mark it with a
// dark void color at world origin.
const COLOR_VOID = new THREE.Color(0.08, 0.04, 0.18);

function normalizedSeed(startValue) {
  const key = valueKey(startValue);
  let h = 2166136261; // FNV-1a 32-bit
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 360) / 360;
}

export function makeRunHue(startValue) {
  const hue = normalizedSeed(startValue);
  const color = new THREE.Color();
  color.setHSL(hue, 0.72, 0.56);
  return color;
}

// Accepts either a values[] (legacy) or a steps[] from buildOrbRunSequence.
// With steps[], `isRepeat` metadata lets us distinguish non-trivial cycles
// (repeats on values other than 4/2/1) from the normal terminal loop.
export function buildOrbRunRegistry(input) {
  const repeatSteps = new Set();
  const terminalLoopSteps = new Set();
  const nonTrivialLoopSteps = new Set();
  const voidSteps = new Set();

  const isStepShape = Array.isArray(input) && input.length > 0 && typeof input[0] === 'object' && 'value' in input[0];
  const getValue = (i) => isStepShape ? input[i].value : input[i];
  const getRepeat = (i) => isStepShape ? !!input[i].isRepeat : null;

  const seen = new Set();
  for (let i = 0; i < input.length; i++) {
    const v = getValue(i);
    const key = valueKey(v);
    const isRepeat = getRepeat(i) ?? seen.has(key);
    if (isRepeat) repeatSteps.add(i);
    seen.add(key);

    const isTerminalMember = v === 4 || v === 4n || v === 2 || v === 2n || v === 1 || v === 1n;
    if (isTerminalMember) terminalLoopSteps.add(i);
    if (v === 0 || v === 0n) voidSteps.add(i);
    // Non-trivial: a repeat on a value that isn't part of the standard 4→2→1 loop
    if (isRepeat && !isTerminalMember) nonTrivialLoopSteps.add(i);
  }

  return { repeatSteps, terminalLoopSteps, nonTrivialLoopSteps, voidSteps };
}

export function resolveOrbRunStyle({
  stepIdx,
  activated,
  isCurrentStep,
  runColor,
  registry,
  terminalLoopMarked,
  activationMix = 1,
}) {
  const isVoid = registry.voidSteps?.has(stepIdx);
  const isNonTrivialLoop = registry.nonTrivialLoopSteps?.has(stepIdx);
  const isTerminalMember = registry.terminalLoopSteps?.has(stepIdx);
  const isRepeat = registry.repeatSteps?.has(stepIdx);

  // Priority (highest first):
  //   1) void sink (value 0 under custom rules)
  //   2) non-trivial cycle members (reserved cyan)
  //   3) terminal 4/2/1 (magenta, after run finishes)
  //   4) in-run repeat on active value (run hue, higher intensity)
  //   5) current hit (yellow)
  //   6) activated past (run hue blend)
  //   7) dormant (dim)
  if (isVoid) {
    return { color: COLOR_VOID, emissive: COLOR_VOID, emissiveIntensity: 0.6, opacity: 1.0 };
  }
  if (isNonTrivialLoop) {
    return { color: COLOR_NON_TRIVIAL_LOOP, emissive: COLOR_NON_TRIVIAL_LOOP, emissiveIntensity: 0.85, opacity: 1.0 };
  }
  if (terminalLoopMarked && isTerminalMember) {
    return { color: COLOR_TERMINAL_LOOP, emissive: COLOR_TERMINAL_LOOP, emissiveIntensity: 0.9, opacity: 1.0 };
  }
  if (isRepeat) {
    return { color: runColor, emissive: runColor, emissiveIntensity: 0.45, opacity: 1.0 };
  }
  if (isCurrentStep) {
    return { color: COLOR_ACTIVE_HIT, emissive: COLOR_ACTIVE_HIT, emissiveIntensity: 0.7, opacity: 1.0 };
  }
  if (activated) {
    const blended = COLOR_ACTIVE_HIT.clone().lerp(runColor, Math.max(0, Math.min(1, activationMix)));
    return { color: blended, emissive: blended, emissiveIntensity: 0.35, opacity: 1.0 };
  }
  return { color: COLOR_DORMANT, emissive: COLOR_DORMANT, emissiveIntensity: 0.1, opacity: 0.4 };
}
