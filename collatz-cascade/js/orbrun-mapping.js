import * as THREE from 'three';
import { stoppingTime } from './collatz.js';

const TAU = Math.PI * 2;

export const DEFAULT_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Map an integer to a deterministic 3D position for Orb Run mode.
 *
 * Defaults are tuned for production readability:
 *   y = log2(n + 1) * heightScaleLarge
 *   r = stoppingTime(n) * radiusScale
 *   theta = (n * goldenAngle) mod 2π
 *
 * Prototype linear-height mode can be enabled via:
 *   { heightPolicy: 'prototype', scale }
 */
export function mapNumberToPosition(n, opts = {}) {
  if (!Number.isFinite(Number(n)) || Number(n) < 1) {
    throw new Error('mapNumberToPosition requires n >= 1');
  }

  const {
    heightPolicy = 'production',
    scale = 0.05,
    heightScaleLarge = 0.8,
    radiusScale = 0.5,
    goldenAngle = DEFAULT_GOLDEN_ANGLE,
  } = opts;

  const nNum = Number(n);
  // sqrt compresses long stopping-times so the cone stays compact:
  // stoppingTime 100 → r=5 vs linear r=60. The shape is preserved.
  const st = stoppingTime(n);
  const r = Math.sqrt(st) * radiusScale;

  const thetaRaw = nNum * goldenAngle;
  const theta = ((thetaRaw % TAU) + TAU) % TAU;

  const y = heightPolicy === 'prototype'
    ? nNum * scale
    : Math.log2(nNum + 1) * heightScaleLarge;

  const x = r * Math.cos(theta);
  const z = r * Math.sin(theta);

  return new THREE.Vector3(x, y, z);
}
