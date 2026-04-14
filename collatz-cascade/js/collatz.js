/**
 * Pure math module for the Collatz conjecture.
 * No rendering, no DOM — just sequences, trees, and statistics.
 */

const cache = new Map();  // value → sequence from that value to 1

// Safety caps: prevent infinite loops from integer overflow.
// JavaScript Numbers are exact only up to 2^53. Once 3n+1 exceeds
// that, parity checks break and the loop runs forever.
export const SAFE_MAX = Math.floor(Number.MAX_SAFE_INTEGER / 3) - 1;  // ~3e15
const MAX_ITERATIONS = 20000;  // hard cap on any sequence length

/**
 * Compute the Collatz sequence starting at n, ending at 1.
 * Returns array of { value, op } where op is 'start' | 'even' | 'odd'.
 * Memoized: shared tails are spliced from cache.
 */
export function collatzSequence(n) {
  if (cache.has(n)) return cache.get(n);

  const prefix = [];
  let current = n;
  let iter = 0;

  while (current !== 1 && !cache.has(current) && iter < MAX_ITERATIONS) {
    prefix.push(current);
    if (!Number.isSafeInteger(current)) break;  // overflow detected
    if (current % 2 === 0) {
      current = current / 2;
    } else {
      current = 3 * current + 1;
    }
    iter++;
  }

  // Build the full sequence
  const tail = current === 1
    ? [{ value: 1, op: 'start' }]
    : (cache.get(current) || [{ value: current, op: 'start' }]);

  const seq = [];
  for (let i = 0; i < prefix.length; i++) {
    const v = prefix[i];
    seq.push({ value: v, op: i === 0 ? 'start' : (prefix[i - 1] % 2 === 0 ? 'even' : 'odd') });
  }

  for (const entry of tail) {
    seq.push(entry);
  }

  for (let i = 0; i < prefix.length; i++) {
    cache.set(prefix[i], seq.slice(i));
  }
  if (!cache.has(1)) {
    cache.set(1, [{ value: 1, op: 'start' }]);
  }

  return seq;
}

/**
 * Get just the values in the Collatz sequence from n down to 1.
 * Protected against overflow and runaway loops.
 */
export function collatzValues(n) {
  const values = [];
  let current = n;
  let iter = 0;
  while (current !== 1 && iter < MAX_ITERATIONS) {
    values.push(current);
    // Detect integer precision overflow; stop before arithmetic goes wrong
    if (!Number.isSafeInteger(current) || current < 1) {
      console.warn(`Collatz overflow at step ${iter} for starting value ${n}; truncating sequence.`);
      return values;
    }
    current = current % 2 === 0 ? current / 2 : 3 * current + 1;
    iter++;
  }
  if (current === 1) values.push(1);
  if (iter >= MAX_ITERATIONS) {
    console.warn(`Collatz sequence exceeded ${MAX_ITERATIONS} steps for ${n}; truncating.`);
  }
  return values;
}

/**
 * Compute the successor chain as [parent, child] pairs.
 */
export function collatzEdges(n) {
  const values = collatzValues(n);
  const edges = [];
  for (let i = 0; i < values.length - 1; i++) {
    edges.push({ from: values[i], to: values[i + 1] });
  }
  return edges;
}

/**
 * Stopping time: number of steps from n to reach 1.
 */
export function stoppingTime(n) {
  return collatzValues(n).length - 1;
}

/**
 * Peak value encountered in the sequence starting at n.
 */
export function peakValue(n) {
  const values = collatzValues(n);
  let max = 0;
  for (const v of values) if (v > max) max = v;
  return max;
}

/**
 * Determine if a value is a "climber" (odd → will do 3n+1)
 * or a "faller" (even → will do n/2). Value 1 is neither.
 */
export function isClimber(value) {
  return value > 1 && value % 2 !== 0;
}
