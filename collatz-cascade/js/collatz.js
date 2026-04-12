/**
 * Pure math module for the Collatz conjecture.
 * No rendering, no DOM — just sequences, trees, and statistics.
 */

const cache = new Map();  // value → sequence from that value to 1

/**
 * Compute the Collatz sequence starting at n, ending at 1.
 * Returns array of { value, op } where op is 'start' | 'even' | 'odd'.
 * Memoized: shared tails are spliced from cache.
 */
export function collatzSequence(n) {
  if (cache.has(n)) return cache.get(n);

  const prefix = [];
  let current = n;

  while (current !== 1 && !cache.has(current)) {
    prefix.push(current);
    if (current % 2 === 0) {
      current = current / 2;
    } else {
      current = 3 * current + 1;
    }
  }

  // Build the full sequence
  const tail = current === 1
    ? [{ value: 1, op: 'start' }]
    : cache.get(current);

  const seq = [];
  for (let i = 0; i < prefix.length; i++) {
    const v = prefix[i];
    const next = i + 1 < prefix.length ? prefix[i + 1] : tail[0].value;
    const op = i === 0 ? 'start' : (v < next ? 'odd' : 'even');
    // Actually: if the previous step produced this value via n/2, this value came from even
    // Simpler: determine op based on how we GOT to this value's successor
    seq.push({ value: v, op: i === 0 ? 'start' : (prefix[i - 1] % 2 === 0 ? 'even' : 'odd') });
  }

  // Append tail
  for (const entry of tail) {
    seq.push(entry);
  }

  // Cache every sub-sequence starting from each prefix value
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
 */
export function collatzValues(n) {
  const values = [];
  let current = n;
  while (current !== 1) {
    values.push(current);
    current = current % 2 === 0 ? current / 2 : 3 * current + 1;
  }
  values.push(1);
  return values;
}

/**
 * Compute the successor chain as [parent, child] pairs.
 * In Collatz, each value's successor is collatz(value).
 * Returns array of { from, to } where "from" is the value
 * and "to" is its Collatz successor (i.e., the next step toward 1).
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
