/**
 * Collatz Cascade — Hybrid Path Traversal
 *
 * The ball travels along a step-based path where:
 *   X = stepIndex * STEP_SPACING (primary travel axis)
 *   Y = log2(value) * MAGNITUDE_SCALE (vertical = value magnitude)
 *
 * This replaces the old literal number line where x = value * 0.3,
 * which broke at large values. The new layout keeps every sequence
 * readable regardless of peak value — the player sees a "mountain
 * profile" of the Collatz journey.
 */

import * as THREE from 'three';
import { collatzValues } from './collatz.js';
import {
  isBig, isEven, isOne, log2 as bigLog2,
  valueKey, formatValue as fmtValue,
} from './valueUtils.js';
import { computeSequenceAsync } from './collatz-client.js';

// ── Path layout constants ───────────────────────────────
const STEP_SPACING = 0.5;        // world units per step (X axis)
const MAGNITUDE_SCALE = 0.15;    // world units per log2 unit (Y axis)
const ORB_RADIUS = 0.10;
const ORB_RADIUS_ACTIVE = 0.14;
const OPERATOR_RADIUS = 0.18;
const ORB_SPIN_SPEED = 0.8;      // radians per second (Y-axis rotation)
const LABEL_SCALE = 0.40;
const EXTRA_CYCLES = 2;

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
const CHASE_OFFSET = new THREE.Vector3(-1.5, 1.5, 3.0);
const CHASE_LOOK_AHEAD_STEPS = 4;
const TACTICAL_OFFSET = new THREE.Vector3(0, 2.5, 4.0);
const OVERVIEW_HEIGHT = 8;
const OVERVIEW_DIST = 12;

// Orb tier distances (in steps from ball)
const ACTIVE_RANGE = 5;    // full size + label + glow
const VISIBLE_RANGE = 25;  // visible but small, no label

// Colors
const ORB_COLOR_FUTURE = new THREE.Color(0.3, 0.35, 0.5);
const ORB_COLOR_VISITED = new THREE.Color(0.2, 0.45, 0.9);
const ORB_COLOR_ACTIVE = new THREE.Color(1.0, 0.85, 0.3);
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
let sequence = [];
let pathPositions = [];     // THREE.Vector3[] per step
let pathSpline = null;      // CatmullRomCurve3
let importance = [];        // per-step weight (1.0 normal, 2.0+ milestone)
let baseTimePerStep = 0.4;  // from pacing table
let totalSteps = 0;

// Playback
let currentStepFloat = 0;   // fractional step progress
let playState = 'idle';      // idle | traveling | complete
let userSpeed = 1;
let hitCount = 0;
let mathDisplay = null;
let lastReportedStep = -1;   // for triggering per-step events

// Trail meshes
let previewLine = null;      // full path, faint
let trailLine = null;        // traversed portion, bright

// Step orbs
let stepOrbs = [];           // { mesh, label, stepIdx }

// Camera blending
let cameraMode = 'overview'; // overview | chase | tactical
let tacticalWeight = 0;      // 0..1, ramps up on milestones
let tacticalDecay = 0;

// Launch animation
let launchPhase = 0;          // 0..1, plunger compression progress
const LAUNCH_DURATION = 0.6;  // seconds for plunger wind-up
let plungerRestX = 0;         // original rod/knob X (set in init)

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
export function getMathDisplay() { return mathDisplay; }
export function getPlayState() { return playState; }
export function setSpeed(mult) { userSpeed = mult; }
export function getSpeed() { return userSpeed; }
export function isDensityMode() { return densityMode; }
export function getHitCount() { return hitCount; }
export function getMilestoneCallout() { return milestoneCallout; }
export function formatValue(n) { return fmtValue(n); }
// Legacy exports (no-ops, kept for import compatibility)
export const MAX_ORBS = Infinity;
export function setOrbVisibleMax() {}
export function getOrbVisibleMax() { return Infinity; }

// ── Init ────────────────────────────────────────────────
export function initNumberLine(scene) {
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
  mathDisplay = null;
}

export function clearNumberLine() {
  disposePath();
  sequence = [];
  pathPositions = [];
  pathSpline = null;
  importance = [];
  stepOrbs = [];
  currentStepFloat = 0;
  playState = 'idle';
  hitCount = 0;
  mathDisplay = null;
  lastReportedStep = -1;
  if (operatorBall) operatorBall.visible = false;
  cleanupDensityBand();
}

// ── Path computation ────────────────────────────────────
function pathPosition(stepIdx, value) {
  const x = stepIdx * STEP_SPACING;
  const lg = Math.max(0, bigLog2(value));
  const y = lg * MAGNITUDE_SCALE;
  return new THREE.Vector3(x, y, 0);
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

function buildPath(seq) {
  disposePath();

  totalSteps = seq.length;
  pathPositions = seq.map((v, i) => pathPosition(i, v));
  importance = computeImportance(seq);
  baseTimePerStep = getBaseTimePerStep(totalSteps);

  // Build spline through all positions
  if (pathPositions.length >= 2) {
    pathSpline = new THREE.CatmullRomCurve3(pathPositions, false, 'catmullrom', 0.3);
  }

  // Preview line (full path, faint)
  if (pathPositions.length >= 2) {
    const previewGeo = new THREE.BufferGeometry().setFromPoints(pathPositions);
    const previewMat = new THREE.LineBasicMaterial({
      color: TRAIL_COLOR_FAINT, transparent: true, opacity: 0.2,
    });
    previewLine = new THREE.Line(previewGeo, previewMat);
    nlGroup.add(previewLine);

    // Trail line (bright, grows via drawRange)
    const trailGeo = new THREE.BufferGeometry().setFromPoints(pathPositions);
    const trailMat = new THREE.LineBasicMaterial({
      color: TRAIL_COLOR_BRIGHT, transparent: true, opacity: 0.7,
    });
    trailLine = new THREE.Line(trailGeo, trailMat);
    trailLine.geometry.setDrawRange(0, 1);
    nlGroup.add(trailLine);
  }

  // Create step orbs (all start as future/faint)
  stepOrbs = [];
  for (let i = 0; i < pathPositions.length; i++) {
    const orb = createStepOrb(i, seq[i], pathPositions[i]);
    stepOrbs.push(orb);
  }
}

function createStepOrb(stepIdx, value, pos) {
  const geo = new THREE.SphereGeometry(ORB_RADIUS, 12, 8);
  const mat = new THREE.MeshStandardMaterial({
    color: ORB_COLOR_FUTURE, emissive: ORB_COLOR_FUTURE,
    emissiveIntensity: 0.1, metalness: 0.2, roughness: 0.6,
    transparent: true, opacity: 0.4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  nlGroup.add(mesh);

  // Label (initially hidden, shown when active)
  const label = makeLabel(value);
  label.position.set(0, ORB_RADIUS + 0.12, 0);
  label.visible = false;
  mesh.add(label);

  return { mesh, label, stepIdx, value, activated: false };
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
  for (const orb of stepOrbs) {
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
  if (isBig(n)) {
    computeSequenceAsync(n).then(({ values }) => launchSequence(n, values));
    return;
  }
  const values = collatzValues(n);
  launchSequence(n, values);
}

function launchSequence(n, values) {
  cleanupDensityBand();
  densityMode = false;

  sequence = [...values];
  for (let c = 0; c < EXTRA_CYCLES; c++) {
    sequence.push(4, 2, 1);
  }

  userSpeed = 1;

  // Density mode for extremely long sequences
  if (values.length > DENSITY_THRESHOLD) {
    densityMode = true;
    buildDensityBand(values);
    userSpeed = Math.max(1, sequence.length / 100);
  }

  buildPath(sequence);

  // Reset playback
  currentStepFloat = -1;  // start before step 0 (at shooter)
  hitCount = 0;
  mathDisplay = null;
  lastReportedStep = -1;
  cameraMode = 'overview';
  tacticalWeight = 0;

  // Ball starts at the shooter — launch phase begins with plunger compression
  operatorBall.position.set(SHOOTER_X, SHOOTER_Y, 0);
  operatorBall.visible = true;
  launchPhase = 0;
  playState = 'launching';  // new state: plunger compresses before firing
}

export function skipToEnd() {
  if (playState === 'idle' || playState === 'complete') return;
  currentStepFloat = totalSteps - 1;
  if (pathPositions.length > 0) {
    operatorBall.position.copy(pathPositions[totalSteps - 1]);
  }
  hitCount = totalSteps;
  playState = 'complete';
  mathDisplay = { value: 1, isEven: false, label: 'DONE', rule: '', operation: '', result: '' };
  if (trailLine) trailLine.geometry.setDrawRange(0, totalSteps);
  updateOrbTiers(totalSteps - 1);
}

// ── Update (called each frame) ──────────────────────────
export function updateNumberLine(dt) {
  // Spin the start orb whenever it's visible
  if (operatorBall && operatorBall.visible) {
    operatorBall.rotation.y += ORB_SPIN_SPEED * dt;
  }

  if (!active || playState === 'idle' || playState === 'complete') return null;

  const effectiveDt = dt * userSpeed;

  // Milestone callout timer
  if (milestoneCallout) {
    milestoneTimer -= dt;
    if (milestoneTimer <= 0) milestoneCallout = null;
  }

  // ── LAUNCHING: plunger compresses, then fires ──────────
  if (playState === 'launching') {
    launchPhase += dt / LAUNCH_DURATION;

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
      // FIRE! Snap plunger back, launch the ball
      if (shooterMesh && shooterMesh.children.length >= 2) {
        shooterMesh.children[0].position.x = -0.35;
        shooterMesh.children[1].position.x = -0.6;
      }
      if (shooterMesh) shooterMesh.material.emissiveIntensity = 0.4;
      operatorBall.material.emissive.setHex(0x000000);
      operatorBall.material.emissiveIntensity = 0;

      currentStepFloat = -1;
      playState = 'traveling';
      cameraMode = 'overview';
    }
    return getCameraTarget();
  }

  // ── TRAVELING: ball moves along the path ───────────────
  if (currentStepFloat < 0) {
    // Post-launch flight: shooter → first step position
    currentStepFloat += effectiveDt / 0.3;
    if (currentStepFloat >= 0) {
      currentStepFloat = 0;
      cameraMode = 'chase';
    }
    const t = Math.max(0, currentStepFloat + 1);
    const smooth = t * t * (3 - 2 * t);
    if (pathPositions.length > 0) {
      const start = new THREE.Vector3(SHOOTER_X, SHOOTER_Y, 0);
      operatorBall.position.lerpVectors(start, pathPositions[0], smooth);
    }
  } else {
    // Main traversal: advance by importance-weighted time
    const stepIdx = Math.floor(currentStepFloat);
    const imp = (stepIdx >= 0 && stepIdx < importance.length) ? importance[stepIdx] : 1.0;
    const stepTime = baseTimePerStep * imp;
    currentStepFloat += effectiveDt / stepTime;

    if (currentStepFloat >= totalSteps - 1) {
      currentStepFloat = totalSteps - 1;
      playState = 'complete';
    }

    // Position ball on the spline
    if (pathSpline && totalSteps > 1) {
      const t = Math.min(1, Math.max(0, currentStepFloat / (totalSteps - 1)));
      const pos = pathSpline.getPoint(t);
      operatorBall.position.copy(pos);
    }
  }

  // Per-step events
  const currentStep = Math.floor(Math.max(0, currentStepFloat));
  if (currentStep !== lastReportedStep && currentStep < totalSteps) {
    lastReportedStep = currentStep;
    hitCount = currentStep + 1;

    // Update math display
    const val = sequence[currentStep];
    if (currentStep < sequence.length - 1) {
      const next = sequence[currentStep + 1];
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

    // Activate orb
    if (stepOrbs[currentStep] && !stepOrbs[currentStep].activated) {
      activateOrb(stepOrbs[currentStep]);
    }

    // Trail grows
    if (trailLine) {
      trailLine.geometry.setDrawRange(0, currentStep + 1);
    }

    // Camera: tactical bump on milestones
    if (importance[currentStep] >= MILESTONE_WEIGHT) {
      tacticalWeight = Math.min(1, tacticalWeight + 0.5);
      tacticalDecay = 0.5;
    }

    // Milestone callouts
    if (importance[currentStep] >= TERMINAL_WEIGHT && (val === 4 || val === 4n)) {
      milestoneCallout = { text: '4 → 2 → 1', type: 'terminal' };
      milestoneTimer = CALLOUT_DURATION * 1.5;
    } else if (importance[currentStep] >= MILESTONE_WEIGHT) {
      // Check if new peak
      let isPeak = true;
      const lg = bigLog2(val);
      for (let j = 0; j < currentStep; j++) {
        if (bigLog2(sequence[j]) >= lg) { isPeak = false; break; }
      }
      if (isPeak && currentStep > 0) {
        milestoneCallout = { text: `NEW PEAK: ${fmtValue(val)}`, type: 'peak' };
        milestoneTimer = CALLOUT_DURATION;
      }
    }
  }

  // Decay tactical weight
  if (tacticalDecay > 0) {
    tacticalDecay -= dt;
  } else if (tacticalWeight > 0) {
    tacticalWeight = Math.max(0, tacticalWeight - dt * 2);
  }

  // Update orb tiers
  updateOrbTiers(currentStep);

  return getCameraTarget();
}

// ── Orb tier management ─────────────────────────────────
function activateOrb(orb) {
  orb.activated = true;
  orb.mesh.material.color.copy(ORB_COLOR_VISITED);
  orb.mesh.material.emissive.copy(ORB_COLOR_VISITED);
  orb.mesh.material.emissiveIntensity = 0.3;
  orb.mesh.material.opacity = 1.0;
}

function updateOrbTiers(currentStep) {
  for (const orb of stepOrbs) {
    const dist = Math.abs(orb.stepIdx - currentStep);

    if (dist <= ACTIVE_RANGE) {
      // Active tier: full size, label visible
      const scale = orb.stepIdx === currentStep ? ORB_RADIUS_ACTIVE / ORB_RADIUS : 1.0;
      orb.mesh.scale.setScalar(scale);
      orb.label.visible = true;
      orb.mesh.material.opacity = 1.0;
    } else if (dist <= VISIBLE_RANGE) {
      // Context tier: smaller, no label
      orb.mesh.scale.setScalar(0.6);
      orb.label.visible = false;
      orb.mesh.material.opacity = orb.activated ? 0.5 : 0.2;
    } else {
      // Distant: tiny or hidden
      orb.mesh.scale.setScalar(0.3);
      orb.label.visible = false;
      orb.mesh.material.opacity = orb.activated ? 0.15 : 0.05;
    }
  }
}

// ── Camera system ───────────────────────────────────────
function getCameraTarget() {
  const ballPos = operatorBall.position.clone();

  // Chase camera: behind ball, looking ahead on path
  const chasePos = ballPos.clone().add(CHASE_OFFSET);
  let chaseLookAt = ballPos.clone();
  if (pathSpline && totalSteps > 1 && currentStepFloat >= 0) {
    const lookAheadStep = Math.min(currentStepFloat + CHASE_LOOK_AHEAD_STEPS, totalSteps - 1);
    const lookT = lookAheadStep / (totalSteps - 1);
    chaseLookAt = pathSpline.getPoint(Math.min(1, lookT));
  }

  // Tactical camera: overhead, looking at ball
  const tactPos = ballPos.clone().add(TACTICAL_OFFSET);
  const tactLookAt = ballPos.clone();

  // Blend chase ↔ tactical
  const pos = chasePos.clone().lerp(tactPos, tacticalWeight);
  const lookAt = chaseLookAt.clone().lerp(tactLookAt, tacticalWeight);

  // Override: overview at launch (before step 0) and at finish
  if (currentStepFloat < 0) {
    // Launch overview: show shooter + first few steps
    const overviewTarget = pathPositions.length > 3 ? pathPositions[3] : new THREE.Vector3(2, 0, 0);
    return {
      position: new THREE.Vector3(SHOOTER_X, 2.0, 4.0),
      lookAt: overviewTarget,
    };
  }

  if (playState === 'complete' && pathPositions.length > 0) {
    // Finish overview: pull back to show the full path
    const first = pathPositions[0];
    const last = pathPositions[pathPositions.length - 1];
    const center = first.clone().add(last).multiplyScalar(0.5);
    const span = last.x - first.x;
    return {
      position: new THREE.Vector3(center.x, center.y + Math.max(3, span * 0.3), Math.max(5, span * 0.5)),
      lookAt: center,
    };
  }

  return { position: pos, lookAt };
}

// ── Density band (for huge sequences) ───────────────────
function buildDensityBand(values) {
  const endX = (values.length - 1) * STEP_SPACING;
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
