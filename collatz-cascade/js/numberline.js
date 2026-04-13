/**
 * Number Line mode: horizontal number line with animated operator ball
 * that bounces through Collatz sequences.
 *
 * Numbers sit on a line going right. An operator sphere launches toward
 * a target, shows the math (Even/Odd + operation), then missiles to the
 * next value. Orbs turn blue when visited. Camera follows the ball.
 */

import * as THREE from 'three';
import { collatzValues } from './collatz.js';

// ── Constants ────────────────────────────────────────────
const SPACING = 0.3;          // world units per integer
const ORB_RADIUS = 0.12;
const OPERATOR_RADIUS = 0.18;
const LINE_Y = 0;
const ARC_HEIGHT_FACTOR = 0.3; // arc height = travel distance * this
const LABEL_SCALE = 0.45;

// Colors
const ORB_COLOR_DEFAULT = new THREE.Color(0.85, 0.35, 0.15);  // reddish orange
const ORB_COLOR_VISITED = new THREE.Color(0.2, 0.45, 0.9);    // complement blue
const OPERATOR_COLOR = new THREE.Color(1, 1, 1);

// Timing (seconds)
const PAUSE_DURATION = 1.8;       // pause on collision to show math
const TRAVEL_BASE_SPEED = 8.0;    // units per second base
const FAST_MULTIPLIER = 4.0;      // speed multiplier for 20+ step sequences
const ZOOM_IN_START = 0.7;        // progress fraction when zoom-in begins
const STEPS_FAST_THRESHOLD = 20;
const EXTRA_CYCLES = 2;           // repeat 4→2→1 this many times

// ── State ────────────────────────────────────────────────
let nlGroup = null;
let lineObj = null;
let orbs = new Map();         // value → { mesh, label, visited }
let operatorBall = null;
let operatorLight = null;
let tickMarks = null;

// Sequence playback
let sequence = [];            // full sequence including extra 4→2→1 cycles
let stepIndex = 0;
let playState = 'idle';       // idle | traveling | paused | complete
let travelProgress = 0;       // 0→1 along current arc
let pauseTimer = 0;
let speedMultiplier = 1;

// Positions for current travel arc
let arcStart = new THREE.Vector3();
let arcEnd = new THREE.Vector3();
let arcControl = new THREE.Vector3();

// Display data for math overlay
let mathDisplay = null;       // { value, isEven, operation, result } or null

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

  // Operator ball
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

  // Point light on operator ball
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
  // Compute sequence
  const values = collatzValues(n);

  // Add extra 4→2→1 cycles
  sequence = [...values];
  for (let c = 0; c < EXTRA_CYCLES; c++) {
    sequence.push(4, 2, 1);
  }

  // Determine speed
  const baseSteps = values.length - 1;
  speedMultiplier = baseSteps > STEPS_FAST_THRESHOLD ? FAST_MULTIPLIER : 1;

  // Find max value to size the line
  let newMax = maxOnLine;
  for (const v of sequence) {
    if (v > newMax) newMax = v;
  }

  // Rebuild line if range expanded
  if (newMax > maxOnLine) {
    maxOnLine = newMax;
    rebuildLine();
  }

  // Ensure orbs exist for all sequence values
  for (const v of sequence) {
    ensureOrb(v);
  }

  // Reset playback
  stepIndex = 0;
  playState = 'idle';
  mathDisplay = null;

  // Launch: operator starts from below the first target
  const firstPos = orbPosition(sequence[0]);
  operatorBall.position.set(firstPos.x, firstPos.y - 4, 2);
  operatorBall.visible = true;

  // Set up first travel arc (launch from below)
  setupArc(
    operatorBall.position.clone(),
    firstPos,
    1.5 // exaggerated arc for launch
  );
  travelProgress = 0;
  playState = 'traveling';
}

/**
 * Update the number line each frame. Returns desired camera target info.
 * @returns {{ position: Vector3, lookAt: Vector3, fov: number } | null}
 */
export function updateNumberLine(dt) {
  if (!active || playState === 'idle' || playState === 'complete') return null;

  const speed = TRAVEL_BASE_SPEED * speedMultiplier;

  if (playState === 'traveling') {
    // Advance along arc
    const dist = arcStart.distanceTo(arcEnd);
    const travelTime = Math.max(dist / speed, 0.3);
    travelProgress += dt / travelTime;

    if (travelProgress >= 1) {
      travelProgress = 1;
      // Snap to target
      operatorBall.position.copy(arcEnd);

      // Mark visited, change color
      const targetVal = sequence[stepIndex];
      markVisited(targetVal);

      // Build math display
      if (stepIndex < sequence.length - 1) {
        const val = targetVal;
        const isEven = val % 2 === 0;
        const next = sequence[stepIndex + 1];
        const op = isEven ? `${formatValue(val)} ÷ 2` : `${formatValue(val)} × 3 + 1`;
        mathDisplay = {
          value: val,
          isEven,
          label: isEven ? 'EVEN' : 'ODD',
          rule: isEven ? 'n ÷ 2' : '3n + 1',
          operation: op,
          result: formatValue(next),
        };
      } else {
        mathDisplay = { value: targetVal, isEven: false, label: 'END', rule: '', operation: '', result: '' };
      }

      // Pause
      playState = 'paused';
      pauseTimer = speedMultiplier > 1 ? PAUSE_DURATION * 0.4 : PAUSE_DURATION;
    } else {
      // Interpolate along bezier arc
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
    pauseTimer -= dt;
    if (pauseTimer <= 0) {
      stepIndex++;
      mathDisplay = null;

      if (stepIndex >= sequence.length - 1) {
        playState = 'complete';
        return getCameraTarget();
      }

      // Set up next arc
      const from = orbPosition(sequence[stepIndex]);
      const to = orbPosition(sequence[stepIndex + 1]);
      setupArc(from, to, ARC_HEIGHT_FACTOR);
      travelProgress = 0;
      playState = 'traveling';
    }
  }

  return getCameraTarget();
}

/**
 * Get camera target for the current state.
 */
function getCameraTarget() {
  const ballPos = operatorBall.position.clone();

  if (playState === 'traveling') {
    // During travel: zoom out to see both start and end
    const mid = arcStart.clone().add(arcEnd).multiplyScalar(0.5);
    const dist = arcStart.distanceTo(arcEnd);
    const zoomOut = Math.max(3, dist * 0.8);

    // As we approach the target (last 30%), start zooming in
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
    // Zoomed in on the target
    return {
      position: new THREE.Vector3(ballPos.x + 0.5, ballPos.y + 1.5, 3),
      lookAt: ballPos,
    };
  }

  // Default / complete
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

function setupArc(from, to, heightFactor) {
  arcStart.copy(from);
  arcEnd.copy(to);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const dist = from.distanceTo(to);
  arcControl.set(mid.x, mid.y + dist * heightFactor, mid.z);
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

  // Label
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
  // Remove old line
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

  // Main axis line
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, LINE_Y, 0),
    new THREE.Vector3(maxOnLine * SPACING + SPACING, LINE_Y, 0),
  ]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x334466, transparent: true, opacity: 0.5 });
  lineObj = new THREE.Line(lineGeo, lineMat);
  nlGroup.add(lineObj);

  // Tick marks at regular intervals
  const interval = tickInterval(maxOnLine);
  const tickPoints = [];
  for (let i = 0; i <= maxOnLine; i += interval) {
    const x = i * SPACING;
    tickPoints.push(new THREE.Vector3(x, LINE_Y - 0.08, 0));
    tickPoints.push(new THREE.Vector3(x, LINE_Y + 0.08, 0));
  }
  if (tickPoints.length > 0) {
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPoints);
    const tickMat = new THREE.LineBasicMaterial({ color: 0x334466, transparent: true, opacity: 0.3 });
    tickMarks = new THREE.LineSegments(tickGeo, tickMat);
    nlGroup.add(tickMarks);
  }
}

function tickInterval(max) {
  if (max <= 50) return 5;
  if (max <= 200) return 10;
  if (max <= 1000) return 50;
  if (max <= 10000) return 500;
  return 5000;
}
