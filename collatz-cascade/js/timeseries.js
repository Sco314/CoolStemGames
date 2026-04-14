/**
 * Time Series mode: classic Collatz chart.
 * X-axis = step number, Y-axis = log2(value).
 * Each input number adds a colored line showing its trajectory.
 * Animated left-to-right draw-in as the line reveals.
 */

import * as THREE from 'three';
import { collatzValues } from './collatz.js';

// ── Constants ────────────────────────────────────────────
const CHART_WIDTH = 24;
const CHART_HEIGHT = 14;
const LINE_RADIUS = 0.06;
const AXIS_COLOR = 0x667799;
const AXIS_OPACITY = 0.6;
const GRID_COLOR = 0x334466;
const GRID_OPACITY = 0.3;

// Distinct hue-cycling colors
const COLORS = [
  0xff6b4a, 0x4a9aff, 0xffd866, 0x4fb06f,
  0xaa66cc, 0xff9a4a, 0x6ad4e0, 0xd04a88,
];

const DRAW_DURATION = 1.8;   // seconds to reveal a new line

// ── State ────────────────────────────────────────────────
let group = null;
let axesGroup = null;
let active = false;
let sequences = [];   // { startValue, values, color, mesh, label, drawProgress }
let stepMax = 10;
let valueMax = 2;
let flipped = false;  // swap X/Y axes when true

// ── Public API ───────────────────────────────────────────
export function initTimeSeries(scene) {
  group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  axesGroup = new THREE.Group();
  group.add(axesGroup);

  rebuildAxes();
}

export function showTimeSeries() {
  if (group) group.visible = true;
  active = true;
}

export function hideTimeSeries() {
  if (group) group.visible = false;
  active = false;
}

export function isTimeSeriesActive() { return active; }

export function getTimeSeriesGroup() { return group; }

export function clearTimeSeries() {
  for (const seq of sequences) {
    if (seq.mesh) {
      group.remove(seq.mesh);
      seq.mesh.geometry.dispose();
      seq.mesh.material.dispose();
    }
    if (seq.label) {
      group.remove(seq.label);
      seq.label.material.map?.dispose();
      seq.label.material.dispose();
    }
  }
  sequences = [];
  stepMax = 10;
  valueMax = 2;
  rebuildAxes();
}

/**
 * Add a new Collatz sequence to the chart.
 */
export function addTimeSeriesNumber(n) {
  // Skip duplicates
  if (sequences.some(s => s.startValue === n)) return;

  const values = collatzValues(n);
  const color = COLORS[sequences.length % COLORS.length];

  const newStepMax = Math.max(stepMax, values.length - 1);
  let newValueMax = valueMax;
  for (const v of values) if (v > newValueMax) newValueMax = v;

  const rescale = (newStepMax > stepMax) || (newValueMax > valueMax);
  stepMax = newStepMax;
  valueMax = newValueMax;

  const seq = {
    startValue: n,
    values,
    color,
    mesh: null,
    label: null,
    drawProgress: 0,
  };
  sequences.push(seq);

  if (rescale) {
    rebuildAxes();
    for (const s of sequences) rebuildLineFor(s);
  } else {
    rebuildLineFor(seq);
  }
}

/**
 * Update the time series (called each frame).
 * Animates draw-in of newly added lines.
 */
export function updateTimeSeries(dt) {
  if (!active) return;

  for (const seq of sequences) {
    if (seq.drawProgress < 1) {
      seq.drawProgress = Math.min(1, seq.drawProgress + dt / DRAW_DURATION);
      updateLineReveal(seq);
    }
  }
}

/**
 * Suggested camera target for time series view.
 * Shifts center slightly so axis labels (which extend beyond the chart
 * on the left/bottom) are fully visible, and pulls back far enough
 * that the whole labeled chart fits on screen.
 */
export function getTimeSeriesCameraTarget() {
  // Center between chart box and label regions (labels go to -2.5 on both axes)
  const cx = CHART_WIDTH / 2 - 1.5;
  const cy = CHART_HEIGHT / 2 - 1;
  // Pull back enough to frame the chart + labels comfortably.
  // Chart is 24 wide × 14 tall + ~3 units of labels on left/bottom, so
  // effective bounds are ~27 × 18. FOV 55° needs distance ≈ (27/2)/tan(27.5°) ≈ 26
  // for the width; add padding.
  const dist = 28;
  return {
    center: new THREE.Vector3(cx, cy, 0),
    position: new THREE.Vector3(cx, cy, dist),
  };
}

// ── Internal: coordinate mapping ─────────────────────────
function positionFor(step, value) {
  const normStep = step / Math.max(stepMax, 1);
  const logV = Math.log2(Math.max(value, 1));
  const logMax = Math.log2(Math.max(valueMax, 2));
  const normValue = logV / logMax;
  if (flipped) {
    return new THREE.Vector3(normValue * CHART_WIDTH, normStep * CHART_HEIGHT, 0);
  }
  return new THREE.Vector3(normStep * CHART_WIDTH, normValue * CHART_HEIGHT, 0);
}

// ── Flip X/Y ────────────────────────────────────────────
export function toggleFlip() {
  flipped = !flipped;
  rebuildAxes();
  for (const seq of sequences) rebuildLineFor(seq);
}

export function isFlipped() { return flipped; }

// ── Visibility control for slider ───────────────────────
// Hard cap to prevent WebGL OOM on mobile. Each TubeGeometry line uses
// ~100-800KB of GPU memory depending on sequence length.
const MAX_TIME_SERIES_LINES = 300;

export function setVisibleMax(n) {
  const capped = Math.min(n, MAX_TIME_SERIES_LINES);
  // Ensure sequences exist for 2..capped
  for (let i = 2; i <= capped; i++) {
    if (!sequences.some(s => s.startValue === i)) {
      addTimeSeriesNumber(i);
    }
  }
  // Show/hide based on threshold
  for (const seq of sequences) {
    const visible = seq.startValue <= capped;
    if (seq.mesh) seq.mesh.visible = visible;
    if (seq.label) seq.label.visible = visible;
  }
}

// ── Internal: line rebuild ──────────────────────────────
function rebuildLineFor(seq) {
  if (seq.mesh) {
    group.remove(seq.mesh);
    seq.mesh.geometry.dispose();
    seq.mesh.material.dispose();
    seq.mesh = null;
  }
  if (seq.label) {
    group.remove(seq.label);
    seq.label.material.map?.dispose();
    seq.label.material.dispose();
    seq.label = null;
  }

  const points = seq.values.map((v, i) => positionFor(i, v));
  if (points.length < 2) return;

  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
  const segments = Math.min(Math.max(points.length * 2, 24), 300);
  const geo = new THREE.TubeGeometry(curve, segments, LINE_RADIUS, 4, false);

  // Start with the mesh fully hidden, reveal via drawRange
  geo.setDrawRange(0, Math.floor(seq.drawProgress * geo.index.count));

  const mat = new THREE.MeshBasicMaterial({
    color: seq.color,
    transparent: true,
    opacity: 0.9,
  });
  seq.mesh = new THREE.Mesh(geo, mat);
  group.add(seq.mesh);

  // Label at starting point (top-left of line)
  seq.label = makeChartLabel(String(seq.startValue), seq.color);
  const startPoint = points[0];
  seq.label.position.set(startPoint.x - 0.3, startPoint.y + 0.5, 0.1);
  group.add(seq.label);
}

function updateLineReveal(seq) {
  if (!seq.mesh) return;
  const totalIdx = seq.mesh.geometry.index.count;
  seq.mesh.geometry.setDrawRange(0, Math.floor(seq.drawProgress * totalIdx));
}

// ── Internal: axes + grid ───────────────────────────────
function rebuildAxes() {
  // Clear old axes
  while (axesGroup.children.length > 0) {
    const child = axesGroup.children[0];
    axesGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  }

  // Axes: X along bottom, Y along left
  const axisMat = new THREE.LineBasicMaterial({
    color: AXIS_COLOR, transparent: true, opacity: AXIS_OPACITY,
  });

  const xAxis = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(CHART_WIDTH, 0, 0),
  ]);
  axesGroup.add(new THREE.Line(xAxis, axisMat));

  const yAxis = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, CHART_HEIGHT, 0),
  ]);
  axesGroup.add(new THREE.Line(yAxis, axisMat));

  // What each axis represents depends on flipped state
  // NOT flipped: X = step, Y = log(value)
  //     flipped: X = log(value), Y = step
  const logMax = Math.log2(Math.max(valueMax, 2));
  let vStep = 1;
  if (logMax > 8) vStep = 2;
  if (logMax > 16) vStep = 4;

  const sInterval = niceInterval(stepMax);

  if (!flipped) {
    // X-axis: step ticks
    for (let s = 0; s <= stepMax; s += sInterval) {
      const x = (s / Math.max(stepMax, 1)) * CHART_WIDTH;
      axesGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, -0.2, 0)
        ]), axisMat));
      if (s > 0 || stepMax < 5) {
        const label = makeAxisLabel(String(s));
        label.position.set(x, -0.7, 0);
        axesGroup.add(label);
      }
    }
    // Y-axis: powers of 2
    for (let p = 0; p <= logMax; p += vStep) {
      const y = (p / logMax) * CHART_HEIGHT;
      const v = Math.pow(2, p);
      axesGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, y, 0), new THREE.Vector3(-0.2, y, 0)
        ]), axisMat));
      const label = makeAxisLabel(formatAxisValue(v));
      label.position.set(-1.2, y, 0);
      axesGroup.add(label);
      // Horizontal grid line
      const gridMat = new THREE.LineBasicMaterial({
        color: GRID_COLOR, transparent: true, opacity: GRID_OPACITY,
      });
      axesGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, y, 0), new THREE.Vector3(CHART_WIDTH, y, 0)
        ]), gridMat));
    }
  } else {
    // X-axis: powers of 2 (values)
    for (let p = 0; p <= logMax; p += vStep) {
      const x = (p / logMax) * CHART_WIDTH;
      const v = Math.pow(2, p);
      axesGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, -0.2, 0)
        ]), axisMat));
      const label = makeAxisLabel(formatAxisValue(v));
      label.position.set(x, -0.7, 0);
      axesGroup.add(label);
    }
    // Y-axis: steps
    for (let s = 0; s <= stepMax; s += sInterval) {
      const y = (s / Math.max(stepMax, 1)) * CHART_HEIGHT;
      axesGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, y, 0), new THREE.Vector3(-0.2, y, 0)
        ]), axisMat));
      if (s > 0 || stepMax < 5) {
        const label = makeAxisLabel(String(s));
        label.position.set(-1.2, y, 0);
        axesGroup.add(label);
      }
      // Horizontal grid line
      const gridMat = new THREE.LineBasicMaterial({
        color: GRID_COLOR, transparent: true, opacity: GRID_OPACITY,
      });
      axesGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, y, 0), new THREE.Vector3(CHART_WIDTH, y, 0)
        ]), gridMat));
    }
  }

  // Axis titles (swap labels when flipped)
  const xLabel = flipped ? 'value (log₂) →' : 'step →';
  const yLabel = flipped ? 'step' : 'value (log₂)';
  const xTitle = makeAxisLabel(xLabel, 0.6);
  xTitle.position.set(CHART_WIDTH / 2, -1.5, 0);
  axesGroup.add(xTitle);

  const yTitle = makeAxisLabel(yLabel, 0.6);
  yTitle.position.set(-2.2, CHART_HEIGHT / 2, 0);
  axesGroup.add(yTitle);
}

function niceInterval(maxSteps) {
  if (maxSteps <= 10) return 1;
  if (maxSteps <= 30) return 5;
  if (maxSteps <= 80) return 10;
  if (maxSteps <= 200) return 25;
  return 50;
}

function formatAxisValue(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(0) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k';
  return String(n);
}

// ── Internal: sprite labels ─────────────────────────────
function makeAxisLabel(text, scale = 0.5) {
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
  sprite.scale.set(scale * 4, scale, 1);
  sprite.renderOrder = 2;
  return sprite;
}

function makeChartLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const hex = '#' + color.toString(16).padStart(6, '0');
  ctx.fillStyle = hex;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px -apple-system, sans-serif';
  ctx.fillText(text, 10, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3, 0.75, 1);
  sprite.renderOrder = 3;
  return sprite;
}
