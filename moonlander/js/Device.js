// Device.js — v0.1.0
// Runtime signal on whether we're on a low-end / low-memory device so the
// game can reduce its memory + GPU footprint at boot time. Used by
// Particles.js to pick a pool size and (optionally) by other subsystems.
//
// The check is conservative: we flag "low-end" only when we have a strong
// signal. `navigator.deviceMemory` reports in GB and is 4 on most Chromebooks;
// we trip low-end at <= 4. `hardwareConcurrency <= 4` is another soft signal
// (older Chromebooks are 2–4 cores). The user-agent sniff catches
// Chromebooks explicitly via the CrOS token.

const dm    = Number(navigator.deviceMemory) || 8;
const cores = Number(navigator.hardwareConcurrency) || 8;
const isChromeOS = /\bCrOS\b/.test(navigator.userAgent);
const isTouch    = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// Low end: a Chromebook, a tight-memory phone, or a browser that reports
// very limited compute. deviceMemory is capped at 8 by the spec.
export const LOW_END = isChromeOS || dm <= 4 || cores <= 4 || isTouch;

/**
 * Scale a pool size by the device profile. High-end gets the full count;
 * low-end gets a fraction to keep Chromebooks from thrashing.
 */
export function scalePool(n, lowFrac = 0.35) {
  return LOW_END ? Math.max(40, Math.round(n * lowFrac)) : n;
}

if (LOW_END) {
  console.log('[Device] LOW_END profile active ' +
    `(deviceMemory=${dm}GB cores=${cores} CrOS=${isChromeOS} touch=${isTouch})`);
}
