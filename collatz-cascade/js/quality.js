/**
 * Quality tier detection + settings.
 *
 * Three tiers: mobile (low), chromebook (medium), desktop (high).
 * Adjusts visual complexity based on device capability.
 */

function detectTier() {
  const w = window.innerWidth;
  const isTouchPrimary = 'ontouchstart' in window && w < 900;
  const lowMemory = navigator.deviceMemory && navigator.deviceMemory <= 4;
  const lowCores = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;

  if (isTouchPrimary && w < 640) return 'mobile';
  if (isTouchPrimary || lowMemory || lowCores) return 'chromebook';
  return 'desktop';
}

const tier = detectTier();

const QUALITY = {
  mobile: {
    orbSegments: 8,
    orbRings: 6,
    maxVisibleOrbs: 30,
    trailOpacity: 0.5,
    labelDensity: 0.3,
    cameraLerp: 0.15,
  },
  chromebook: {
    orbSegments: 10,
    orbRings: 8,
    maxVisibleOrbs: 50,
    trailOpacity: 0.6,
    labelDensity: 0.6,
    cameraLerp: 0.12,
  },
  desktop: {
    orbSegments: 12,
    orbRings: 8,
    maxVisibleOrbs: 80,
    trailOpacity: 0.7,
    labelDensity: 1.0,
    cameraLerp: 0.10,
  },
};

export function getTier() { return tier; }
export function getQuality() { return QUALITY[tier]; }
export function isMobileTier() { return tier === 'mobile'; }
