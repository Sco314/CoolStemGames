/**
 * Quality tier detection + runtime backpressure controls.
 *
 * Tiers: mobile (low), chromebook (medium), desktop (high).
 * Runtime degradation can step down effects when sustained frame pressure is detected.
 */

function detectTier() {
  const w = window.innerWidth;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const isTouchPrimary = 'ontouchstart' in window && w < 900;
  const lowMemory = navigator.deviceMemory && navigator.deviceMemory <= 4;
  const lowCores = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;

  if (isTouchPrimary && (w < 700 || dpr <= 1.25)) return 'mobile';
  if (isTouchPrimary || lowMemory || lowCores) return 'chromebook';
  return 'desktop';
}

function detectDevicePressure() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const lowDpr = dpr <= 1.0;
  const lowMemory = navigator.deviceMemory && navigator.deviceMemory <= 4;
  const lowCores = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
  return {
    lowDpr,
    lowMemory,
    weakGpuHint: lowDpr || lowMemory || lowCores,
  };
}

const tier = detectTier();
const pressure = detectDevicePressure();

const QUALITY = {
  mobile: {
    orbSegments: 8,
    orbRings: 6,
    maxVisibleOrbs: 24,
    maxLabels: 16,
    maxEmissivePulses: 3,
    maxTrailSegments: 140,
    trailOpacity: 0.45,
    labelDensity: 0.22,
    cameraLerp: 0.15,
    maxPixelRatio: 1.0,
    disableExpensiveEffects: true,
  },
  chromebook: {
    orbSegments: 10,
    orbRings: 8,
    maxVisibleOrbs: 42,
    maxLabels: 30,
    maxEmissivePulses: 6,
    maxTrailSegments: 260,
    trailOpacity: 0.58,
    labelDensity: 0.5,
    cameraLerp: 0.12,
    maxPixelRatio: 1.25,
    disableExpensiveEffects: pressure.weakGpuHint,
  },
  desktop: {
    orbSegments: 12,
    orbRings: 8,
    maxVisibleOrbs: 72,
    maxLabels: 48,
    maxEmissivePulses: 10,
    maxTrailSegments: 600,
    trailOpacity: 0.72,
    labelDensity: 1.0,
    cameraLerp: 0.10,
    maxPixelRatio: 1.75,
    disableExpensiveEffects: pressure.lowMemory || pressure.lowDpr,
  },
};

// Runtime degradation steps (0=base tier; higher means reduced effects).
let runtimeLevel = 0;
const MAX_RUNTIME_LEVEL = 2;

function scaleCaps(base, level) {
  const factors = [1, 0.75, 0.55];
  const f = factors[Math.min(level, factors.length - 1)];
  return {
    ...base,
    maxVisibleOrbs: Math.max(8, Math.floor(base.maxVisibleOrbs * f)),
    maxLabels: Math.max(4, Math.floor(base.maxLabels * f)),
    maxEmissivePulses: Math.max(1, Math.floor(base.maxEmissivePulses * f)),
    maxTrailSegments: Math.max(64, Math.floor(base.maxTrailSegments * f)),
    disableExpensiveEffects: base.disableExpensiveEffects || level >= 1,
  };
}

export function getTier() { return tier; }
export function getQuality() { return QUALITY[tier]; }
export function isMobileTier() { return tier === 'mobile'; }
export function getRuntimeLevel() { return runtimeLevel; }
export function canDegradeRuntime() { return runtimeLevel < MAX_RUNTIME_LEVEL; }

export function getEffectiveQuality() {
  return scaleCaps(QUALITY[tier], runtimeLevel);
}

export function degradeRuntimeQuality() {
  if (runtimeLevel >= MAX_RUNTIME_LEVEL) return getEffectiveQuality();
  runtimeLevel++;
  return getEffectiveQuality();
}

export function resetRuntimeQuality() {
  runtimeLevel = 0;
  return getEffectiveQuality();
}
