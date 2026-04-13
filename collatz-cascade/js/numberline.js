/**
 * Number Line mode: horizontal number line with animated operator ball
 * that bounces through Collatz sequences.
 */

import * as THREE from 'three';
import { collatzValues } from './collatz.js';

// ── Constants ────────────────────────────────────────────
const SPACING = 0.3;          // world units per integer
const ORB_RADIUS = 0.12;
const OPERATOR_RADIUS = 0.18;
const LINE_Y = 0;
const LABEL_SCALE = 0.45;

// Arc: minimum height so close numbers still arc visibly
const ARC_MIN_HEIGHT = 0.8;
const ARC_HEIGHT_FACTOR = 0.3;

// Colors
const ORB_COLOR_DEFAULT = new THREE.Color(0.85, 0.35, 0.15);  // reddish orange
const ORB_COLOR_VISITED = new THREE.Color(0.2, 0.45, 0.9);    // complement blue
const OPERATOR_COLOR = new THREE.Color(1, 1, 1);

// Timing (seconds)
const TRAVEL_MIN = 1.2;          // minimum travel time (short hops)
const TRAVEL_MAX = 4.0;          // maximum travel time (long travels)
const PAUSE_DURATION = 0.5;      // pause on collision (half second)
const ZOOM_IN_START = 0.7;       // progress fraction when zoom-in begins
const EXTRA_CYCLES = 2;          // repeat 4→2→1 this many times

// Bounce animation during pause: single dramatic upward hop
const BOUNCE_HEIGHT = 1.5;       // max height of the bounce arc

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

// Active state
let active = false;

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

export function isNumberLineActive() { return active; }
export function getMathDisplay() { return mathDisplay; }
export function getPlayState() { return playState; }

export function setSpeed(mult) { userSpeed = mult; }
export function getSpeed() { return userSpeed; }

/**
 * Format a number for display. Scientific notation above 999,999.
 */
export function formatValue(n) {
  if (n > 999999) return n.toExponential(2);
  return n.toLocaleString();
}

/**
 * Start a Collatz sequence from number n on the number line.
 */
export function startSequence(n) {
  const values = collatzValues(n);

  // Build full sequence with extra 4→2→1 cycles
  sequence = [...values];
  for (let c = 0; c < EXTRA_CYCLES; c++) {
    sequence.push(4, 2, 1);
  }

  // Reset user speed
  userSpeed = 1;

  // Find max value to size the line
  let newMax = maxOnLine;
  for (const v of sequence) {
    if (v > newMax) newMax = v;
  }

  if (newMax > maxOnLine) {
    maxOnLine = newMax;
    rebuildLine();
  }

  for (const v of sequence) {
    ensureOrb(v);
  }

  // Reset playback
  stepIndex = 0;
  mathDisplay = null;

  // Launch from below the first target
  const firstPos = orbPosition(sequence[0]);
  operatorBall.position.set(firstPos.x, firstPos.y - 4, 2);
  operatorBall.visible = true;

  setupArc(operatorBall.position.clone(), firstPos);
  travelProgress = 0;
  playState = 'traveling';
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

      // Mark visited
      const targetVal = sequence[stepIndex];
      markVisited(targetVal);

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
      // Quadratic bezier interpolation
      const t = travelProgress;
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
    pauseElapsed += effectiveDt;

    // Single dramatic upward bounce: goes up and comes back in one arc
    // t goes from 0 → 1 over the pause duration
    const t = Math.min(1, pauseElapsed / PAUSE_DURATION);
    // sin(t * π) = parabolic arc: 0 → 1 → 0
    const bounceY = Math.sin(t * Math.PI) * BOUNCE_HEIGHT;
    operatorBall.position.y = pauseOrbY + OPERATOR_RADIUS + bounceY;

    if (pauseTimer <= 0) {
      stepIndex++;

      // NOTE: mathDisplay stays visible — it persists until next collision

      if (stepIndex >= sequence.length - 1) {
        playState = 'complete';
        return getCameraTarget();
      }

      // Set up next arc
      const from = orbPosition(sequence[stepIndex]);
      const to = orbPosition(sequence[stepIndex + 1]);
      setupArc(from, to);
      travelProgress = 0;
      playState = 'traveling';
    }
  }

  return getCameraTarget();
}

/**
 * Camera target for the current state.
 */
function getCameraTarget() {
  const ballPos = operatorBall.position.clone();

  if (playState === 'traveling') {
    const dist = arcStart.distanceTo(arcEnd);
    const zoomOut = Math.max(3, dist * 0.8);

    let camDist = zoomOut;
    if (travelProgress > ZOOM_IN_START) {
      const zoomInT = (travelProgress - ZOOM_IN_START) / (1 - ZOOM_IN_START);
      camDist = zoomOut * (1 - zoomInT * 0.7);
    }

    return {
      position: new THREE.Vector3(ballPos.x, ballPos.y + camDist * 0.3, camDist),
      lookAt: ballPos,
    };
  }

  if (playState === 'paused') {
    return {
      position: new THREE.Vector3(ballPos.x + 0.5, ballPos.y + 1.5, 3),
      lookAt: ballPos,
    };
  }

  return {
    position: new THREE.Vector3(ballPos.x, ballPos.y + 3, 8),
    lookAt: ballPos,
  };
}

// ── Zoom / Navigation Controls ───────────────────────────

export function zoomToExtents(camera, controls) {
  if (maxOnLine === 0) return;
  const midX = maxOnLine * SPACING * 0.5;
  const dist = maxOnLine * SPACING * 0.6;
  camera.position.set(midX, dist * 0.3, dist);
  controls.target.set(midX, 0, 0);
}

export function zoomToNumber(n, camera, controls) {
  const x = n * SPACING;
  camera.position.set(x, 2, 5);
  controls.target.set(x, 0, 0);
}

export function findLowestUnvisited() {
  for (let i = 2; i <= maxOnLine; i++) {
    if (!allVisited.has(i)) return i;
  }
  return null;
}

export function findHighestUnvisited() {
  for (let i = maxOnLine; i >= 2; i--) {
    if (!allVisited.has(i)) return i;
  }
  return null;
}

// ── Internal helpers ─────────────────────────────────────

function orbPosition(value) {
  return new THREE.Vector3(value * SPACING, LINE_Y, 0);
}

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
  const rawTime = 2.0 + (dist / (maxOnLine * SPACING || 1)) * 2.0;
  travelDuration = Math.max(TRAVEL_MIN, Math.min(TRAVEL_MAX, rawTime));
}

function markVisited(value) {
  allVisited.add(value);
  const orb = orbs.get(value);
  if (orb && !orb.visited) {
    orb.visited = true;
    orb.mesh.material.color.copy(ORB_COLOR_VISITED);
    orb.mesh.material.emissive.copy(ORB_COLOR_VISITED);
    orb.mesh.material.emissiveIntensity = 0.2;
  }
}

function ensureOrb(value) {
  if (orbs.has(value)) return;

  const pos = orbPosition(value);
  const geo = new THREE.SphereGeometry(ORB_RADIUS, 16, 12);
  const visited = allVisited.has(value);
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

  orbs.set(value, { mesh, label, visited });
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

  // Main axis line: brighter and uses a thin flat box so it's visible at any zoom
  const lineLength = maxOnLine * SPACING + SPACING;
  const boxGeo = new THREE.BoxGeometry(lineLength, 0.06, 0.06);
  const boxMat = new THREE.MeshBasicMaterial({ color: 0x5577aa, transparent: true, opacity: 0.8 });
  lineObj = new THREE.Mesh(boxGeo, boxMat);
  lineObj.position.set(lineLength / 2, LINE_Y, 0);
  nlGroup.add(lineObj);

  // Tick marks and scale labels
  const interval = tickInterval(maxOnLine);
  const tickPoints = [];
  const tickSize = Math.max(0.2, interval * SPACING * 0.1);
  for (let i = 0; i <= maxOnLine; i += interval) {
    const x = i * SPACING;
    tickPoints.push(new THREE.Vector3(x, LINE_Y - tickSize, 0));
    tickPoints.push(new THREE.Vector3(x, LINE_Y + tickSize, 0));

    // Scale label below the tick — always visible via large sprite
    if (i > 0) {
      const labelSprite = makeScaleLabel(i, tickSize);
      labelSprite.position.set(x, LINE_Y - tickSize * 2.5, 0);
      nlGroup.add(labelSprite);
      scaleLabels.push(labelSprite);
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
  // Scale proportional to tick interval so label stays proportional to the line section
  const labelScale = Math.max(1.0, tickSize * 6);
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
