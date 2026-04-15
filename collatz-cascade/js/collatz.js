/**
 * Pure math module for the Collatz conjecture.
 * Works with both Number (fast path) and BigInt (arbitrary precision).
 */

import { isBig, isEven, isOne, nextCollatz, valueKey, toValue } from './valueUtils.js';

const cache = new Map();                 // key → sequence array
const MAX_ITERATIONS = 50000;            // safety cap on any sequence length

/**
 * Get just the values in the Collatz sequence from n down to 1.
 * Handles Number and BigInt inputs; output may be mixed.
 *
 * Uses shared-tail memoization: every Collatz sequence eventually
 * funnels into the same tail (…→16→8→4→2→1), and many sequences
 * share long sub-tails with each other. We cache every sub-sequence
 * we see so that future calls splice an existing tail instead of
 * recomputing it. For Fill operations this turns O(N × avgLen) into
 * roughly O(N + uniqueValues) — typically ~50× faster.
 */
export function collatzValues(n) {
  const start = toValue(n);
  if (start == null) return [];

  const startKey = valueKey(start);
  const cached = cache.get(startKey);
  if (cached) return cached.slice();

  // Walk forward until we hit 1 or land on something already cached.
  const prefix = [];
  let current = start;
  let iter = 0;
  let hitCached = null;

  while (!isOne(current) && iter < MAX_ITERATIONS) {
    const k = valueKey(current);
    if (k !== startKey) {
      const seen = cache.get(k);
      if (seen) { hitCached = seen; break; }
    }
    prefix.push(current);
    // Number-only precision guard (BigInt can't overflow).
    if (!isBig(current) && !Number.isSafeInteger(current)) {
      console.warn(`Number precision lost at step ${iter} for start ${n}`);
      // Cache the prefix-only sequence and bail.
      cache.set(startKey, prefix);
      return prefix.slice();
    }
    current = nextCollatz(current);
    iter++;
  }

  let seq;
  if (hitCached) {
    seq = prefix.concat(hitCached);
  } else if (isOne(current)) {
    seq = prefix.concat([current]);
  } else {
    // Hit MAX_ITERATIONS — cache what we have so far.
    console.warn(`Collatz sequence exceeded ${MAX_ITERATIONS} steps for ${n}`);
    seq = prefix.slice();
  }

  // Cache every sub-sequence so future calls can splice from any prefix step.
  for (let i = 0; i < prefix.length; i++) {
    const k = valueKey(prefix[i]);
    if (!cache.has(k)) cache.set(k, seq.slice(i));
  }
  // Ensure the start key is cached even if prefix was empty (n already === 1).
  if (!cache.has(startKey)) cache.set(startKey, seq);

  return seq.slice();
}

/**
 * Stopping time: number of steps from n to reach 1.
 */
export function stoppingTime(n) {
  return collatzValues(n).length - 1;
}

/**
 * Peak value (as Number for comparison). BigInt converted to Number
 * with log scaling for huge values.
 */
export function peakValue(n) {
  const values = collatzValues(n);
  let maxV = values[0];
  let maxNum = isBig(maxV) ? Number(maxV) : maxV;
  for (const v of values) {
    const num = isBig(v) ? Number(v) : v;
    if (num > maxNum) {
      maxNum = num;
      maxV = v;
    }
  }
  return maxV;
}

/**
 * Determine if a value is a "climber" (odd → will do 3n+1)
 * or a "faller" (even → will do n/2). Value 1 is neither.
 */
export function isClimber(value) {
  return !isOne(value) && !isEven(value);
}

// ── Backwards-compatible full-detail sequence (used by animate.js) ────

export function collatzSequence(n) {
  const values = collatzValues(n);
  const seq = [];
  for (let i = 0; i < values.length; i++) {
    const prev = i > 0 ? values[i - 1] : null;
    const op = i === 0 ? 'start' : (isEven(prev) ? 'even' : 'odd');
    seq.push({ value: values[i], op });
  }
  return seq;
}

/**
 * Successor chain as [parent, child] pairs (parent → its Collatz successor).
 */
export function collatzEdges(n) {
  const values = collatzValues(n);
  const edges = [];
  for (let i = 0; i < values.length - 1; i++) {
    edges.push({ from: values[i], to: values[i + 1] });
  }
  return edges;
}
