/**
 * Orb-run sequence builder.
 *
 * Produces step objects used by the number-line/orb runner playback with
 * explicit loop/repeat metadata and BigInt-safe value handling.
 */

import { computeSequenceAsync } from './collatz-client.js';
import { collatzValues } from './collatz.js';
import { isBig, isEven, isOne, nextCollatz, toValue, valueKey } from './valueUtils.js';

export const STOP_POLICY_PLAY_TERMINAL_ONCE = 'terminalOnce';
export const STOP_POLICY_FIRST_REPEAT = 'firstRepeat';

/**
 * Build orb-run steps.
 *
 * @param {number|string|bigint} input
 * @param {{ stopPolicy?: 'terminalOnce'|'firstRepeat', forceAsync?: boolean }} [opts]
 * @returns {Promise<Array<{
 *   value: number|bigint,
 *   nextValue: number|bigint|null,
 *   stepIndex: number,
 *   isEven: boolean,
 *   isRepeat: boolean,
 *   isLoopEntry: boolean,
 *   isTerminal: boolean,
 *   position: number,
 * }>>}
 */
export async function buildOrbRunSequence(input, opts = {}) {
  const {
    stopPolicy = STOP_POLICY_PLAY_TERMINAL_ONCE,
    forceAsync = false,
  } = opts;

  const start = toValue(input);
  if (start == null || start < 1) return [];

  // Use worker async path for BigInt (or when explicitly requested)
  // to avoid heavy main-thread walks for very large values.
  let valuesToOne;
  if (forceAsync || isBig(start)) {
    const { values } = await computeSequenceAsync(start);
    valuesToOne = Array.isArray(values) ? values : [];
  } else {
    valuesToOne = collatzValues(start);
  }

  if (!valuesToOne.length) return [];

  // Build a bounded playback value list based on stop policy.
  const playbackValues = [...valuesToOne];

  if (stopPolicy === STOP_POLICY_FIRST_REPEAT) {
    // Continue until the first repeated state appears as the current value.
    const visited = new Set(playbackValues.map(valueKey));
    let current = playbackValues[playbackValues.length - 1];
    let guard = 0;

    while (guard < 16) {
      current = nextCollatz(current);
      playbackValues.push(current);
      const k = valueKey(current);
      if (visited.has(k)) break;
      visited.add(k);
      guard++;
    }
  } else {
    // Default policy: after reaching 1, play exactly one 4→2→1 loop and stop.
    const last = playbackValues[playbackValues.length - 1];
    if (isOne(last)) {
      playbackValues.push(
        nextCollatz(last),
        isBig(last) ? 2n : 2,
        isBig(last) ? 1n : 1,
      );
    }
  }

  return buildSteps(playbackValues, stopPolicy);
}

function buildSteps(values, stopPolicy) {
  const steps = [];
  const visited = new Set();
  let terminalMarked = false;

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const nextValue = i < values.length - 1 ? values[i + 1] : null;
    const key = valueKey(value);

    const isRepeat = visited.has(key);
    visited.add(key);

    const isLoopEntry = isRepeat;

    let isTerminal = false;
    if (!terminalMarked) {
      if (stopPolicy === STOP_POLICY_FIRST_REPEAT) {
        isTerminal = isRepeat;
      } else {
        // End on the final 1 in the explicit 4→2→1 tail.
        isTerminal = nextValue == null;
      }

      if (isTerminal) terminalMarked = true;
    }

    steps.push({
      value,
      nextValue,
      stepIndex: i,
      isEven: isEven(value),
      isRepeat,
      isLoopEntry,
      isTerminal,
      // Position is an abstract path coordinate; layout systems can map this
      // directly or transform it into world coordinates.
      position: i,
    });

    if (terminalMarked) break;
  }

  return steps;
}
