/**
 * Collatz Cascade — Hybrid Path Traversal
 *
 * Design doc: Orb-run controller state machine
 * ------------------------------------------------------------
 * NOTE (Option B, per PR #40 / PR #41): the phase owner going forward
 * is orbrun-controller.js. This inline state machine is a transitional
 * form kept only while #41's controller lands; once both PRs are merged
 * numberline.js should consume orbRunController.update(dt) and act as a
 * renderer/adapter instead of hosting phase transitions inline. Do not
 * add new phase logic here — add it to orbrun-controller.js.
 *
 * States:
 * - idle: no active run.
 * - building: sequence/path prep.
 * - intro: pre-run plunger/charge animation.
 * - hop_approach: orb travels toward the next target orb.
 * - hop_impact: short settle/pause on landing.
 * - hop_grow: landed orb receives a growth pop.
 * - hop_launch: short handoff before the next hop.
 * - terminal_mark: brief terminal emphasis before finish.
 * - complete: run finished.
 * - aborted: run canceled/reset externally.
 *
 * Timing defaults:
 * - approach duration: clamp(base + distance * k, min, max)
 * - impact pause: 40–80ms
 * - growth: 120–220ms (ease-out-back)
 * - launch handoff: 40–70ms
 *
 * Runtime notes:
 * - Updates use dt-based absolute accumulators (stateElapsed).
 * - No chained setTimeout calls are used for sequencing.
 * - dt is clamped to limit mobile frame-drop spikes.
 */

import * as THREE from 'three';
import { collatzValues, stoppingTime } from './collatz.js';
import {
  isBig, isEven, log2 as bigLog2,
  formatValue as fmtValue,
} from './valueUtils.js';
import { computeSequenceAsync } from './collatz-client.js';
import {
  buildOrbRunRegistry,
  makeRunHue,
  resolveOrbRunStyle,
} from './orbrun-color.js';
import { createOrbRunRegistry } from './orbrun-registry.js';
import { createOrbRunCameraRig } from './orbRunCamera.js';
import { mapNumberToPosition, DEFAULT_GOLDEN_ANGLE } from './orbrun-mapping.js';
import { buildOrbRunSequence, STOP_POLICY_PLAY_TERMINAL_ONCE } from './orbrun-sequence.js';
import { scheduleBatch } from './scheduler.js';
import { getEffectiveQuality } from './quality.js';

// ── Path layout constants ───────────────────────────────
// World layout is now 3D anomalous-cone:
//   y = log2(n+1) * heightScaleLarge   (height = magnitude)
//   r = stoppingTime(n) * radiusScale  (radius = persistence)
//   θ = (n * goldenAngle) mod 2π        (angle = deterministic)
// Positions are per-NUMBER, not per-step: the same value always maps
// to the same world coordinate (loops return to the same orb).
const WORLD_OPTS = {
  heightPolicy: 'production',
  heightScaleLarge: 1.25,
  radiusScale: 0.6,
};
const ORB_RADIUS = 0.10;
const ORB_RADIUS_ACTIVE = 0.14;
const OPERATOR_RADIUS = 0.18;
const ORB_SPIN_SPEED = 0.8;      // radians per second (Y-axis rotation)
const LABEL_SCALE = 0.40;
// EXTRA_CYCLES is now handled by the sequence builder's STOP_POLICY_PLAY_TERMINAL_ONCE,
// which appends 4→2→1 once after reaching 1.

// Pacing: base time per step (seconds) by sequence length
const PACING = [
  { maxSteps: 15,       timePerStep: 0.8 },   // short: dramatic
  { maxSteps: 60,       timePerStep: 0.4 },   // medium: balanced
  { maxSteps: 160,      timePerStep: 0.2 },   // long: faster
  { maxSteps: Infinity, timePerStep: 0.1 },   // very long: sprint
];
const MILESTONE_WEIGHT = 2.0;  // milestones take 2× normal time
const TERMINAL_WEIGHT = 3.0;   // final 4→2→1 takes 3× normal

// Camera offsets
const TACTICAL_OFFSET = new THREE.Vector3(0, 2.5, 4.0);

// Orb tier distances (in steps from ball)
let ACTIVE_RANGE = 5;    // full size + label + glow
let VISIBLE_RANGE = 25;  // visible but small, no label

// Colors
// ORB_COLOR_FUTURE is the fallback hue used when no per-run hue is set.
// Per-orb appearance is otherwise driven entirely by resolveOrbRunStyle()
// via getOrbStyle() — see the "Orb semantic/style contract" section.
const ORB_COLOR_FUTURE = new THREE.Color(0.3, 0.35, 0.5);
const TRAIL_COLOR_BRIGHT = 0x4a9aff;
const TRAIL_COLOR_FAINT = 0x223355;

// Density band threshold
const DENSITY_THRESHOLD = 2000;
const DENSITY_BINS = 512;

// Shooter position
const SHOOTER_X = -0.6;
const SHOOTER_Y = 0;

// ── State ────────────────────────────────────────────────
let nlGroup = null;
let operatorBall = null;
let operatorLight = null;
let shooterMesh = null;
let active = false;

// Sequence + path
let sequence = [];          // raw values[] — mirror of sequenceSteps.map(s => s.value)
let sequenceSteps = [];     // orbrun-sequence step[] with metadata (isRepeat, isLoopEntry, isTerminal, …)
let pathPositions = [];     // THREE.Vector3[] per step
let pathSpline = null;      // CatmullRomCurve3
let importance = [];        // per-step weight (1.0 normal, 2.0+ milestone)
let baseTimePerStep = 0.4;  // from pacing table
let totalSteps = 0;

// Playback
let currentStepFloat = 0;   // fractional step progress
let playState = 'idle';
let userSpeed = 1;
let hitCount = 0;
let mathDisplay = null;
let lastReportedStep = -1;   // for triggering per-step events
let isPaused = false;
let skipUsed = false;
let peakValue = 1;
let peakLog2 = 0;
let currentImpactStreak = 0;
let maxImpactStreak = 0;

// Trail meshes
let previewLine = null;      // full path, faint
let trailLine = null;        // traversed portion, bright
let renderPathPositions = []; // decimated points used for line rendering
let trailPointCount = 0;

// Step orbs
let stepOrbs = [];           // { stepIdx, value, pos, mesh, label, activated }
let orbRunRegistry = null;
let orbStateRegistry = null;
let orbRunHue = null;
let terminalLoopMarked = false;
let terminalFlashTimer = 0;
let terminalFlashDone = false;
let futureInstanced = null;
let visitedInstanced = null;
let orbGeo = null;
let orbMatFuture = null;
let orbMatVisited = null;
let qualityProfile = null;
let perfMode = 'auto';
let frameDtEma = 0.016;

// Camera blending
const orbRunCameraRig = createOrbRunCameraRig();
let cameraMode = 'overview'; // overview | chase | tactical
let tacticalWeight = 0;      // 0..1, ramps up on milestones
let tacticalDecay = 0;

// Launch animation
let launchPhase = 0;          // 0..1, plunger compression progress
const LAUNCH_DURATION = 0.6;  // seconds for plunger wind-up
let plungerRestX = 0;         // original rod/knob X (set in init)
let stateElapsed = 0;
let hopFromStep = -1;
let hopToStep = 0;
let hopApproachDuration = 0.2;
let hopImpactDuration = 0.06;
let hopGrowthDuration = 0.16;
let hopLaunchDuration = 0.055;
let growthStepIdx = -1;
let growthBaseScale = 1.0;

const DT_CLAMP_MAX = 0.05;
const APPROACH_BASE = 0.06;
const APPROACH_K = 0.12;
const APPROACH_MIN = 0.08;
const APPROACH_MAX = 0.34;
const IMPACT_MIN = 0.04;
const IMPACT_MAX = 0.08;
const GROWTH_MIN = 0.12;
const GROWTH_MAX = 0.22;
const LAUNCH_HANDOFF_MIN = 0.04;
const LAUNCH_HANDOFF_MAX = 0.07;
const TERMINAL_MARK_DURATION = 0.12;

// Milestone callout state (exported for UI to read)
let milestoneCallout = null;  // { text, timer } or null
let milestoneTimer = 0;
const CALLOUT_DURATION = 1.2;

// Density band
let densityMode = false;
let densityTexture = null;
let densityMesh = null;

// ── Exports ─────────────────────────────────────────────
export function isNumberLineActive() { return active; }
export function isOrbRunActive() { return active; }
export function getMathDisplay() { return mathDisplay; }
export function getPlayState() { return playState; }
export function setSpeed(mult) { userSpeed = mult; }
export function getSpeed() { return userSpeed; }
export function setPaused(paused) { isPaused = !!paused; }
export function isPausedPlayback() { return isPaused; }
export function isDensityMode() { return densityMode; }
export function getHitCount() { return hitCount; }
export function getMilestoneCallout() { return milestoneCallout; }
export function formatValue(n) { return fmtValue(n); }
export function updateOrbRun(dt) { return updateNumberLine(dt); }
export function setOrbRunPerformanceMode(mode) {
  perfMode = mode === 'eco' ? 'eco' : 'auto';
}
export function getRunStats() {
  if (!sequence.length) return null;
  const currentIdx = Math.max(0, Math.min(totalSteps - 1, Math.floor(Math.max(0, currentStepFloat))));
  const value = sequence[currentIdx] ?? 1;

  let remainingSeconds = 0;
  const isIntroPhase = playState === 'intro' || playState === 'building';
  const isHopPhase =
    playState === 'hop_approach' ||
    playState === 'hop_impact' ||
    playState === 'hop_grow' ||
    playState === 'hop_launch' ||
    playState === 'terminal_mark';
  if (isIntroPhase) {
    const launchRemaining = Math.max(0, (1 - Math.min(launchPhase, 1)) * LAUNCH_DURATION);
    const weighted = importance.reduce((sum, w) => sum + w, 0);
    const travelRemaining = (baseTimePerStep * weighted) / Math.max(userSpeed, 0.001);
    remainingSeconds = launchRemaining + travelRemaining;
  } else if (isHopPhase) {
    const idx = Math.floor(Math.max(0, currentStepFloat));
    const frac = Math.max(0, Math.min(1, currentStepFloat - idx));
    let weightedRemaining = 0;
    for (let i = idx; i < importance.length; i++) {
      if (i === idx) weightedRemaining += Math.max(0, (1 - frac) * (importance[i] || 1));
      else weightedRemaining += importance[i] || 1;
    }
    remainingSeconds = (baseTimePerStep * weightedRemaining) / Math.max(userSpeed, 0.001);
  }

  const badges = [];
  if (maxImpactStreak >= 3) badges.push(`Impact streak ×${maxImpactStreak}`);
  if (playState === 'complete' && !skipUsed) badges.push('Clean run');

  return {
    currentValue: value,
    stepIndex: currentIdx,
    totalSteps: Math.max(0, totalSteps - 1),
    peakValue,
    estimatedRemainingSec: Math.max(0, remainingSeconds),
    badges,
    isPaused,
    isComplete: playState === 'complete',
  };
}
// Legacy exports (no-ops, kept for import compatibility)
export const MAX_ORBS = 5000;
let orbVisibleMax = getEffectiveQuality().maxVisibleOrbs;
export function setOrbVisibleMax(n) {
  orbVisibleMax = Math.max(8, Math.min(MAX_ORBS, n | 0));
}
export function getOrbVisibleMax() { return orbVisibleMax; }

// ── Init ────────────────────────────────────────────────
export function initNumberLine(scene) {
  qualityProfile = getEffectiveQuality();
  ACTIVE_RANGE = 4;
  VISIBLE_RANGE = Math.max(10, Math.floor((qualityProfile?.maxVisibleOrbs || 50) * 0.5));

  nlGroup = new THREE.Group();
  nlGroup.visible = false;
  scene.add(nlGroup);

  // Start orb — textured sphere with slow spin
  const geo = new THREE.SphereGeometry(OPERATOR_RADIUS, 32, 24);
  const orbTexture = new THREE.TextureLoader().load('assets/images/startorbgraphic.png');
  orbTexture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({
    map: orbTexture,
    color: new THREE.Color(0xC8BFE7),
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
    metalness: 0.1,
    roughness: 0.6,
  });
  operatorBall = new THREE.Mesh(geo, mat);
  operatorBall.visible = false;
  nlGroup.add(operatorBall);
  operatorLight = new THREE.PointLight(0xffeedd, 1.0, 8, 2);
  operatorBall.add(operatorLight);

  // Pinball shooter
  const sGeo = new THREE.BoxGeometry(0.6, 0.35, 0.35);
  const sMat = new THREE.MeshStandardMaterial({
    color: 0x6688aa, emissive: 0x445566,
    emissiveIntensity: 0.4, metalness: 0.4, roughness: 0.35,
  });
  shooterMesh = new THREE.Mesh(sGeo, sMat);
  shooterMesh.position.set(SHOOTER_X, SHOOTER_Y, 0);
  nlGroup.add(shooterMesh);

  const rodGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8);
  const rodMat = new THREE.MeshStandardMaterial({ color: 0x889abb, metalness: 0.8, roughness: 0.2 });
  const rod = new THREE.Mesh(rodGeo, rodMat);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(-0.35, 0, 0);
  shooterMesh.add(rod);

  const knobGeo = new THREE.SphereGeometry(0.09, 12, 8);
  const knobMat = new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xff2222, emissiveIntensity: 0.4 });
  const knob = new THREE.Mesh(knobGeo, knobMat);
  knob.position.set(-0.6, 0, 0);
  shooterMesh.add(knob);

  const q = getEffectiveQuality();
  orbGeo = new THREE.SphereGeometry(ORB_RADIUS, q.orbSegments, q.orbRings);
  // Instanced LOD uses per-instance color (setColorAt) as the single semantic
  // channel — keep the base material white-on-white so instanceColor fully
  // drives the rendered hue/intensity. See getOrbInstanceColor().
  orbMatFuture = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.15,
    metalness: 0.2, roughness: 0.6, transparent: true, opacity: 0.35,
  });
  orbMatVisited = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25,
    metalness: 0.2, roughness: 0.6, transparent: true, opacity: 0.6,
  });
}

export function showNumberLine() {
  if (nlGroup) nlGroup.visible = true;
  active = true;
}

export function hideNumberLine() {
  if (nlGroup) nlGroup.visible = false;
  active = false;
  playState = 'idle';
  operatorBall.visible = false;
  resetShooterChargeVisuals();
  milestoneCallout = null;
  milestoneTimer = 0;
  mathDisplay = null;
}

export function clearNumberLine() {
  disposePath();
  sequence = [];
  sequenceSteps = [];
  pathPositions = [];
  pathSpline = null;
  importance = [];
  stepOrbs = [];
  orbRunRegistry = null;
  orbStateRegistry = null;
  orbRunHue = null;
  terminalLoopMarked = false;
  terminalFlashTimer = 0;
  terminalFlashDone = false;
  renderPathPositions = [];
  trailPointCount = 0;
  currentStepFloat = 0;
  playState = 'idle';
  stateElapsed = 0;
  hopFromStep = -1;
  hopToStep = 0;
  growthStepIdx = -1;
  launchPhase = 0;
  tacticalDecay = 0;
  tacticalWeight = 0;
  milestoneCallout = null;
  milestoneTimer = 0;
  hitCount = 0;
  mathDisplay = null;
  lastReportedStep = -1;
  isPaused = false;
  skipUsed = false;
  peakValue = 1;
  peakLog2 = 0;
  currentImpactStreak = 0;
  maxImpactStreak = 0;
  if (operatorBall) operatorBall.visible = false;
  resetShooterChargeVisuals();
  cleanupDensityBand();
}

// ── Path computation ────────────────────────────────────
// worldPositionFor: deterministic 3D position for any integer value.
// Every integer maps to a stable world coordinate — so the same value
// always lives at the same spot, and loops return to the same orb.
function worldPositionFor(value) {
  // Zero sink (custom rule variants only): single orb at world origin
  if (value === 0 || value === 0n) return new THREE.Vector3(0, 0, 0);

  // Fast path for Number and small BigInts that fit in a Number
  const nNum = typeof value === 'bigint' ? (value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null) : value;
  if (nNum != null && Number.isFinite(nNum) && nNum >= 1) {
    return mapNumberToPosition(nNum, WORLD_OPTS);
  }

  // BigInt beyond SAFE_MAX: derive position without precision loss
  const lg = bigLog2(value);
  const y = lg * WORLD_OPTS.heightScaleLarge;
  const tHash = Number(value % 2147483647n);
  const theta = (tHash * DEFAULT_GOLDEN_ANGLE) % (Math.PI * 2);
  const r = stoppingTime(value) * WORLD_OPTS.radiusScale;
  return new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta));
}

function computeImportance(seq) {
  const imp = new Array(seq.length).fill(1.0);
  let peakSoFar = 0;

  for (let i = 0; i < seq.length; i++) {
    const v = typeof seq[i] === 'bigint' ? Number(seq[i]) : seq[i];
    const lg = bigLog2(seq[i]);

    // New peak
    if (lg > peakSoFar) {
      peakSoFar = lg;
      imp[i] = MILESTONE_WEIGHT;
    }

    // Big drop (value falls >50% in one step)
    if (i > 0) {
      const prevLg = bigLog2(seq[i - 1]);
      if (prevLg - lg > 1) imp[i] = Math.max(imp[i], MILESTONE_WEIGHT);
    }

    // Terminal 4→2→1
    if (i >= 2 && seq[i] === 1 &&
        (seq[i - 1] === 2 || seq[i - 1] === 2n) &&
        (seq[i - 2] === 4 || seq[i - 2] === 4n)) {
      imp[i] = TERMINAL_WEIGHT;
      imp[i - 1] = TERMINAL_WEIGHT;
      imp[i - 2] = TERMINAL_WEIGHT;
    }

    // Round step markers
    if (i === 10 || i === 25 || i === 50 || i === 100) {
      imp[i] = Math.max(imp[i], MILESTONE_WEIGHT);
    }
  }
  return imp;
}

function getBaseTimePerStep(seqLen) {
  for (const p of PACING) {
    if (seqLen <= p.maxSteps) return p.timePerStep;
  }
  return 0.1;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function midpoint(min, max) {
  return (min + max) * 0.5;
}

function smoothstep01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function easeOutBack01(t) {
  const x = clamp(t, 0, 1);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * ((x - 1) ** 3) + c1 * ((x - 1) ** 2);
}

function beginState(nextState) {
  playState = nextState;
  stateElapsed = 0;
}

function resetShooterChargeVisuals() {
  if (shooterMesh && shooterMesh.children.length >= 2) {
    shooterMesh.children[0].position.x = -0.35;
    shooterMesh.children[1].position.x = -0.6;
  }
  if (shooterMesh) shooterMesh.material.emissiveIntensity = 0.4;
  if (operatorBall?.material?.emissive) {
    operatorBall.material.emissive.setHex(0x000000);
    operatorBall.material.emissiveIntensity = 0;
  }
}

function getStepPosition(stepIdx) {
  if (stepIdx < 0) return new THREE.Vector3(SHOOTER_X, SHOOTER_Y, 0);
  if (stepIdx >= pathPositions.length) return pathPositions[pathPositions.length - 1]?.clone() ?? new THREE.Vector3();
  return pathPositions[stepIdx].clone();
}

function configureHop(nextStep) {
  hopFromStep = nextStep - 1;
  hopToStep = nextStep;
  const start = getStepPosition(hopFromStep);
  const end = getStepPosition(hopToStep);
  const dist = start.distanceTo(end);
  const rawApproach = APPROACH_BASE + dist * APPROACH_K;
  const imp = importance[hopToStep] ?? 1;
  const pacingScale = clamp(baseTimePerStep / 0.4, 0.35, 1.75);
  hopApproachDuration = clamp(rawApproach * imp * pacingScale, APPROACH_MIN, APPROACH_MAX * imp * pacingScale);
  hopImpactDuration = midpoint(IMPACT_MIN, IMPACT_MAX);
  const growthBias = importance[hopToStep] >= MILESTONE_WEIGHT ? 1 : 0;
  hopGrowthDuration = GROWTH_MIN + (GROWTH_MAX - GROWTH_MIN) * growthBias;
  hopLaunchDuration = midpoint(LAUNCH_HANDOFF_MIN, LAUNCH_HANDOFF_MAX);
}

async function buildPath(seq) {
  disposePath();

  totalSteps = seq.length;
  // 3D cone layout: positions are per-value (deterministic), not per-step.
  pathPositions = seq.map(v => worldPositionFor(v));
  importance = computeImportance(seq);
  baseTimePerStep = getBaseTimePerStep(totalSteps);
  const q = getEffectiveQuality();
  setOrbVisibleMax(Math.min(orbVisibleMax, q.maxVisibleOrbs));

  // Build spline through all positions
  if (pathPositions.length >= 2) {
    pathSpline = new THREE.CatmullRomCurve3(pathPositions, false, 'catmullrom', 0.3);
  }

  const maxTrailSegments = Math.max(8, q.maxTrailSegments);
  const stride = Math.max(1, Math.ceil(pathPositions.length / maxTrailSegments));
  renderPathPositions = [];
  for (let i = 0; i < pathPositions.length; i += stride) renderPathPositions.push(pathPositions[i]);
  if (pathPositions.length > 1 && renderPathPositions[renderPathPositions.length - 1] !== pathPositions[pathPositions.length - 1]) {
    renderPathPositions.push(pathPositions[pathPositions.length - 1]);
  }
  trailPointCount = renderPathPositions.length;

  // Preview line (full path, faint)
  if (renderPathPositions.length >= 2) {
    const previewGeo = new THREE.BufferGeometry().setFromPoints(renderPathPositions);
    const previewMat = new THREE.LineBasicMaterial({
      color: TRAIL_COLOR_FAINT, transparent: true, opacity: q.trailOpacity * 0.4,
    });
    previewLine = new THREE.Line(previewGeo, previewMat);
    nlGroup.add(previewLine);

    // Trail line (bright, grows via drawRange)
    const trailGeo = new THREE.BufferGeometry().setFromPoints(renderPathPositions);
    const trailMat = new THREE.LineBasicMaterial({
      color: TRAIL_COLOR_BRIGHT, transparent: true, opacity: q.trailOpacity,
    });
    trailLine = new THREE.Line(trailGeo, trailMat);
    trailLine.geometry.setDrawRange(0, 1);
    nlGroup.add(trailLine);
  }

  stepOrbs = new Array(pathPositions.length);
  const futureCap = Math.min(pathPositions.length, MAX_ORBS);
  futureInstanced = new THREE.InstancedMesh(orbGeo, orbMatFuture, futureCap);
  visitedInstanced = new THREE.InstancedMesh(orbGeo, orbMatVisited, futureCap);
  // Allocate the instanceColor attribute up-front so per-instance coloring
  // (driven by getOrbInstanceColor) is available from frame 0.
  futureInstanced.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(futureCap * 3), 3);
  visitedInstanced.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(futureCap * 3), 3);
  futureInstanced.count = 0;
  visitedInstanced.count = 0;
  nlGroup.add(futureInstanced);
  nlGroup.add(visitedInstanced);

  const scratch = new THREE.Object3D();
  const buildCount = Math.min(pathPositions.length, MAX_ORBS);
  await scheduleBatch(Array.from({ length: buildCount }, (_, i) => i), (i) => {
    const pos = pathPositions[i];
    stepOrbs[i] = { stepIdx: i, value: seq[i], pos, mesh: null, label: null, activated: false };
    scratch.position.copy(pos);
    scratch.scale.setScalar(0.4);
    scratch.updateMatrix();
    futureInstanced.setMatrixAt(i, scratch.matrix);
    futureInstanced.count = i + 1;
  }, { priority: 3 });
  futureInstanced.instanceMatrix.needsUpdate = true;
}

function makeLabel(value) {
  const text = fmtValue(value);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = '#e0e6f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontSize = Math.max(18, Math.min(48, 48 - text.length * 3));
  ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
  ctx.fillText(text, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(LABEL_SCALE, LABEL_SCALE, 1);
  sprite.renderOrder = 1;
  return sprite;
}

function disposePath() {
  if (previewLine) {
    nlGroup.remove(previewLine);
    previewLine.geometry.dispose();
    previewLine.material.dispose();
    previewLine = null;
  }
  if (trailLine) {
    nlGroup.remove(trailLine);
    trailLine.geometry.dispose();
    trailLine.material.dispose();
    trailLine = null;
  }
  if (futureInstanced) {
    nlGroup.remove(futureInstanced);
    futureInstanced.dispose();
    futureInstanced = null;
  }
  if (visitedInstanced) {
    nlGroup.remove(visitedInstanced);
    visitedInstanced.dispose();
    visitedInstanced = null;
  }
  for (const orb of stepOrbs) {
    if (!orb || !orb.mesh) continue;
    nlGroup.remove(orb.mesh);
    if (orb.label) {
      orb.mesh.remove(orb.label);
      orb.label.material.map?.dispose();
      orb.label.material.dispose();
    }
    orb.mesh.geometry.dispose();
    orb.mesh.material.dispose();
  }
  stepOrbs = [];
}

// ── Sequence launch ─────────────────────────────────────
export function startSequence(n) {
  // buildOrbRunSequence handles BigInt via worker internally and appends
  // the 4→2→1 tail under STOP_POLICY_PLAY_TERMINAL_ONCE.
  buildOrbRunSequence(n, { stopPolicy: STOP_POLICY_PLAY_TERMINAL_ONCE })
    .then(steps => { if (steps.length) launchSequence(n, steps); });
}

async function launchSequence(n, steps) {
  cleanupDensityBand();
  densityMode = false;

  sequenceSteps = steps;
  sequence = steps.map(s => s.value);

  userSpeed = 1;

  // Density mode for extremely long sequences
  if (steps.length > DENSITY_THRESHOLD) {
    densityMode = true;
    buildDensityBand(sequence);
    userSpeed = Math.max(1, sequence.length / 100);
  }

  playState = 'building';
  await buildPath(sequence);
  orbRunRegistry = buildOrbRunRegistry(sequenceSteps);
  orbStateRegistry = createOrbRunRegistry({
    maxActiveMeshes: Math.max(80, (qualityProfile?.maxVisibleOrbs || 50) * 2),
    maxPersistentRevealed: 320,
    maxPersistentRevealedLowEnd: 140,
  });
  for (let i = 0; i < sequence.length; i++) {
    const v = sequence[i];
    orbStateRegistry.upsertOrb(v, { position: pathPositions[i], isInCurrentRun: true, isRevealed: true });
    if (i > 0) orbStateRegistry.addNeighbor(sequence[i - 1], v);
  }
  orbStateRegistry.setCurrentRun(sequence);
  orbRunHue = makeRunHue(n);
  terminalLoopMarked = false;
  terminalFlashTimer = 0;
  terminalFlashDone = false;

  orbRunCameraRig.reset({
    pathPositions,
    sequence,
    shooterPos: new THREE.Vector3(SHOOTER_X, SHOOTER_Y, 0),
  });

  // Reset playback
  currentStepFloat = -1;  // start before step 0 (at shooter)
  hitCount = 0;
  mathDisplay = null;
  lastReportedStep = -1;
  isPaused = false;
  skipUsed = false;
  peakValue = sequence[0] ?? 1;
  peakLog2 = bigLog2(peakValue);
  currentImpactStreak = 0;
  maxImpactStreak = 0;
  cameraMode = 'overview';
  tacticalWeight = 0;

  // Ball starts at the shooter — launch phase begins with plunger compression
  operatorBall.position.set(SHOOTER_X, SHOOTER_Y, 0);
  operatorBall.visible = true;
  launchPhase = 0;
  beginState('intro');
}

export function skipToEnd() {
  if (playState === 'idle' || playState === 'complete') return;
  currentStepFloat = totalSteps - 1;
  if (pathPositions.length > 0) {
    operatorBall.position.copy(pathPositions[totalSteps - 1]);
  }
  hitCount = totalSteps;
  beginState('complete');
  markTerminalLoopOnce();
  skipUsed = true;
  mathDisplay = { value: 1, isEven: false, label: 'DONE', rule: '', operation: '', result: '' };
  if (trailLine) trailLine.geometry.setDrawRange(0, trailPointCount);
  updateOrbTiers(totalSteps - 1);
}

// ── Update (called each frame) ──────────────────────────
export function updateNumberLine(dt) {
  updateRuntimePressure(dt);
  const clampedDt = clamp(dt, 0, DT_CLAMP_MAX);

  // Spin the start orb whenever it's visible
  if (operatorBall && operatorBall.visible) {
    operatorBall.rotation.y += ORB_SPIN_SPEED * clampedDt;
  }

  if (!active || playState === 'idle' || playState === 'aborted' || playState === 'building') return null;
  if (playState === 'complete') {
    if (terminalFlashTimer > 0) {
      terminalFlashTimer = Math.max(0, terminalFlashTimer - dt);
      updateOrbTiers(Math.max(0, totalSteps - 1), dt);
      return getCameraTarget();
    }
    return null;
  }

  if (isPaused) {
    return getCameraTarget();
  }

  const speedScaledState =
    playState === 'hop_approach' ||
    playState === 'hop_impact' ||
    playState === 'hop_grow' ||
    playState === 'hop_launch' ||
    playState === 'terminal_mark';
  const phaseDt = speedScaledState ? clampedDt * userSpeed : clampedDt;
  stateElapsed += phaseDt;

  // Milestone callout timer
  if (milestoneCallout) {
    milestoneTimer -= clampedDt;
    if (milestoneTimer <= 0) milestoneCallout = null;
  }

  // ── INTRO: plunger compresses before firing ─────────────
  if (playState === 'intro') {
    launchPhase = clamp(stateElapsed / LAUNCH_DURATION, 0, 1);

    // Plunger compression: rod + knob pull back
    if (shooterMesh && shooterMesh.children.length >= 2) {
      const rod = shooterMesh.children[0];
      const knob = shooterMesh.children[1];
      const pullback = Math.sin(Math.min(launchPhase, 1) * Math.PI * 0.5) * 0.25;
      rod.position.x = -0.35 - pullback;
      knob.position.x = -0.6 - pullback;
    }

    // Progressive glow on shooter body
    if (shooterMesh) {
      const glow = Math.min(launchPhase, 1) * 0.8;
      shooterMesh.material.emissiveIntensity = 0.4 + glow;
    }

    // Ball glows brighter as launch charges
    const charge = Math.min(launchPhase, 1);
    operatorBall.material.emissive.setHex(0xC8BFE7);
    operatorBall.material.emissiveIntensity = charge * 0.8;

    if (launchPhase >= 1) {
      resetShooterChargeVisuals();
      cameraMode = 'chase';
      configureHop(0);
      beginState('hop_approach');
    }
    return getCameraTarget(dt);
  }

  if (playState === 'hop_approach') {
    const t = hopApproachDuration > 0 ? clamp(stateElapsed / hopApproachDuration, 0, 1) : 1;
    const smooth = smoothstep01(t);
    currentStepFloat = hopFromStep + smooth;
    const start = getStepPosition(hopFromStep);
    const end = getStepPosition(hopToStep);
    operatorBall.position.lerpVectors(start, end, smooth);

    if (t >= 1) {
      currentStepFloat = hopToStep;
      lastReportedStep = hopToStep;
      hitCount = hopToStep + 1;

      const val = sequence[hopToStep];
      if (hopToStep < sequence.length - 1) {
        const next = sequence[hopToStep + 1];
        const even = isEven(val);
        mathDisplay = {
          value: val, isEven: even,
          label: even ? 'EVEN' : 'ODD',
          rule: even ? 'n ÷ 2' : '3n + 1',
          operation: even ? `${fmtValue(val)} ÷ 2` : `${fmtValue(val)} × 3 + 1`,
          result: fmtValue(next),
        };
      } else {
        mathDisplay = { value: val, isEven: false, label: 'DONE', rule: '', operation: '', result: '' };
      }

      if (stepOrbs[hopToStep] && !stepOrbs[hopToStep].activated) {
        activateOrb(stepOrbs[hopToStep]);
      }
      if (trailLine) {
        const ratio = totalSteps > 1 ? (hopToStep / (totalSteps - 1)) : 1;
        const n = Math.max(1, Math.floor(ratio * trailPointCount));
        trailLine.geometry.setDrawRange(0, Math.min(trailPointCount, n));
      }
      if (importance[hopToStep] >= MILESTONE_WEIGHT) {
        currentImpactStreak += 1;
        maxImpactStreak = Math.max(maxImpactStreak, currentImpactStreak);
        tacticalWeight = Math.min(1, tacticalWeight + 0.5);
        tacticalDecay = 0.5;
      } else {
        currentImpactStreak = 0;
      }
      if (importance[hopToStep] >= TERMINAL_WEIGHT && (val === 4 || val === 4n)) {
        milestoneCallout = { text: '4 → 2 → 1', type: 'terminal' };
        milestoneTimer = CALLOUT_DURATION * 1.5;
      } else if (importance[hopToStep] >= MILESTONE_WEIGHT) {
        let isPeak = true;
        const lg = bigLog2(val);
        for (let j = 0; j < hopToStep; j++) {
          if (bigLog2(sequence[j]) >= lg) { isPeak = false; break; }
        }
        if (isPeak && hopToStep > 0) {
          peakValue = val;
          peakLog2 = lg;
          milestoneCallout = { text: `NEW PEAK: ${fmtValue(val)}`, type: 'peak' };
          milestoneTimer = CALLOUT_DURATION;
        }
      }
      beginState('hop_impact');
    }
  } else if (playState === 'hop_impact') {
    if (stateElapsed >= hopImpactDuration) {
      growthStepIdx = hopToStep;
      growthBaseScale = stepOrbs[growthStepIdx]?.mesh?.scale?.x ?? 1;
      beginState('hop_grow');
    }
  } else if (playState === 'hop_grow') {
    const t = hopGrowthDuration > 0 ? clamp(stateElapsed / hopGrowthDuration, 0, 1) : 1;
    const grow = easeOutBack01(t);
    const maxScale = ORB_RADIUS_ACTIVE / ORB_RADIUS;
    const scale = growthBaseScale + (maxScale - growthBaseScale) * grow;
    if (stepOrbs[growthStepIdx]) stepOrbs[growthStepIdx].mesh.scale.setScalar(scale);
    if (t >= 1) {
      beginState('hop_launch');
    }
  } else if (playState === 'hop_launch') {
    if (stateElapsed >= hopLaunchDuration) {
      if (hopToStep >= totalSteps - 1) {
        beginState('terminal_mark');
      } else {
        configureHop(hopToStep + 1);
        beginState('hop_approach');
      }
    }
  } else if (playState === 'terminal_mark') {
    if (stateElapsed >= TERMINAL_MARK_DURATION) {
      currentStepFloat = totalSteps - 1;
      beginState('complete');
      markTerminalLoopOnce();
    }

    const termVal = sequence[hopToStep] ?? 1;
    const currLg = bigLog2(termVal);
    if (currLg > peakLog2) {
      peakValue = termVal;
      peakLog2 = currLg;
    }
  }

  // Decay tactical weight
  if (tacticalDecay > 0) {
    tacticalDecay -= clampedDt;
  } else if (tacticalWeight > 0) {
    tacticalWeight = Math.max(0, tacticalWeight - clampedDt * 2);
  }

  // Update orb tiers
  const currentStep = Math.floor(Math.max(0, currentStepFloat));
  updateOrbTiers(currentStep, dt);

  return getCameraTarget(dt);
}

// ── Orb tier management ─────────────────────────────────
function activateOrb(orb) {
  orb.activated = true;
  orbStateRegistry?.incrementActivation(orb.value);
  orb.activationMix = 0;
  // Appearance is applied uniformly each frame by updateOrbTiers via the
  // shared semantic contract (getOrbStyle). No per-representation write here.
}

function markTerminalLoopOnce() {
  if (terminalLoopMarked) return;
  terminalLoopMarked = true;
  orbStateRegistry?.markTerminalLoop(4, true);
  orbStateRegistry?.markTerminalLoop(2, true);
  orbStateRegistry?.markTerminalLoop(1, true);
  if (!terminalFlashDone) {
    terminalFlashDone = true;
    terminalFlashTimer = 0.55;
  }
}

// ── Orb semantic/style contract ─────────────────────────
// Single source of truth for per-orb appearance, renderer-agnostic.
// Both the active-range mesh path and the instanced (dormant) path consume
// the same style so an orb's run hue, repeat/terminal-loop identity, and
// terminal flash emphasis stay consistent as the orb crosses LOD tiers.
//   - resolveOrbRunStyle(...) owns hue + activation mapping.
//   - terminalFlashTimer is the one broadcast channel for 4→2→1 emphasis;
//     tier adapters decide intensity but never skip it.
function isTerminalLoopValue(v) {
  return v === 4 || v === 4n || v === 2 || v === 2n || v === 1 || v === 1n;
}

function computeTerminalFlashBoost() {
  if (terminalFlashTimer <= 0) return 0;
  return Math.sin(((0.55 - terminalFlashTimer) / 0.55) * Math.PI) * 0.7;
}

function getOrbStyle(orb, currentStep) {
  const style = resolveOrbRunStyle({
    stepIdx: orb.stepIdx,
    activated: orb.activated,
    isCurrentStep: orb.stepIdx === currentStep,
    runColor: orbRunHue || ORB_COLOR_FUTURE,
    registry: orbRunRegistry || { repeatSteps: new Set(), terminalLoopSteps: new Set() },
    terminalLoopMarked,
    activationMix: orb.activationMix || 0,
  });
  const flashBoost = isTerminalLoopValue(orb.value) ? computeTerminalFlashBoost() : 0;
  return { ...style, flashBoost };
}

// Pre-allocated scratch so the instanced path does not churn THREE.Color.
const _instanceColorScratch = new THREE.Color();

// Bake semantic color + emissive intensity + flash boost into a single RGB
// color for the instanced LOD path. Instanced MeshStandardMaterial cannot
// express per-instance emissive without a custom shader, so we fold the
// style's emissiveIntensity and flashBoost into brightness on the diffuse
// channel. Visual parity with the mesh path is approximate but coherent.
function getOrbInstanceColor(style, out) {
  const target = out || _instanceColorScratch;
  const brightness = 1 + (style.emissiveIntensity || 0) * 0.4 + (style.flashBoost || 0) * 0.6;
  target.copy(style.color).multiplyScalar(Math.min(2.5, brightness));
  return target;
}

function ensureActiveMesh(orb) {
  if (orb.mesh) return;
  const q = getEffectiveQuality();
  const geo = new THREE.SphereGeometry(ORB_RADIUS, q.orbSegments, q.orbRings);
  const mat = new THREE.MeshStandardMaterial({
    color: ORB_COLOR_FUTURE,
    emissive: ORB_COLOR_FUTURE,
    emissiveIntensity: 0.1,
    metalness: 0.2,
    roughness: 0.6,
    transparent: true,
    opacity: 1.0,
  });
  orb.mesh = new THREE.Mesh(geo, mat);
  orb.mesh.position.copy(orb.pos);
  orb.label = makeLabel(orb.value);
  orb.label.position.set(0, ORB_RADIUS + 0.12, 0);
  orb.label.visible = false;
  orb.mesh.add(orb.label);
  nlGroup.add(orb.mesh);
}

function releaseActiveMesh(orb) {
  if (!orb.mesh) return;
  nlGroup.remove(orb.mesh);
  if (orb.label) {
    orb.mesh.remove(orb.label);
    orb.label.material.map?.dispose();
    orb.label.material.dispose();
  }
  orb.mesh.geometry.dispose();
  orb.mesh.material.dispose();
  orb.mesh = null;
  orb.label = null;
}

function updateOrbTiers(currentStep, dt = 0) {
  if (!futureInstanced || !visitedInstanced) return;
  const q = getEffectiveQuality();
  const baseMaxVisible = Math.min(orbVisibleMax, q.maxVisibleOrbs);
  const maxActiveMeshes = Math.max(
    6,
    perfMode === 'eco' ? Math.floor(baseMaxVisible * 0.5) : baseMaxVisible,
  );
  const maxLabels = perfMode === 'eco' ? Math.floor(q.maxLabels * 0.5) : q.maxLabels;
  const labelStride = perfMode === 'eco' ? 3 : (frameDtEma > 0.03 ? 2 : 1);
  const adaptiveVisibleRange = Math.max(10, Math.min(VISIBLE_RANGE, Math.floor(maxActiveMeshes * 0.55)));
  const scratch = new THREE.Object3D();
  const instColor = new THREE.Color();
  let activeCount = 0;
  let labelCount = 0;
  let futureCount = 0;
  let visitedCount = 0;

  for (const orb of stepOrbs) {
    if (!orb) continue;
    const dist = Math.abs(orb.stepIdx - currentStep);
    if (orb.activated) {
      orb.activationMix = Math.min(1, (orb.activationMix || 0) + dt * 2.4);
    }

    // Single semantic style, consumed by both LOD paths below.
    const style = getOrbStyle(orb, currentStep);

    const wantActive = dist <= ACTIVE_RANGE && activeCount < maxActiveMeshes;
    if (wantActive) {
      ensureActiveMesh(orb);
      const scale = orb.stepIdx === currentStep ? ORB_RADIUS_ACTIVE / ORB_RADIUS : 1.0;
      orb.mesh.scale.setScalar(scale);
      orb.mesh.position.copy(orb.pos);
      const wantLabel = labelCount < maxLabels && (orb.stepIdx % labelStride === 0);
      orb.label.visible = wantLabel;
      if (wantLabel) labelCount++;

      // Mesh LOD adapter: full material control (color, emissive, flashBoost).
      orb.mesh.material.color.copy(style.color);
      orb.mesh.material.emissive.copy(style.emissive);
      orb.mesh.material.emissiveIntensity = style.emissiveIntensity + style.flashBoost;
      orb.mesh.material.opacity = style.opacity ?? 1.0;
      activeCount++;
    } else {
      releaseActiveMesh(orb);
      const tierScale = dist <= adaptiveVisibleRange ? 0.6 : 0.3;
      scratch.position.copy(orb.pos);
      scratch.scale.setScalar(tierScale);
      scratch.updateMatrix();

      // Instanced LOD adapter: per-instance color encodes run hue, loop
      // identity, activation, and terminal flash. Same semantic source as
      // the mesh path — brightness is folded in since the standard material
      // can't express per-instance emissive.
      getOrbInstanceColor(style, instColor);
      if (orb.activated) {
        visitedInstanced.setMatrixAt(visitedCount, scratch.matrix);
        visitedInstanced.setColorAt(visitedCount, instColor);
        visitedCount++;
      } else {
        futureInstanced.setMatrixAt(futureCount, scratch.matrix);
        futureInstanced.setColorAt(futureCount, instColor);
        futureCount++;
      }
    }
  }
  futureInstanced.count = futureCount;
  visitedInstanced.count = visitedCount;
  futureInstanced.instanceMatrix.needsUpdate = true;
  visitedInstanced.instanceMatrix.needsUpdate = true;
  if (futureInstanced.instanceColor) futureInstanced.instanceColor.needsUpdate = true;
  if (visitedInstanced.instanceColor) visitedInstanced.instanceColor.needsUpdate = true;
}

// ── Camera system ───────────────────────────────────────
function getCameraTarget(dt = 1 / 60) {
  const ballPos = operatorBall.position.clone();

  // Keep a mild tactical influence for milestone beats, but the orb-run
  // helper owns the core framing (intro/follow/composition/terminal hold).
  const tactical = Math.max(0, Math.min(1, tacticalWeight));
  const target = orbRunCameraRig.getTarget({
    dt,
    ballPos,
    currentStepFloat,
    totalSteps,
    pathSpline,
    playState,
    tacticalWeight: tactical,
  });

  // Legacy tactical offset retained as a subtle lift during short bumps.
  if (tactical > 0 && playState !== 'complete') {
    target.position.lerp(ballPos.clone().add(TACTICAL_OFFSET), tactical * 0.15);
  }

  return target;
}

function updateRuntimePressure(dt) {
  const clamped = Math.max(0.001, Math.min(0.08, dt));
  frameDtEma = frameDtEma * 0.92 + clamped * 0.08;
  if (perfMode === 'auto') {
    if (frameDtEma > 0.036) {
      VISIBLE_RANGE = Math.max(10, VISIBLE_RANGE - 1);
    } else if (frameDtEma < 0.02) {
      const target = Math.max(10, Math.floor((qualityProfile?.maxVisibleOrbs || 50) * 0.5));
      VISIBLE_RANGE = Math.min(target, VISIBLE_RANGE + 1);
    }
  } else {
    const target = Math.max(10, Math.floor((qualityProfile?.maxVisibleOrbs || 50) * 0.35));
    VISIBLE_RANGE = target;
  }
}

// ── Density band (for huge sequences) ───────────────────
// Legacy band visualization for sequences > DENSITY_THRESHOLD steps.
// In the 3D cone layout, the band is a horizontal strip sized from
// the scene bounds. Keep as-is for now — it rarely triggers in normal
// play and is out of scope for the 3D integration.
const LEGACY_BAND_UNIT = 0.5;
function buildDensityBand(values) {
  const endX = (values.length - 1) * LEGACY_BAND_UNIT;
  if (endX <= 0) return;

  const densityArray = new Float32Array(DENSITY_BINS);
  let maxDensity = 0;

  for (let i = 0; i < values.length; i++) {
    const bin = Math.min(DENSITY_BINS - 1, Math.floor((i / values.length) * DENSITY_BINS));
    const lg = bigLog2(values[i]);
    densityArray[bin] = Math.max(densityArray[bin], lg);
    if (densityArray[bin] > maxDensity) maxDensity = densityArray[bin];
  }

  if (maxDensity === 0) return;

  const texData = new Uint8Array(DENSITY_BINS * 4);
  for (let i = 0; i < DENSITY_BINS; i++) {
    const t = densityArray[i] / maxDensity;
    const [r, g, b] = densityColorRamp(t);
    texData[i * 4] = r;
    texData[i * 4 + 1] = g;
    texData[i * 4 + 2] = b;
    texData[i * 4 + 3] = t > 0 ? 255 : 0;
  }

  if (densityTexture) densityTexture.dispose();
  densityTexture = new THREE.DataTexture(texData, DENSITY_BINS, 1, THREE.RGBAFormat);
  densityTexture.magFilter = THREE.LinearFilter;
  densityTexture.minFilter = THREE.LinearFilter;
  densityTexture.needsUpdate = true;

  if (densityMesh) {
    nlGroup.remove(densityMesh);
    densityMesh.geometry.dispose();
    densityMesh.material.dispose();
  }
  const stripGeo = new THREE.PlaneGeometry(endX, 1.0);
  const stripMat = new THREE.MeshBasicMaterial({ map: densityTexture, transparent: true, depthTest: false });
  densityMesh = new THREE.Mesh(stripGeo, stripMat);
  densityMesh.position.set(endX / 2, 1.0, -0.1);
  nlGroup.add(densityMesh);
}

function densityColorRamp(t) {
  if (t <= 0) return [10, 20, 60];
  if (t < 0.33) { const f = t / 0.33; return [Math.round(10), Math.round(20 + 200 * f), Math.round(60 + 195 * f)]; }
  if (t < 0.66) { const f = (t - 0.33) / 0.33; return [Math.round(10 + 245 * f), Math.round(220 + 35 * f), Math.round(255 - 200 * f)]; }
  const f = (t - 0.66) / 0.34;
  return [255, 255, Math.round(55 + 200 * f)];
}

function cleanupDensityBand() {
  if (densityMesh) { nlGroup.remove(densityMesh); densityMesh.geometry.dispose(); densityMesh.material.dispose(); densityMesh = null; }
  if (densityTexture) { densityTexture.dispose(); densityTexture = null; }
}
