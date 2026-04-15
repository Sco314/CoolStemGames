/**
 * Time Series mode: classic Collatz chart.
 * X-axis = step number, Y-axis = log2(value).
 * Each input number adds a colored line showing its trajectory.
 *
 * Architecture: all lines share a single merged BufferGeometry +
 * LineSegments mesh. Replaces the old per-line TubeGeometry layout
 * which capped at 200 lines due to VRAM and draw-call overhead.
 * Wins from merging:
 *   - 1 draw call for all lines (was N)
 *   - No per-line Mesh / Material / Geometry wrappers
 *   - ~7 MB VRAM for 1000 lines (was ~50 MB for 200)
 */

import * as THREE from 'three';
import { collatzValues } from './collatz.js';
import { log2 as bigLog2, valueKey, formatValue } from './valueUtils.js';

// ── Constants ────────────────────────────────────────────
const CHART_WIDTH = 24;
const CHART_HEIGHT = 14;
const AXIS_COLOR = 0x667799;
const AXIS_OPACITY = 0.6;
const GRID_COLOR = 0x334466;
const GRID_OPACITY = 0.3;

// Max render points per line. Long sequences get downsampled to this many.
const MAX_RENDER_POINTS = 250;
// Vertices per slot in the merged buffer. LineSegments wants each
// segment as its own vertex pair, so a polyline of N points needs
// 2·(N−1) vertices.
const VERTS_PER_SLOT = 2 * (MAX_RENDER_POINTS - 1);  // 498

// Hard cap for rubberband slider. Pre-allocates the merged buffer.
export const MAX_TIME_SERIES_LINES = 1000;
const TOTAL_VERTS = MAX_TIME_SERIES_LINES * VERTS_PER_SLOT;

const COLORS = [
  0xff6b4a, 0x4a9aff, 0xffd866, 0x4fb06f,
  0xaa66cc, 0xff9a4a, 0x6ad4e0, 0xd04a88,
];

const DRAW_DURATION = 1.8;   // seconds to fade in a new line

// ── State ────────────────────────────────────────────────
let group = null;
let axesGroup = null;
let active = false;
// Each seq: { startValue, values, color, colorObj, label, drawProgress,
//             visible, vertexStart, vertexCount }
let sequences = [];
let stepMax = 10;
let valueLogMax = 1;
let flipped = false;

// Merged-buffer state
let mergedMesh = null;
let mergedGeo = null;
let posArray = null;   // Float32Array, TOTAL_VERTS * 3
let colArray = null;   // Float32Array, TOTAL_VERTS * 4 (RGBA)
let nextFreeVertex = 0;

// Batch mode: during fill, defer axis rebuild + buffer commit
let inBatch = false;
let batchNeedsRebuild = false;

// ── Public API ───────────────────────────────────────────
export function initTimeSeries(scene) {
  group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  axesGroup = new THREE.Group();
  group.add(axesGroup);

  posArray = new Float32Array(TOTAL_VERTS * 3);
  colArray = new Float32Array(TOTAL_VERTS * 4);

  mergedGeo = new THREE.BufferGeometry();
  mergedGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  mergedGeo.setAttribute('color', new THREE.BufferAttribute(colArray, 4));
  mergedGeo.setDrawRange(0, 0);

  const mergedMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
  });
  mergedMesh = new THREE.LineSegments(mergedGeo, mergedMat);
  group.add(mergedMesh);

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
    if (seq.label) {
      group.remove(seq.label);
      seq.label.material.map?.dispose();
      seq.label.material.dispose();
    }
  }
  sequences = [];
  nextFreeVertex = 0;
  stepMax = 10;
  valueLogMax = 1;
  if (mergedGeo) {
    mergedGeo.setDrawRange(0, 0);
    // Zero out the alpha channel for cleanliness (positions don't
    // matter since drawRange is 0).
    for (let i = 3; i < colArray.length; i += 4) colArray[i] = 0;
    mergedGeo.attributes.color.needsUpdate = true;
  }
  rebuildAxes();
}

// ── Batch mode ───────────────────────────────────────────
// During batch, writes are deferred. endBatch() does one buffer commit.
export function beginBatch() {
  inBatch = true;
  batchNeedsRebuild = false;
}

export function endBatch() {
  if (!inBatch) return;
  inBatch = false;
  const needsRebuild = batchNeedsRebuild;
  batchNeedsRebuild = false;

  if (needsRebuild) {
    rebuildAxes();
    rewriteAllSlots();
  } else {
    // Only newly-added slots were deferred; write them now.
    for (const seq of sequences) {
      if (seq.vertexStart < 0) writeSlotFor(seq);
    }
    commitBufferChanges();
  }
  // Ensure labels for any new sequences
  for (const seq of sequences) {
    if (!seq.label) ensureLabel(seq);
  }
}

/**
 * Add a new Collatz sequence. Returns true if added, false if already
 * present or at capacity.
 */
export function addTimeSeriesNumber(n) {
  const nKey = valueKey(n);
  if (sequences.some(s => valueKey(s.startValue) === nKey)) return false;
  if (sequences.length >= MAX_TIME_SERIES_LINES) return false;

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
    colorObj: new THREE.Color(color),
    label: null,
    drawProgress: 0,
    visible: true,
    vertexStart: -1,
    vertexCount: 0,
  };
  sequences.push(seq);

  if (inBatch) {
    if (rescale) batchNeedsRebuild = true;
    // writeSlotFor deferred until endBatch()
  } else {
    if (rescale) {
      rebuildAxes();
      rewriteAllSlots();
    } else {
      writeSlotFor(seq);
      commitBufferChanges();
    }
    ensureLabel(seq);
  }
  return true;
}

/**
 * Per-frame update: advance fade-in for newly-added lines by writing
 * alpha into the shared color buffer.
 */
export function updateTimeSeries(dt) {
  if (!active) return;

  let anyChange = false;
  for (const seq of sequences) {
    if (seq.drawProgress < 1) {
      seq.drawProgress = Math.min(1, seq.drawProgress + dt / DRAW_DURATION);
      const alpha = seq.visible ? easeInOut(seq.drawProgress) : 0;
      setSlotAlpha(seq, alpha);
      anyChange = true;
    }
  }
  if (anyChange) {
    mergedGeo.attributes.color.needsUpdate = true;
  }
}

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Suggested camera target for time series view.
 * Distance adapts to aspect ratio so the chart fills both portrait and
 * landscape views without being cut off horizontally.
 */
export function getTimeSeriesCameraTarget(aspect = 1) {
  const boundsW = CHART_WIDTH + 4;
  const boundsH = CHART_HEIGHT + 3;
  const cx = CHART_WIDTH / 2 - 1.5;
  const cy = CHART_HEIGHT / 2 - 1;

  const vFov = 55 * Math.PI / 180;
  const distByH = (boundsH / 2) / Math.tan(vFov / 2);
  const distByW = (boundsW / 2) / (Math.tan(vFov / 2) * Math.max(aspect, 0.3));
  const dist = Math.max(distByH, distByW) * 1.12;

  return {
    center: new THREE.Vector3(cx, cy, 0),
    position: new THREE.Vector3(cx, cy, dist),
  };
}

// ── Flip X/Y ────────────────────────────────────────────
export function toggleFlip() {
  flipped = !flipped;
  rebuildAxes();
  rewriteAllSlots();
  // Re-position labels (their positions depend on axes)
  for (const seq of sequences) {
    if (seq.label) {
      group.remove(seq.label);
      seq.label.material.map?.dispose();
      seq.label.material.dispose();
      seq.label = null;
    }
    ensureLabel(seq);
  }
}

export function isFlipped() { return flipped; }

// ── Visibility slider ──────────────────────────────────
export function setVisibleMax(n) {
  const capped = Math.min(n, MAX_TIME_SERIES_LINES);
  beginBatch();
  for (let i = 2; i <= capped; i++) {
    const k = valueKey(i);
    if (!sequences.some(s => valueKey(s.startValue) === k)) {
      addTimeSeriesNumber(i);
    }
  }
  endBatch();
  // Toggle per-seq visibility based on start value threshold
  let changed = false;
  for (const seq of sequences) {
    const sv = typeof seq.startValue === 'bigint' ? Number(seq.startValue) : seq.startValue;
    const shouldShow = sv <= capped;
    if (seq.visible !== shouldShow) {
      seq.visible = shouldShow;
      setSlotAlpha(seq, shouldShow ? easeInOut(seq.drawProgress) : 0);
      if (seq.label) seq.label.visible = shouldShow;
      changed = true;
    }
  }
  if (changed) mergedGeo.attributes.color.needsUpdate = true;
}

// ── Internal: coordinate mapping ─────────────────────────
function positionFor(step, value) {
  const normStep = step / Math.max(stepMax, 1);
  const logV = Math.max(0, bigLog2(value));
  const normValue = logV / Math.max(valueLogMax, 1);
  if (flipped) {
    return { x: normValue * CHART_WIDTH, y: normStep * CHART_HEIGHT, z: 0 };
  }
  return { x: normStep * CHART_WIDTH, y: normValue * CHART_HEIGHT, z: 0 };
}

// ── Internal: merged-buffer slot management ─────────────
function writeSlotFor(seq) {
  const total = seq.values.length;
  const renderCount = Math.min(total, MAX_RENDER_POINTS);
  if (renderCount < 2) {
    seq.vertexStart = -1;
    seq.vertexCount = 0;
    return;
  }
  const lineVerts = 2 * (renderCount - 1);

  if (seq.vertexStart < 0) {
    if (nextFreeVertex + lineVerts > TOTAL_VERTS) return;
    seq.vertexStart = nextFreeVertex;
    seq.vertexCount = lineVerts;
    nextFreeVertex += lineVerts;
  }

  const r = seq.colorObj.r, g = seq.colorObj.g, b = seq.colorObj.b;
  const alpha = seq.visible ? easeInOut(seq.drawProgress) : 0;

  let vi = seq.vertexStart;
  let prev = downsampledPoint(seq.values, 0, renderCount, total);
  for (let i = 1; i < renderCount; i++) {
    const cur = downsampledPoint(seq.values, i, renderCount, total);
    // Segment: (prev, cur)
    const p3 = vi * 3, c4 = vi * 4;
    posArray[p3] = prev.x; posArray[p3 + 1] = prev.y; posArray[p3 + 2] = prev.z;
    colArray[c4] = r; colArray[c4 + 1] = g; colArray[c4 + 2] = b; colArray[c4 + 3] = alpha;
    vi++;
    const p3b = vi * 3, c4b = vi * 4;
    posArray[p3b] = cur.x; posArray[p3b + 1] = cur.y; posArray[p3b + 2] = cur.z;
    colArray[c4b] = r; colArray[c4b + 1] = g; colArray[c4b + 2] = b; colArray[c4b + 3] = alpha;
    vi++;
    prev = cur;
  }
}

function downsampledPoint(values, i, renderCount, total) {
  const origIdx = total <= MAX_RENDER_POINTS
    ? i
    : Math.floor(i * (total - 1) / (renderCount - 1));
  return positionFor(origIdx, values[origIdx]);
}

function setSlotAlpha(seq, alpha) {
  if (seq.vertexStart < 0) return;
  const end = seq.vertexStart + seq.vertexCount;
  for (let vi = seq.vertexStart; vi < end; vi++) {
    colArray[vi * 4 + 3] = alpha;
  }
}

/**
 * Rebuild the whole buffer from sequences[]. Used on rescale and flip.
 * Resets the allocator and packs active sequences contiguously.
 */
function rewriteAllSlots() {
  nextFreeVertex = 0;
  for (const seq of sequences) {
    seq.vertexStart = -1;
    seq.vertexCount = 0;
    writeSlotFor(seq);
  }
  commitBufferChanges();
}

function commitBufferChanges() {
  mergedGeo.attributes.position.needsUpdate = true;
  mergedGeo.attributes.color.needsUpdate = true;
  mergedGeo.setDrawRange(0, nextFreeVertex);
  mergedGeo.computeBoundingSphere();
}

// ── Label sprites ───────────────────────────────────────
function ensureLabel(seq) {
  if (seq.label) return;
  if (seq.values.length < 1) return;
  const sp = positionFor(0, seq.values[0]);
  seq.label = makeChartLabel(formatValue(seq.startValue), seq.color);
  seq.label.position.set(sp.x - 0.3, sp.y + 0.5, 0.1);
  group.add(seq.label);
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

// ── Axes + grid ────────────────────────────────────────
function rebuildAxes() {
  while (axesGroup.children.length > 0) {
    const child = axesGroup.children[0];
    axesGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  }

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

  const logMax = Math.max(valueLogMax, 1);
  let vStep = 1;
  if (logMax > 8) vStep = 2;
  if (logMax > 16) vStep = 4;
  if (logMax > 40) vStep = 8;
  if (logMax > 100) vStep = 20;

  const sInterval = niceInterval(stepMax);

  if (!flipped) {
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
      const gridMat = new THREE.LineBasicMaterial({
        color: GRID_COLOR, transparent: true, opacity: GRID_OPACITY,
      });
      axesGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, y, 0), new THREE.Vector3(CHART_WIDTH, y, 0)
        ]), gridMat));
    }
  } else {
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
      const gridMat = new THREE.LineBasicMaterial({
        color: GRID_COLOR, transparent: true, opacity: GRID_OPACITY,
      });
      axesGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, y, 0), new THREE.Vector3(CHART_WIDTH, y, 0)
        ]), gridMat));
    }
  }

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
