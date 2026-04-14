/**
 * Value utilities: work uniformly with Number or BigInt.
 *
 * For inputs up to ~2^53 we use Number (fast). For larger inputs we
 * switch to BigInt for arbitrary precision. These helpers hide that
 * duality so rendering code can stay mode-agnostic.
 */

const TWO = 2n;
const THREE = 3n;
const ONE = 1n;
const ZERO = 0n;

/**
 * Convert any input (Number, BigInt, or string of digits) into a
 * canonical value. Returns BigInt if the value exceeds SAFE_MAX,
 * otherwise Number.
 */
export const SAFE_MAX = Number.MAX_SAFE_INTEGER - 2; // headroom for 3n+1

export function toValue(x) {
  if (typeof x === 'bigint') {
    if (x <= BigInt(SAFE_MAX) && x >= 0n) return Number(x);
    return x;
  }
  if (typeof x === 'string') {
    // Accept expressions like "27^27" or plain digits
    return parseValueExpression(x);
  }
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) return null;
    return x;
  }
  return null;
}

/**
 * Parse input that may contain ^ as exponentiation.
 * "27^27" → BigInt(27n ** 27n); "100" → 100.
 */
export function parseValueExpression(str) {
  const s = String(str).trim().replace(/[, _]/g, '');
  if (!s) return null;

  // Handle "a^b" exponentiation using BigInt for arbitrary precision
  const pow = s.match(/^(\d+)\s*\^\s*(\d+)$/);
  if (pow) {
    const base = BigInt(pow[1]);
    const exp = BigInt(pow[2]);
    return toValue(base ** exp);
  }

  // Scientific notation "1.5e20" — may need BigInt for large exponents
  const sci = s.match(/^(\d+(?:\.\d+)?)e(\d+)$/i);
  if (sci) {
    const mantissa = sci[1];
    const exp = parseInt(sci[2], 10);
    if (exp > 15) {
      // Use BigInt: multiply mantissa by 10^exp
      const dotIdx = mantissa.indexOf('.');
      const digits = mantissa.replace('.', '');
      const shift = dotIdx >= 0 ? digits.length - dotIdx : 0;
      const totalZeros = exp - shift;
      if (totalZeros < 0) return null;
      return toValue(BigInt(digits) * 10n ** BigInt(totalZeros));
    }
    return parseFloat(s);
  }

  // Plain digits: parse as Number if small, BigInt if huge
  if (/^\d+$/.test(s)) {
    if (s.length > 15) return toValue(BigInt(s));
    return parseInt(s, 10);
  }

  // Allow decimal like "1000.0" → truncate
  const f = parseFloat(s);
  if (Number.isFinite(f) && f >= 0) return Math.floor(f);
  return null;
}

export const isBig = (v) => typeof v === 'bigint';
export const isEven = (v) => isBig(v) ? (v % TWO === ZERO) : (v % 2 === 0);
export const isOne = (v) => isBig(v) ? v === ONE : v === 1;

/**
 * Next Collatz step: n/2 if even, 3n+1 if odd.
 */
export function nextCollatz(v) {
  if (isBig(v)) {
    return (v % TWO === ZERO) ? v / TWO : (THREE * v + ONE);
  }
  return (v % 2 === 0) ? (v / 2) : (3 * v + 1);
}

/**
 * log2 of a value. Handles Number up to Infinity and BigInt up to
 * any size (falls back to bit length for truly huge BigInts).
 */
export function log2(v) {
  if (!isBig(v)) return Math.log2(v);
  if (v === ZERO) return -Infinity;
  // Try fast Number conversion: OK up to about 10^308.
  const asNum = Number(v);
  if (Number.isFinite(asNum) && asNum > 0) return Math.log2(asNum);
  // Truly huge BigInt: count bits approximately
  return v.toString(2).length - 1;
}

export function log10(v) {
  return log2(v) / Math.log2(10);
}

/**
 * Stable string key for use in Map/Set. "27" and 27n give the same key.
 */
export function valueKey(v) {
  return isBig(v) ? v.toString() + 'n' : v.toString();
}

/**
 * Format a value for display. Scientific notation for very large values.
 */
export function formatValue(v) {
  if (isBig(v)) {
    const s = v.toString();
    if (s.length <= 6) return s;
    // Scientific notation: "4.43e+38"
    const first = s[0];
    const frac = s.slice(1, 4);
    return `${first}.${frac}e+${s.length - 1}`;
  }
  if (v > 999999) return v.toExponential(2);
  return v.toLocaleString();
}

/**
 * Compare two values for equality (Number or BigInt).
 */
export function valueEquals(a, b) {
  if (isBig(a) || isBig(b)) {
    try {
      return BigInt(a) === BigInt(b);
    } catch {
      return false;
    }
  }
  return a === b;
}
