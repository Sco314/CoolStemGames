// Device.js — v0.1.1
// Runtime signal on whether we're on a low-end / low-memory device so the
// game can reduce its memory + GPU footprint at boot time. Used by
// Particles.js to pick a pool size, ModelCache to skip large GLB/STL
// downloads, and WalkMode to drop the starfield + Earth sphere.
//
// The check is conservative: we flag "low-end" only when we have a strong
// signal. `navigator.deviceMemory` reports in GB and is 4 on most Chromebooks;
// we trip low-end at <= 4. `hardwareConcurrency <= 4` is another soft signal
// (older Chromebooks are 2–4 cores). The user-agent sniff catches
// Chromebooks explicitly via the CrOS token.
//
// **Touch is NOT a low-end signal.** Modern phones (iPhones especially)
// have plenty of memory and GPU for a few small NASA GLBs (~3.5 MB total
// across the whole catalog) and the starfield panorama. The earlier
// `|| isTouch` clause was killing every NASA model on iPhone, leaving
// the player staring at procedural-cylinder fallbacks. We still detect
// touch (exported separately) for input-routing decisions, but it no
// longer gates asset downloads or pool sizes.

const dm    = Number(navigator.deviceMemory) || 8;
const cores = Number(navigator.hardwareConcurrency) || 8;
const isChromeOS = /\bCrOS\b/.test(navigator.userAgent);
export const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// Low end: a Chromebook, a tight-memory phone, or a browser that reports
// very limited compute. deviceMemory is capped at 8 by the spec.
// Touch alone does not count — see header comment.
export const LOW_END = isChromeOS || dm <= 4 || cores <= 4;

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
