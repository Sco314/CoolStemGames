/**
 * Number Line mode: horizontal number line with animated operator ball
 * that bounces through Collatz sequences.
 */

import * as THREE from 'three';
import { collatzValues } from './collatz.js';
import {
  isBig, isEven, isOne, log10 as bigLog10, log2 as bigLog2,
  valueKey, formatValue as fmtValue,
} from './valueUtils.js';
import { scheduleBatch } from './scheduler.js';
import { computeSequenceAsync } from './collatz-client.js';

// ── Memory ceilings ──────────────────────────────────────
export const MAX_ORBS = Infinity;
let visibleMax = Infinity;

// Sequences longer than this auto-switch to density band rendering
const DENSITY_THRESHOLD = 2000;
const DENSITY_BINS = 512;

// ── Constants ────────────────────────────────────────────
const SPACING = 0.3;          // world units per integer
const ORB_RADIUS = 0.12;
const OPERATOR_RADIUS = 0.18;
const LINE_Y = 0;
const LABEL_SCALE = 0.45;

// Rebound arc: low, direct trajectory (pinball feel)
const ARC_MIN_HEIGHT = 0.15;
const ARC_HEIGHT_FACTOR = 0.06;

// Colors
const ORB_COLOR_DEFAULT = new THREE.Color(0.85, 0.35, 0.15);  // reddish orange
const ORB_COLOR_VISITED = new THREE.Color(0.2, 0.45, 0.9);    // complement blue
const OPERATOR_COLOR = new THREE.Color(1, 1, 1);

// Timing (seconds) — fast pinball pacing
const TRAVEL_MIN = 0.3;          // minimum travel time (short hops)
const TRAVEL_MAX = 0.8;          // maximum travel time (long travels)
const PAUSE_DURATION = 0.12;     // brief impact flash
const EXTRA_CYCLES = 2;          // repeat 4→2→1 this many times

// Bounce animation during pause: single dramatic upward hop
const BOUNCE_HEIGHT = 0.15;      // tiny impact rebound

// Pinball shooter position (just left of the number line origin)
const SHOOTER_X = -0.6;
const SHOOTER_Y = LINE_Y;

// ── State ────────────────────────────────────────────────
let nlGroup = null;
let lineObj = null;
let scaleLabels = [];            // array of sprite labels at major ticks
let orbs = new Map();
let operatorBall = null;
let operatorLight = null;
let tickMarks = null;

// Sequence playback
let sequence = [];
let stepIndex = 0;
let playState = 'idle';       // idle | traveling | paused | complete
let travelProgress = 0;
let travelDuration = 2;       // computed per-arc
let pauseTimer = 0;

// User-controlled speed multiplier (1x, 2x, 4x, 8x)
let userSpeed = 1;

// Scale mode: 'linear' or 'log'
let scaleMode = 'linear';
const LOG_SCALE_UNIT = 3.0;  // world units per decade in log mode

// Bounce during pause
let pauseElapsed = 0;
let pauseOrbY = 0;             // Y position of the target orb (to bounce above)

// Positions for current travel arc
let arcStart = new THREE.Vector3();
let arcEnd = new THREE.Vector3();
let arcControl = new THREE.Vector3();

// Display data for math overlay — persists until next number reached
let mathDisplay = null;

// Visited tracking across all runs
const allVisited = new Set();
let maxOnLine = 0;

// Hit counter
let hitCount = 0;

// Pinball shooter mesh
let shooterMesh = null;

// Density band state (for sequences above DENSITY_THRESHOLD steps)
let densityMode = false;
let densityTexture = null;
let densityMesh = null;

// Active state
let active = false;

export function isDensityMode() { return densityMode; }
export function getHitCount() { return hitCount; }

// ── Public API ───────────────────────────────────────────

export function initNumberLine(scene) {
  nlGroup = new THREE.Group();
  nlGroup.visible = false;
  scene.add(nlGroup);

  const geo = new THREE.SphereGeometry(OPERATOR_RADIUS, 20, 14);
  const mat = new THREE.MeshStandardMaterial({
    color: OPERATOR_COLOR,
    emissive: OPERATOR_COLOR,
    emissiveIntensity: 0.5,
    metalness: 0.3,
    roughness: 0.4,
  });
  operatorBall = new THREE.Mesh(geo, mat);
  operatorBall.visible = false;
  nlGroup.add(operatorBall);

  operatorLight = new THREE.PointLight(0xffeedd, 1.0, 8, 2);
  operatorBall.add(operatorLight);

  // Pinball shooter: a small housing that the ball launches from
  const shooterGeo = new THREE.BoxGeometry(0.6, 0.35, 0.35);
  const shooterMat = new THREE.MeshStandardMaterial({
    color: 0x6688aa,
    emissive: 0x445566,
    emissiveIntensity: 0.4,
    metalness: 0.4,
    roughness: 0.35,
  });
  shooterMesh = new THREE.Mesh(shooterGeo, shooterMat);
  shooterMesh.position.set(SHOOTER_X, SHOOTER_Y, 0);
  nlGroup.add(shooterMesh);

  // Plunger rod inside the shooter
  const rodGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8);
  const rodMat = new THREE.MeshStandardMaterial({ color: 0x889abb, metalness: 0.8, roughness: 0.2 });
  const rod = new THREE.Mesh(rodGeo, rodMat);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(-0.35, 0, 0);
  shooterMesh.add(rod);

  // Plunger knob
  const knobGeo = new THREE.SphereGeometry(0.09, 12, 8);
  const knobMat = new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xff2222, emissiveIntensity: 0.4 });
  const knob = new THREE.Mesh(knobGeo, knobMat);
  knob.position.set(-0.6, 0, 0);
  shooterMesh.add(knob);
}

export function showNumberLine() {
  if (nlGroup) nlGroup.visible = true;
  active = true;
  // Pre-load orbs 0, 1, 2 so the number line has visible reference
  // points on first load (before the user enters a number).
  if (orbs.size === 0) {
    maxOnLine = 2;
    rebuildLine();
    ensureOrb(0);
    ensureOrb(1);
    ensureOrb(2);
  }
}

export function hideNumberLine() {
  if (nlGroup) nlGroup.visible = false;
  active = false;
  playState = 'idle';
  operatorBall.visible = false;
  mathDisplay = null;
}

export function isNumberLineActive() { return active; }
export function getMathDisplay() { return mathDisplay; }
export function getPlayState() { return playState; }

export function setSpeed(mult) { userSpeed = mult; }
export function getSpeed() { return userSpeed; }

/**
 * Format a value (Number or BigInt) for display.
 */
export function formatValue(n) {
  return fmtValue(n);
}

/**
 * Start a Collatz sequence from number n on the number line.
 * For BigInt or huge sequences, uses the Web Worker for off-thread compute.
 * Sequences above DENSITY_THRESHOLD steps auto-switch to density band rendering.
 */
export function startSequence(n) {
  // For BigInt inputs, use async worker so the main thread doesn't freeze
  if (isBig(n)) {
    computeSequenceAsync(n).then(({ values }) => launchSequence(n, values));
    return;
  }

  const values = collatzValues(n);
  launchSequence(n, values);
}

function launchSequence(n, values) {
  // Clean up previous density band if any
  cleanupDensityBand();
  densityMode = false;

  // Build full sequence with extra 4→2→1 cycles
  sequence = [...values];
  for (let c = 0; c < EXTRA_CYCLES; c++) {
    sequence.push(4, 2, 1);
  }

  // Reset user speed
  userSpeed = 1;

  // Find max value to size the line
  let newMax = maxOnLine;
  let curMaxLog = bigLog10(typeof maxOnLine === 'number' && maxOnLine > 0 ? maxOnLine : 1);
  for (const v of sequence) {
    const lg = bigLog10(v);
    if (lg > curMaxLog) {
      curMaxLog = lg;
      newMax = v;
    }
  }
  if (bigLog10(typeof newMax === 'number' ? Math.max(newMax, 1) : newMax) >
      bigLog10(typeof maxOnLine === 'number' ? Math.max(maxOnLine, 1) : maxOnLine)) {
    maxOnLine = newMax;
    rebuildLine();
  }

  // Long sequences → density band mode
  if (values.length > DENSITY_THRESHOLD) {
    densityMode = true;
    renderDensityBand(values);
    // Auto-scale speed so the whole journey takes ~10 seconds
    const totalSteps = sequence.length - 1;
    userSpeed = Math.max(1, totalSteps / (10 / TRAVEL_MIN));
  }

  // First orb must exist synchronously so the launch arc has a target
  ensureOrb(sequence[0]);
  if (!densityMode && sequence.length > 1) {
    scheduleBatch(sequence.slice(1), (v) => ensureOrb(v), { priority: 6 });
  }

  // Reset playback + hit counter
  stepIndex = 0;
  hitCount = 0;
  mathDisplay = null;

  // Ball starts inside the pinball shooter, then launches to the first number
  const firstPos = orbPosition(sequence[0]);
  operatorBall.position.set(SHOOTER_X, SHOOTER_Y, 0);
  operatorBall.visible = true;

  setupArc(new THREE.Vector3(SHOOTER_X, SHOOTER_Y, 0), firstPos);
  travelProgress = 0;
  playState = 'traveling';
}

/**
 * Skip the ball animation to the end (for long density-mode sequences).
 */
export function skipToEnd() {
  if (!densityMode || playState === 'complete' || playState === 'idle') return;
  stepIndex = sequence.length - 1;
  const lastVal = sequence[stepIndex];
  const lastPos = orbPosition(lastVal);
  operatorBall.position.copy(lastPos);
  markVisited(lastVal);
  playState = 'complete';
  mathDisplay = {
    value: lastVal, isEven: false,
    label: 'DONE', rule: '', operation: '', result: '',
  };
}

// ── Density band rendering ──────────────────────────────
function renderDensityBand(values) {
  // Bin all visited values along the number line's X axis.
  // Each bin covers a range of X positions.
  const endX = orbPosition(maxOnLine).x;
  if (endX <= 0) return;

  const densityArray = new Float32Array(DENSITY_BINS);
  let maxDensity = 0;

  for (const v of values) {
    const x = orbPosition(v).x;
    const bin = Math.min(DENSITY_BINS - 1, Math.max(0, Math.floor((x / endX) * DENSITY_BINS)));
    densityArray[bin]++;
    if (densityArray[bin] > maxDensity) maxDensity = densityArray[bin];
  }

  if (maxDensity === 0) return;

  // Generate a 1D RGBA texture from density data
  // Color ramp: cold blue → cyan → yellow → white
  const texData = new Uint8Array(DENSITY_BINS * 4);
  for (let i = 0; i < DENSITY_BINS; i++) {
    const t = densityArray[i] / maxDensity;  // 0..1
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

  // Create a thin strip mesh along the number line
  if (densityMesh) {
    nlGroup.remove(densityMesh);
    densityMesh.geometry.dispose();
    densityMesh.material.dispose();
  }
  const stripGeo = new THREE.PlaneGeometry(endX, 0.6);
  const stripMat = new THREE.MeshBasicMaterial({
    map: densityTexture,
    transparent: true,
    depthTest: false,
  });
  densityMesh = new THREE.Mesh(stripGeo, stripMat);
  densityMesh.position.set(endX / 2, LINE_Y + 0.5, -0.1);
  nlGroup.add(densityMesh);
}

function densityColorRamp(t) {
  // 0 → dark blue, 0.33 → cyan, 0.66 → yellow, 1.0 → white
  if (t <= 0) return [10, 20, 60];
  if (t < 0.33) {
    const f = t / 0.33;
    return [Math.round(10 + 0 * f), Math.round(20 + 200 * f), Math.round(60 + 195 * f)];
  }
  if (t < 0.66) {
    const f = (t - 0.33) / 0.33;
    return [Math.round(10 + 245 * f), Math.round(220 + 35 * f), Math.round(255 - 200 * f)];
  }
  const f = (t - 0.66) / 0.34;
  return [255, 255, Math.round(55 + 200 * f)];
}

function cleanupDensityBand() {
  if (densityMesh) {
    nlGroup.remove(densityMesh);
    densityMesh.geometry.dispose();
    densityMesh.material.dispose();
    densityMesh = null;
  }
  if (densityTexture) {
    densityTexture.dispose();
    densityTexture = null;
  }
}

/**
 * Fully dispose the number line state. Called on mode-switch away
 * from Number Line to keep VRAM from accumulating across modes.
 */
export function clearNumberLine() {
  for (const orb of orbs.values()) {
    if (orb.mesh) {
      nlGroup.remove(orb.mesh);
      if (orb.label) {
        orb.mesh.remove(orb.label);
        orb.label.material.map?.dispose();
        orb.label.material.dispose();
      }
      orb.mesh.geometry.dispose();
      orb.mesh.material.dispose();
    }
  }
  orbs.clear();
  allVisited.clear();
  maxOnLine = 0;
  sequence = [];
  stepIndex = 0;
  playState = 'idle';
  mathDisplay = null;
  if (operatorBall) operatorBall.visible = false;
  rebuildLine();
}

/**
 * Set the soft ceiling on visible orbs. Capped at MAX_ORBS.
 */
export function setOrbVisibleMax(n) {
  visibleMax = Math.max(1, Math.min(n | 0, MAX_ORBS));
  evictOldestOrbs();
}

export function getOrbVisibleMax() { return visibleMax; }

function evictOldestOrbs() {
  if (orbs.size <= visibleMax) return;
  // Build a set of keys we must keep: still-upcoming values in the
  // current sequence (from stepIndex onwards).
  const pinned = new Set();
  for (let i = stepIndex; i < sequence.length; i++) {
    pinned.add(valueKey(sequence[i]));
  }
  // Walk insertion order (oldest first), evict if not pinned.
  for (const [key, orb] of orbs) {
    if (orbs.size <= visibleMax) break;
    if (pinned.has(key)) continue;
    nlGroup.remove(orb.mesh);
    if (orb.label) {
      orb.mesh.remove(orb.label);
      orb.label.material.map?.dispose();
      orb.label.material.dispose();
    }
    orb.mesh.geometry.dispose();
    orb.mesh.material.dispose();
    orbs.delete(key);
  }
}

/**
 * Update the number line each frame. Returns desired camera target info.
 */
export function updateNumberLine(dt) {
  if (!active || playState === 'idle' || playState === 'complete') return null;

  const effectiveDt = dt * userSpeed;

  if (playState === 'traveling') {
    travelProgress += effectiveDt / travelDuration;

    if (travelProgress >= 1) {
      travelProgress = 1;
      operatorBall.position.copy(arcEnd);

      // Mark visited + count hit
      const targetVal = sequence[stepIndex];
      markVisited(targetVal);
      hitCount++;

      // Build math display — stays visible until next collision
      if (stepIndex < sequence.length - 1) {
        const val = targetVal;
        const isEven = val % 2 === 0;
        const next = sequence[stepIndex + 1];
        const op = isEven
          ? `${formatValue(val)} ÷ 2`
          : `${formatValue(val)} × 3 + 1`;
        mathDisplay = {
          value: val,
          isEven,
          label: isEven ? 'EVEN' : 'ODD',
          rule: isEven ? 'n ÷ 2' : '3n + 1',
          operation: op,
          result: formatValue(next),
        };
      } else {
        mathDisplay = {
          value: targetVal, isEven: false,
          label: 'DONE', rule: '', operation: '', result: '',
        };
      }

      playState = 'paused';
      pauseTimer = PAUSE_DURATION;
      pauseElapsed = 0;
      pauseOrbY = arcEnd.y;
    } else {
      // Quadratic bezier with smoothstep easing for natural acceleration
      const raw = travelProgress;
      const t = raw * raw * (3 - 2 * raw);  // smoothstep
      const invT = 1 - t;
      operatorBall.position.set(
        invT * invT * arcStart.x + 2 * invT * t * arcControl.x + t * t * arcEnd.x,
        invT * invT * arcStart.y + 2 * invT * t * arcControl.y + t * t * arcEnd.y,
        invT * invT * arcStart.z + 2 * invT * t * arcControl.z + t * t * arcEnd.z,
      );
    }
  }

  if (playState === 'paused') {
    pauseTimer -= effectiveDt;

    // No upward bounce — ball sits at the collision point briefly,
    // then immediately launches toward the next number.
    // The short PAUSE_DURATION (0.12s) creates a natural "impact dwell"
    // before the rebound.

    if (pauseTimer <= 0) {
      stepIndex++;

      if (stepIndex >= sequence.length - 1) {
        playState = 'complete';
        return getCameraTarget();
      }

      // Rebound: launch directly from current position toward next number
      const to = orbPosition(sequence[stepIndex + 1]);
      setupArc(operatorBall.position.clone(), to);
      travelProgress = 0;
      playState = 'traveling';
    }
  }

  return getCameraTarget();
}

/**
 * Camera: follows the ball from slightly above and behind, shifted
 * right so the shooter + number line stay visible on mobile.
 */
function getCameraTarget() {
  const ballPos = operatorBall.position.clone();
  return {
    position: new THREE.Vector3(ballPos.x + 0.5, ballPos.y + 1.5, 3.0),
    lookAt: new THREE.Vector3(ballPos.x + 1.5, ballPos.y, 0),
  };
}

// ── Zoom / Navigation Controls ───────────────────────────

export function zoomToExtents(camera, controls) {
  if (!maxOnLine || (typeof maxOnLine === 'number' && maxOnLine === 0)) return;
  const endX = orbPosition(maxOnLine).x;
  const midX = endX * 0.5;
  const dist = endX * 0.6 + 3;
  camera.position.set(midX, dist * 0.3, dist);
  controls.target.set(midX, 0, 0);
}

export function zoomToNumber(n, camera, controls) {
  const x = orbPosition(n).x;
  camera.position.set(x, 2, 5);
  controls.target.set(x, 0, 0);
}

export function findLowestUnvisited() {
  // maxOnLine is a Number for iteration purposes; only matters for small N
  const cap = typeof maxOnLine === 'number' ? maxOnLine : 100000;
  for (let i = 2; i <= cap; i++) {
    if (!allVisited.has(valueKey(i))) return i;
  }
  return null;
}

export function findHighestUnvisited() {
  const cap = typeof maxOnLine === 'number' ? maxOnLine : 100000;
  for (let i = cap; i >= 2; i--) {
    if (!allVisited.has(valueKey(i))) return i;
  }
  return null;
}

// ── Internal helpers ─────────────────────────────────────

function orbPosition(value) {
  let x;
  if (scaleMode === 'log') {
    x = Math.max(0, bigLog10(value)) * LOG_SCALE_UNIT;
  } else {
    // Linear scale — for BigInt values that exceed Number range, fall
    // back to log10 * large multiplier so it still lands on-screen.
    if (isBig(value) && value > BigInt(Number.MAX_SAFE_INTEGER)) {
      x = bigLog10(value) * LOG_SCALE_UNIT * 4;  // effectively log mode for huge
    } else {
      x = Number(value) * SPACING;
    }
  }
  return new THREE.Vector3(x, LINE_Y, 0);
}

/**
 * Toggle between linear and log scale. Updates all orb and line positions.
 */
export function setScaleMode(mode) {
  if (mode !== 'linear' && mode !== 'log') return;
  scaleMode = mode;

  // Reposition all existing orbs to their new scale positions
  for (const orb of orbs.values()) {
    const pos = orbPosition(orb.value);
    orb.mesh.position.copy(pos);
  }

  // Rebuild the line/ticks to match new scale
  rebuildLine();
}

export function getScaleMode() { return scaleMode; }

/**
 * Set up a bezier arc from → to.
 * Arc height: max(ARC_MIN_HEIGHT, distance * ARC_HEIGHT_FACTOR).
 * Close numbers get a tall arc relative to distance so the ball visibly rises.
 * Travel time: clamped between TRAVEL_MIN and TRAVEL_MAX.
 */
function setupArc(from, to) {
  arcStart.copy(from);
  arcEnd.copy(to);
  const dist = from.distanceTo(to);

  // Arc height: minimum ensures close numbers still arc up
  const height = Math.max(ARC_MIN_HEIGHT, dist * ARC_HEIGHT_FACTOR);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  arcControl.set(mid.x, mid.y + height, mid.z);

  // Travel time: proportional to distance, clamped 2s–4s
  // Short hops take 2s, long travels take up to 4s
  const maxLineExtent = orbPosition(maxOnLine).x || 1;
  const rawTime = 2.0 + (dist / maxLineExtent) * 2.0;
  travelDuration = Math.max(TRAVEL_MIN, Math.min(TRAVEL_MAX, rawTime));
}

function markVisited(value) {
  const key = valueKey(value);
  allVisited.add(key);
  const orb = orbs.get(key);
  if (orb && !orb.visited) {
    orb.visited = true;
    orb.mesh.material.color.copy(ORB_COLOR_VISITED);
    orb.mesh.material.emissive.copy(ORB_COLOR_VISITED);
    orb.mesh.material.emissiveIntensity = 0.2;
  }
}

function ensureOrb(value) {
  const key = valueKey(value);
  if (orbs.has(key)) return;

  const pos = orbPosition(value);
  const geo = new THREE.SphereGeometry(ORB_RADIUS, 16, 12);
  const visited = allVisited.has(key);
  const col = visited ? ORB_COLOR_VISITED.clone() : ORB_COLOR_DEFAULT.clone();
  const mat = new THREE.MeshStandardMaterial({
    color: col,
    emissive: col.clone(),
    emissiveIntensity: visited ? 0.2 : 0.15,
    metalness: 0.2,
    roughness: 0.6,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.userData.collatzValue = value;
  nlGroup.add(mesh);

  const label = makeLabel(value);
  label.position.set(0, ORB_RADIUS + 0.15, 0);
  mesh.add(label);

  orbs.set(key, { mesh, label, visited, value });

  // Keep orb count bounded via LRU.
  if (orbs.size > visibleMax) evictOldestOrbs();
}

function makeLabel(value) {
  const text = formatValue(value);
  const canvas = document.createElement('canvas');
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#e0e6f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontSize = Math.max(18, Math.min(48, 48 - text.length * 3));
  ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
  ctx.fillText(text, size / 2, size / 2);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(LABEL_SCALE, LABEL_SCALE, 1);
  sprite.renderOrder = 1;
  return sprite;
}

function rebuildLine() {
  if (lineObj) {
    nlGroup.remove(lineObj);
    lineObj.geometry.dispose();
    lineObj.material.dispose();
  }
  if (tickMarks) {
    nlGroup.remove(tickMarks);
    tickMarks.geometry.dispose();
    tickMarks.material.dispose();
  }
  for (const sprite of scaleLabels) {
    nlGroup.remove(sprite);
    sprite.material.map?.dispose();
    sprite.material.dispose();
  }
  scaleLabels = [];

  // Main axis line: length depends on scale mode
  const lineEndX = orbPosition(maxOnLine).x + (scaleMode === 'log' ? 1.5 : SPACING);
  const boxGeo = new THREE.BoxGeometry(lineEndX, 0.06, 0.06);
  const boxMat = new THREE.MeshBasicMaterial({ color: 0x5577aa, transparent: true, opacity: 0.8 });
  lineObj = new THREE.Mesh(boxGeo, boxMat);
  lineObj.position.set(lineEndX / 2, LINE_Y, 0);
  nlGroup.add(lineObj);

  // Tick marks and scale labels
  const tickPoints = [];

  // Use log decade as the iteration limit so this works for BigInt too
  const maxLog10 = bigLog10(typeof maxOnLine === 'number' && maxOnLine > 0 ? maxOnLine : maxOnLine);
  const numericMax = isBig(maxOnLine) ? Number.MAX_SAFE_INTEGER : maxOnLine;

  if (scaleMode === 'log' || isBig(maxOnLine)) {
    // Log scale: ticks at 1, 10, 100, 1000, ..., up to ⌈log10(max)⌉
    const tickSize = 0.35;
    const maxExp = Math.ceil(maxLog10);
    for (let exp = 0; exp <= maxExp; exp++) {
      const val = exp <= 15 ? Math.pow(10, exp) : (10n ** BigInt(exp));
      const x = orbPosition(val).x;
      tickPoints.push(new THREE.Vector3(x, LINE_Y - tickSize, 0));
      tickPoints.push(new THREE.Vector3(x, LINE_Y + tickSize, 0));
      const labelSprite = makeScaleLabel(val, tickSize);
      labelSprite.position.set(x, LINE_Y - tickSize * 2.5, 0);
      nlGroup.add(labelSprite);
      scaleLabels.push(labelSprite);
    }
  } else {
    // Linear scale: ticks at interval
    const interval = tickInterval(numericMax);
    const tickSize = Math.max(0.2, interval * SPACING * 0.1);
    for (let i = 0; i <= numericMax; i += interval) {
      const x = i * SPACING;
      tickPoints.push(new THREE.Vector3(x, LINE_Y - tickSize, 0));
      tickPoints.push(new THREE.Vector3(x, LINE_Y + tickSize, 0));

      if (i > 0) {
        const labelSprite = makeScaleLabel(i, tickSize);
        labelSprite.position.set(x, LINE_Y - tickSize * 2.5, 0);
        nlGroup.add(labelSprite);
        scaleLabels.push(labelSprite);
      }
    }
  }
  if (tickPoints.length > 0) {
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPoints);
    const tickMat = new THREE.LineBasicMaterial({ color: 0x5577aa, transparent: true, opacity: 0.7 });
    tickMarks = new THREE.LineSegments(tickGeo, tickMat);
    nlGroup.add(tickMarks);
  }
}

// Scale label: scales with tick interval so it's readable at any zoom
function makeScaleLabel(value, tickSize) {
  const text = formatValue(value);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#889abb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 36px -apple-system, sans-serif';
  ctx.fillText(text, 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  // Scale grows with log of tick size so labels stay readable without
  // filling the screen at large numbers.
  const labelScale = Math.max(1.0, Math.min(6.0, 1.0 + Math.log2(Math.max(1, tickSize)) * 0.8));
  sprite.scale.set(labelScale * 2, labelScale * 0.5, 1);
  sprite.renderOrder = 2;
  return sprite;
}

function tickInterval(max) {
  if (max <= 50) return 5;
  if (max <= 200) return 10;
  if (max <= 1000) return 50;
  if (max <= 10000) return 500;
  return 5000;
}
