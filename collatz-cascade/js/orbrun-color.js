import * as THREE from 'three';
import { valueKey } from './valueUtils.js';

const COLOR_ACTIVE_HIT = new THREE.Color(1.0, 0.85, 0.3);
const COLOR_DORMANT = new THREE.Color(0.3, 0.35, 0.5);
const COLOR_TERMINAL_LOOP = new THREE.Color(0.92, 0.22, 0.92);

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

export function buildOrbRunRegistry(sequence) {
  const seen = new Set();
  const repeatSteps = new Set();
  const terminalLoopSteps = new Set();

  for (let i = 0; i < sequence.length; i++) {
    const key = valueKey(sequence[i]);
    if (seen.has(key)) repeatSteps.add(i);
    seen.add(key);

    if (sequence[i] === 4 || sequence[i] === 4n ||
        sequence[i] === 2 || sequence[i] === 2n ||
        sequence[i] === 1 || sequence[i] === 1n) {
      terminalLoopSteps.add(i);
    }
  }

  return { repeatSteps, terminalLoopSteps };
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
  const isLoop = registry.repeatSteps.has(stepIdx)
    || (terminalLoopMarked && registry.terminalLoopSteps.has(stepIdx));

  // Priority:
  // 1) loop/repeat  2) active hit  3) revealed-by-run  4) dormant
  if (isLoop) {
    return {
      color: terminalLoopMarked ? COLOR_TERMINAL_LOOP : runColor,
      emissive: terminalLoopMarked ? COLOR_TERMINAL_LOOP : runColor,
      emissiveIntensity: terminalLoopMarked ? 0.9 : 0.45,
      opacity: 1.0,
    };
  }

  if (isCurrentStep) {
    return {
      color: COLOR_ACTIVE_HIT,
      emissive: COLOR_ACTIVE_HIT,
      emissiveIntensity: 0.7,
      opacity: 1.0,
    };
  }

  if (activated) {
    const blended = COLOR_ACTIVE_HIT.clone().lerp(runColor, Math.max(0, Math.min(1, activationMix)));
    return {
      color: blended,
      emissive: blended,
      emissiveIntensity: 0.35,
      opacity: 1.0,
    };
  }

  return {
    color: COLOR_DORMANT,
    emissive: COLOR_DORMANT,
    emissiveIntensity: 0.1,
    opacity: 0.4,
  };
}
