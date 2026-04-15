/**
 * Flat Chart mode: a raster-based sibling to Time Series.
 *
 * All lines are drawn onto a single offscreen 2D canvas with the
 * canvas-2D API, then uploaded as a CanvasTexture onto one
 * PlaneGeometry in the 3D scene. The camera can still orbit the
 * plane like any other mesh.
 *
 * Memory stays flat regardless of line count:
 *   2048 x 2048 RGBA = 16 MB VRAM, whether it has 10 lines or 5000.
 *   JS retains only { startValue, color } per line; sequence values
 *   are refetched via collatzValues() (shared-tail memoized in
 *   collatz.js) whenever axes rescale.
 *
 * Trade-offs vs Time Series (accepted for this mode):
 *   - Lines pixelate when zooming in past native resolution.
 *   - No per-line hover / tooltip.
 *   - No left-to-right draw-in reveal.
 */

import * as THREE from 'three';
import { collatzValues } from './collatz.js';
import { log2 as bigLog2, valueKey, formatValue } from './valueUtils.js';

// ── Constants ────────────────────────────────────────────
const CANVAS_SIZE = 2048;
const LEFT_MARGIN = 220;        // px on canvas reserved for Y labels
const BOTTOM_MARGIN = 200;      // px on canvas reserved for X labels
const TOP_PADDING = 40;
const RIGHT_PADDING = 40;

// Plane world dimensions — roughly match Time Series bounds so camera
// framing feels similar across modes.
const PLANE_W = 28;
const PLANE_H = 17;

// Max render points per line (same downsampling budget as Time Series).
const MAX_RENDER_POINTS = 250;

// Hard cap for the rubberband slider.
export const MAX_FLAT_CHART_LINES = 5000;

const COLORS = [
  0xff6b4a, 0x4a9aff, 0xffd866, 0x4fb06f,
  0xaa66cc, 0xff9a4a, 0x6ad4e0, 0xd04a88,
];

// ── State ────────────────────────────────────────────────
let group = null;
let plane = null;
let canvas = null;
let ctx = null;
let texture = null;
let active = false;
let flipped = false;
let stepMax = 10;
let valueLogMax = 1;
// Sequences are minimal: { startValue, color }. Values rehydrated via
// the shared-tail cache whenever we need to redraw.
let sequences = [];

// Batch mode: defer rescale + full redraw during multi-add flows.
let inBatch = false;
let batchNeedsFullRedraw = false;

// ── Public API ───────────────────────────────────────────
export function initFlatChart(scene) {
  group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  ctx = canvas.getContext('2d');

  texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const planeGeo = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
  const planeMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  plane = new THREE.Mesh(planeGeo, planeMat);
  group.add(plane);

  redrawAll();
}

export function showFlatChart() {
  if (group) group.visible = true;
  active = true;
}

export function hideFlatChart() {
  if (group) group.visible = false;
  active = false;
}

export function isFlatChartActive() { return active; }

export function getFlatChartGroup() { return group; }

export function clearFlatChart() {
  sequences = [];
  stepMax = 10;
  valueLogMax = 1;
  redrawAll();
}

/**
 * Called each frame. Nothing to animate — the canvas only changes on
 * explicit add / rescale / flip. Kept so main.js has a consistent
 * mode-update hook.
 */
export function updateFlatChart(_dt) {
  // No-op (future: fade-in new line, etc.).
}

// ── Batch mode ──────────────────────────────────────────
export function beginFlatChartBatch() {
  inBatch = true;
  batchNeedsFullRedraw = false;
}

export function endFlatChartBatch() {
  if (!inBatch) return;
  inBatch = false;
  const needsFull = batchNeedsFullRedraw;
  batchNeedsFullRedraw = false;
  if (needsFull) {
    redrawAll();
  } else {
    texture.needsUpdate = true;
  }
}

/**
 * Add a new sequence line. Returns true if added.
 */
export function addFlatChartNumber(n) {
  const nKey = valueKey(n);
  if (sequences.some(s => valueKey(s.startValue) === nKey)) return false;
  if (sequences.length >= MAX_FLAT_CHART_LINES) return false;

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

  const seq = { startValue: n, color };
  sequences.push(seq);

  if (inBatch) {
    if (rescale) {
      batchNeedsFullRedraw = true;
    } else {
      strokeOneLine(seq, values);
      // texture.needsUpdate deferred until endBatch
    }
  } else {
    if (rescale) {
      redrawAll();
    } else {
      strokeOneLine(seq, values);
      texture.needsUpdate = true;
    }
  }
  return true;
}

// ── Flip X/Y ────────────────────────────────────────────
export function toggleFlatChartFlip() {
  flipped = !flipped;
  redrawAll();
}

export function isFlatChartFlipped() { return flipped; }

// ── Visibility cap ──────────────────────────────────────
// Fills 2..capped (up to MAX_FLAT_CHART_LINES). Trimming the visible
// count by removing lines is NOT supported — flat chart is append-only
// within a session; the user can Clear to reset.
export function setFlatChartVisibleMax(n) {
  const capped = Math.min(n, MAX_FLAT_CHART_LINES);
  beginFlatChartBatch();
  for (let i = 2; i <= capped; i++) {
    const k = valueKey(i);
    if (!sequences.some(s => valueKey(s.startValue) === k)) {
      addFlatChartNumber(i);
    }
  }
  endFlatChartBatch();
}

// ── Camera framing ─────────────────────────────────────
export function getFlatChartCameraTarget(aspect = 1) {
  const vFov = 55 * Math.PI / 180;
  const distByH = (PLANE_H / 2) / Math.tan(vFov / 2);
  const distByW = (PLANE_W / 2) / (Math.tan(vFov / 2) * Math.max(aspect, 0.3));
  const dist = Math.max(distByH, distByW) * 1.12;
  return {
    center: new THREE.Vector3(0, 0, 0),
    position: new THREE.Vector3(0, 0, dist),
  };
}

// ── Internal: coordinate mapping ───────────────────────
function pxFor(step, value) {
  const chartW = CANVAS_SIZE - LEFT_MARGIN - RIGHT_PADDING;
  const chartH = CANVAS_SIZE - BOTTOM_MARGIN - TOP_PADDING;
  const normStep = step / Math.max(stepMax, 1);
  const logV = Math.max(0, bigLog2(value));
  const normVal = logV / Math.max(valueLogMax, 1);
  const left = LEFT_MARGIN;
  const bottom = CANVAS_SIZE - BOTTOM_MARGIN;
  if (flipped) {
    return {
      x: left + normVal * chartW,
      y: bottom - normStep * chartH,
    };
  }
  return {
    x: left + normStep * chartW,
    y: bottom - normVal * chartH,
  };
}

// ── Internal: stroke one sequence ──────────────────────
function strokeOneLine(seq, preloadedValues) {
  const values = preloadedValues || collatzValues(seq.startValue);
  if (!values || values.length < 2) return;

  const total = values.length;
  const renderCount = Math.min(total, MAX_RENDER_POINTS);
  const hex = '#' + seq.color.toString(16).padStart(6, '0');

  ctx.beginPath();
  ctx.strokeStyle = hex;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 0; i < renderCount; i++) {
    const origIdx = total <= MAX_RENDER_POINTS
      ? i
      : Math.floor(i * (total - 1) / (renderCount - 1));
    const p = pxFor(origIdx, values[origIdx]);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

// ── Internal: axes + grid ──────────────────────────────
function drawAxes() {
  // Background
  ctx.fillStyle = '#0a0f1e';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const logMax = Math.max(valueLogMax, 1);
  let vStep = 1;
  if (logMax > 8) vStep = 2;
  if (logMax > 16) vStep = 4;
  if (logMax > 40) vStep = 8;
  if (logMax > 100) vStep = 20;

  const sInterval = niceInterval(stepMax);
  const left = LEFT_MARGIN;
  const bottom = CANVAS_SIZE - BOTTOM_MARGIN;
  const chartW = CANVAS_SIZE - LEFT_MARGIN - RIGHT_PADDING;
  const chartH = CANVAS_SIZE - BOTTOM_MARGIN - TOP_PADDING;

  // Grid lines (horizontal at log2 ticks)
  ctx.strokeStyle = '#334466';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.3;
  if (!flipped) {
    for (let p = 0; p <= logMax; p += vStep) {
      const y = bottom - (p / logMax) * chartH;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + chartW, y);
      ctx.stroke();
    }
  } else {
    for (let s = 0; s <= stepMax; s += sInterval) {
      const y = bottom - (s / Math.max(stepMax, 1)) * chartH;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + chartW, y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Axis lines
  ctx.strokeStyle = '#667799';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, TOP_PADDING);
  ctx.lineTo(left, bottom);
  ctx.lineTo(CANVAS_SIZE - RIGHT_PADDING, bottom);
  ctx.stroke();

  // Ticks + numeric labels
  ctx.fillStyle = '#889abb';
  ctx.font = 'bold 32px -apple-system, sans-serif';

  if (!flipped) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let s = 0; s <= stepMax; s += sInterval) {
      const x = left + (s / Math.max(stepMax, 1)) * chartW;
      ctx.beginPath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, bottom + 12);
      ctx.stroke();
      if (s > 0 || stepMax < 5) ctx.fillText(String(s), x, bottom + 24);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let p = 0; p <= logMax; p += vStep) {
      const y = bottom - (p / logMax) * chartH;
      ctx.beginPath();
      ctx.moveTo(left - 12, y);
      ctx.lineTo(left, y);
      ctx.stroke();
      const v = Math.pow(2, p);
      ctx.fillText(formatAxisValue(v), left - 24, y);
    }
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let p = 0; p <= logMax; p += vStep) {
      const x = left + (p / logMax) * chartW;
      ctx.beginPath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, bottom + 12);
      ctx.stroke();
      const v = Math.pow(2, p);
      ctx.fillText(formatAxisValue(v), x, bottom + 24);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let s = 0; s <= stepMax; s += sInterval) {
      const y = bottom - (s / Math.max(stepMax, 1)) * chartH;
      ctx.beginPath();
      ctx.moveTo(left - 12, y);
      ctx.lineTo(left, y);
      ctx.stroke();
      if (s > 0 || stepMax < 5) ctx.fillText(String(s), left - 24, y);
    }
  }

  // Axis titles
  ctx.fillStyle = '#889abb';
  ctx.font = 'bold 36px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const xLabel = flipped ? 'value (log₂) →' : 'step →';
  ctx.fillText(xLabel, left + chartW / 2, CANVAS_SIZE - 60);

  ctx.save();
  ctx.translate(60, bottom - chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(flipped ? 'step' : 'value (log₂)', 0, 0);
  ctx.restore();
}

function redrawAll() {
  if (!ctx) return;
  drawAxes();
  for (const seq of sequences) {
    strokeOneLine(seq);
  }
  if (texture) texture.needsUpdate = true;
}

function niceInterval(maxSteps) {
  if (maxSteps <= 10) return 1;
  if (maxSteps <= 30) return 5;
  if (maxSteps <= 80) return 10;
  if (maxSteps <= 200) return 25;
  if (maxSteps <= 1000) return 100;
  return 500;
}

function formatAxisValue(n) {
  if (n >= 1e15) return `2^${Math.round(Math.log2(n))}`;
  if (n >= 1000000) return (n / 1000000).toFixed(0) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k';
  return String(n);
}
