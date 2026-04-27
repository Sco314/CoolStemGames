// Device.js — v0.1.1
// Runtime signal on whether we're on a low-end / low-memory device so the
// game can reduce its memory + GPU footprint at boot time. Used by
// Particles.js to pick a pool size, and WalkMode to drop the starfield +
// Earth sphere. NASA model loads (`ModelCache`) are NOT gated by this —
// they're one-time-cost downloads in the 0.5-2.5 MB range that any
// Chromebook can handle.
//
// The check is conservative: we flag "low-end" only when we have a strong
// signal. `navigator.deviceMemory` reports in GB and is 4 on most Chromebooks;
// we trip low-end at <= 4. The user-agent sniff catches Chromebooks
// explicitly via the CrOS token.
//
// **Touch is NOT a low-end signal.** Modern phones (iPhones especially)
// have plenty of memory and GPU for our asset catalog. We still detect
// touch (exported separately) for input-routing decisions.
//
// **`hardwareConcurrency` is NOT a low-end signal.** Safari iOS clamps
// the value to 4 on a wide range of capable iPhones, which falsely tagged
// modern phones as LOW_END and skipped every NASA GLB. Cores is too
// noisy a proxy for memory/GPU capability for our purposes.

const dm    = Number(navigator.deviceMemory) || 8;
const cores = Number(navigator.hardwareConcurrency) || 8;
const isChromeOS = /\bCrOS\b/.test(navigator.userAgent);
export const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// Low end: a Chromebook or a tight-memory phone. `deviceMemory` is capped
// at 8 by the spec. Touch and `hardwareConcurrency` do NOT count — see
// header comment for why.
export const LOW_END = isChromeOS || dm <= 4;

/**
 * Scale a pool size by the device profile. High-end gets the full count;
 * low-end gets a fraction to keep Chromebooks from thrashing.
 */
export function scalePool(n, lowFrac = 0.35) {
  return LOW_END ? Math.max(40, Math.round(n * lowFrac)) : n;
}

if (LOW_END) {
  console.log('[Device] LOW_END profile active ' +
    `(deviceMemory=${dm}GB cores=${cores} CrOS=${isChromeOS} touch=${IS_TOUCH})`);
} else {
  console.log('[Device] full profile ' +
    `(deviceMemory=${dm}GB cores=${cores} CrOS=${isChromeOS} touch=${IS_TOUCH})`);
}
