/**
 * Time Series mode: classic Collatz chart.
 * X-axis = step number, Y-axis = log2(value).
 * Each input number adds a colored line showing its trajectory.
 * Animated left-to-right draw-in as the line reveals.
 */

import * as THREE from 'three';
import { collatzValues } from './collatz.js';
import { log2 as bigLog2, valueKey, formatValue, isBig } from './valueUtils.js';
import { scheduleBatch } from './scheduler.js';

// ── Constants ────────────────────────────────────────────
const CHART_WIDTH = 24;
const CHART_HEIGHT = 14;
const LINE_RADIUS = 0.06;
const AXIS_COLOR = 0x667799;
const AXIS_OPACITY = 0.6;
const GRID_COLOR = 0x334466;
const GRID_OPACITY = 0.3;

// Max render points per line. Long sequences (e.g. 2000 steps) get
// downsampled to this many points — huge memory savings with no visible
// detail loss at typical viewing distance.
const MAX_RENDER_POINTS = 250;

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
let valueLogMax = 1;   // stored as log2(maxValue) so it works for BigInt too
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
  valueLogMax = 1;
  rebuildAxes();
}

// ── Batch mode ───────────────────────────────────────────
// During batch mode, addTimeSeriesNumber skips the O(N²) cascade rebuild
// of all existing lines. endBatch() does one final rebuild.
// Critical for fill operations — without this, fill to 800 triggers
// ~320,000 TubeGeometry creations and crashes the browser.
let inBatch = false;
let batchNeedsRebuild = false;

export function beginBatch() {
  inBatch = true;
  batchNeedsRebuild = false;
}

export function endBatch() {
  if (!inBatch) return;
  inBatch = false;
  const needsRebuild = batchNeedsRebuild;
  batchNeedsRebuild = false;

  if (needsRebuild) rebuildAxes();

  // Build the work list: rebuild everything if scale changed, else just
  // build deferred (mesh-less) lines. Stage the mesh creates across frames
  // via the frame-budgeted scheduler — a synchronous burst of 200+
  // TubeGeometry creates blocks the main thread for >2s on mobile and
  // gets the tab killed by the browser watchdog.
  const todo = needsRebuild
    ? sequences.slice()
    : sequences.filter(s => !s.mesh);
  if (todo.length === 0) return;

  scheduleBatch(todo, (s) => rebuildLineFor(s), { priority: 5 });
}

/**
 * Add a new Collatz sequence to the chart. Returns true if added,
 * false if already present.
 */
export function addTimeSeriesNumber(n) {
  const nKey = valueKey(n);
  if (sequences.some(s => valueKey(s.startValue) === nKey)) return false;

  const values = collatzValues(n);
  if (values.length < 2) return false;
  const color = COLORS[sequences.length % COLORS.length];

  const newStepMax = Math.max(stepMax, values.length - 1);
  let newValueLogMax = Math.max(valueLogMax, 1);
  for (const v of values) {
    const lg = bigLog2(v);
    if (Number.isFinite(lg) && lg > newValueLogMax) newValueLogMax = lg;
  }

  const rescale = (newStepMax > stepMax) || (newValueLogMax > valueLogMax);
  stepMax = newStepMax;
  valueLogMax = newValueLogMax;

  const seq = {
    startValue: n,
    values,
    color,
    mesh: null,
    label: null,
    drawProgress: 0,
  };
  sequences.push(seq);

  if (inBatch) {
    // Defer expensive work. Mark that a full rebuild is needed if
    // scale changed; else just note that this line needs creation.
    if (rescale) batchNeedsRebuild = true;
    // Don't create mesh yet if we'll rebuild everything at end.
    // But if no rescale, we could create now — even then, defer
    // to avoid interleaving mesh creates mid-batch (keep GPU allocs
    // lumped at end for cache coherency).
  } else {
    if (rescale) {
      rebuildAxes();
      for (const s of sequences) rebuildLineFor(s);
    } else {
      rebuildLineFor(seq);
    }
  }
  return true;
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
 * Distance adapts to aspect ratio so the chart fills both portrait
 * and landscape views without being cut off horizontally.
 */
export function getTimeSeriesCameraTarget(aspect = 1) {
  // Effective chart bounds including axis labels (~3 units extra on each negative side)
  const boundsW = CHART_WIDTH + 4;
  const boundsH = CHART_HEIGHT + 3;
  const cx = CHART_WIDTH / 2 - 1.5;
  const cy = CHART_HEIGHT / 2 - 1;

  // Distance needed so the bounds fit in the vertical FOV AND horizontal FOV
  const vFov = 55 * Math.PI / 180;
  const distByH = (boundsH / 2) / Math.tan(vFov / 2);
  const distByW = (boundsW / 2) / (Math.tan(vFov / 2) * Math.max(aspect, 0.3));
  const dist = Math.max(distByH, distByW) * 1.12;

  return {
    center: new THREE.Vector3(cx, cy, 0),
    position: new THREE.Vector3(cx, cy, dist),
  };
}

// ── Internal: coordinate mapping ─────────────────────────
function positionFor(step, value) {
  const normStep = step / Math.max(stepMax, 1);
  const logV = Math.max(0, bigLog2(value));
  const normValue = logV / Math.max(valueLogMax, 1);
  if (flipped) {
    return new THREE.Vector3(normValue * CHART_WIDTH, normStep * CHART_HEIGHT, 0);
  }
  return new THREE.Vector3(normStep * CHART_WIDTH, normValue * CHART_HEIGHT, 0);
}

/**
 * Downsample a sequence to at most MAX_RENDER_POINTS for rendering.
 * Always keeps the first and last points, plus peaks.
 */
function downsampleForRender(values) {
  if (values.length <= MAX_RENDER_POINTS) return values;
  const step = values.length / MAX_RENDER_POINTS;
  const out = [];
  for (let i = 0; i < MAX_RENDER_POINTS - 1; i++) {
    out.push(values[Math.floor(i * step)]);
  }
  out.push(values[values.length - 1]);
  return out;
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
const MAX_TIME_SERIES_LINES = 200;

export function setVisibleMax(n) {
  const capped = Math.min(n, MAX_TIME_SERIES_LINES);
  // Use batch mode so we don't rebuild all existing lines on every add
  beginBatch();
  for (let i = 2; i <= capped; i++) {
    const k = valueKey(i);
    if (!sequences.some(s => valueKey(s.startValue) === k)) {
      addTimeSeriesNumber(i);
    }
  }
  endBatch();
  // Show/hide based on threshold
  for (const seq of sequences) {
    const sv = typeof seq.startValue === 'bigint' ? Number(seq.startValue) : seq.startValue;
    const visible = sv <= capped;
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

  // Downsample long sequences for rendering (keeps original step indices
  // so X axis is still proportional to full sequence length).
  const total = seq.values.length;
  const renderCount = Math.min(total, MAX_RENDER_POINTS);
  const points = [];
  for (let i = 0; i < renderCount; i++) {
    const origIdx = total <= MAX_RENDER_POINTS
      ? i
      : Math.floor(i * (total - 1) / (renderCount - 1));
    points.push(positionFor(origIdx, seq.values[origIdx]));
  }
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
  seq.label = makeChartLabel(formatValue(seq.startValue), seq.color);
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
  const logMax = Math.max(valueLogMax, 1);
  let vStep = 1;
  if (logMax > 8) vStep = 2;
  if (logMax > 16) vStep = 4;
  if (logMax > 40) vStep = 8;
  if (logMax > 100) vStep = 20;

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
  if (n >= 1e15) return `2^${Math.round(Math.log2(n))}`;
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
