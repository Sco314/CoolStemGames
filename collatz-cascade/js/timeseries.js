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
 */
export function getTimeSeriesCameraTarget() {
  const cx = CHART_WIDTH / 2;
  const cy = CHART_HEIGHT / 2;
  return {
    center: new THREE.Vector3(cx, cy, 0),
    position: new THREE.Vector3(cx, cy, CHART_WIDTH * 1.1),
  };
}

// ── Internal: coordinate mapping ─────────────────────────
function positionFor(step, value) {
  const x = (step / Math.max(stepMax, 1)) * CHART_WIDTH;
  const logV = Math.log2(Math.max(value, 1));
  const logMax = Math.log2(Math.max(valueMax, 2));
  const y = (logV / logMax) * CHART_HEIGHT;
  return new THREE.Vector3(x, y, 0);
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
  const segments = Math.max(points.length * 3, 32);
  const geo = new THREE.TubeGeometry(curve, segments, LINE_RADIUS, 8, false);

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

  // X-axis labels at major step intervals
  const xInterval = niceInterval(stepMax);
  for (let s = 0; s <= stepMax; s += xInterval) {
    const x = (s / Math.max(stepMax, 1)) * CHART_WIDTH;
    // Tick
    const tickGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0, 0),
      new THREE.Vector3(x, -0.2, 0),
    ]);
    axesGroup.add(new THREE.Line(tickGeo, axisMat));
    // Label
    if (s > 0 || stepMax < 5) {
      const label = makeAxisLabel(String(s));
      label.position.set(x, -0.7, 0);
      axesGroup.add(label);
    }
  }

  // Y-axis labels at powers of 2
  const logMax = Math.log2(Math.max(valueMax, 2));
  let yStep = 1;
  if (logMax > 8) yStep = 2;
  if (logMax > 16) yStep = 4;
  for (let p = 0; p <= logMax; p += yStep) {
    const y = (p / logMax) * CHART_HEIGHT;
    const v = Math.pow(2, p);
    // Tick
    const tickGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, y, 0),
      new THREE.Vector3(-0.2, y, 0),
    ]);
    axesGroup.add(new THREE.Line(tickGeo, axisMat));
    // Label
    const label = makeAxisLabel(formatAxisValue(v));
    label.position.set(-1.2, y, 0);
    axesGroup.add(label);

    // Grid line
    const gridGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, y, 0),
      new THREE.Vector3(CHART_WIDTH, y, 0),
    ]);
    const gridMat = new THREE.LineBasicMaterial({
      color: GRID_COLOR, transparent: true, opacity: GRID_OPACITY,
    });
    axesGroup.add(new THREE.Line(gridGeo, gridMat));
  }

  // Axis titles
  const xTitle = makeAxisLabel('step →', 0.6);
  xTitle.position.set(CHART_WIDTH / 2, -1.5, 0);
  axesGroup.add(xTitle);

  const yTitle = makeAxisLabel('value (log₂)', 0.6);
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
