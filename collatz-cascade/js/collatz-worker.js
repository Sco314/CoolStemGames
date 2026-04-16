/**
 * Web Worker for off-thread Collatz computation + rendering.
 *
 * Two modes:
 *   1. Pure compute: returns full sequence arrays (for Time Series,
 *      Number Line, etc.).
 *   2. Draw: computes sequences AND draws them onto an OffscreenCanvas,
 *      periodically sending ImageBitmap snapshots back (for Flat Chart
 *      fills where transferring millions of values would be too expensive).
 *
 * The worker maintains its own shared-tail Collatz cache. For range
 * fills this cache grows with unique intermediate values; for re-fits
 * (re-drawing at corrected axis scale) it means re-walking cached
 * sequences is nearly free.
 */

import { isBig, isEven, isOne, nextCollatz, valueKey, toValue } from './valueUtils.js';
import { collatzValues, stoppingTime } from './collatz.js';
import { log2 } from './valueUtils.js';

// ── Canvas state (draw mode) ────────────────────────────
let offscreen = null;
let ctx = null;
let canvasSize = 2048;
const LEFT_MARGIN = 220;
const BOTTOM_MARGIN = 200;
const TOP_PADDING = 40;
const RIGHT_PADDING = 40;

// ── Axis state ──────────────────────────────────────────
let stepMax = 10;
let valueLogMax = 1;
let flipped = false;

// ── Render state ────────────────────────────────────────
let renderMode = 'strokes';
let cancelled = false;
let addedKeys = new Set();
let addedList = [];    // ordered list of { n, color } for refit

const COLORS = [
  '#ff6b4a', '#4a9aff', '#ffd866', '#4fb06f',
  '#aa66cc', '#ff9a4a', '#6ad4e0', '#d04a88',
];
let colorIndex = 0;

// ── Heat-map state ──────────────────────────────────────
let heatmapLinesDrawn = 0;
const NORMALIZE_INTERVAL = 500;

// ── Message handler ─────────────────────────────────────
self.onmessage = function (e) {
  const { cmd } = e.data;

  if (cmd === 'init') {
    canvasSize = e.data.canvasSize || 2048;
    offscreen = new OffscreenCanvas(canvasSize, canvasSize);
    ctx = offscreen.getContext('2d');
    clearCanvas();
    sendSnapshot(0, 0);
  }

  else if (cmd === 'sequence') {
    const n = toValue(e.data.n);
    if (n == null) { self.postMessage({ type: 'sequence', n: e.data.n, values: [], stoppingTime: 0 }); return; }
    const values = collatzValues(n);
    const st = values.length - 1;
    self.postMessage({ type: 'sequence', n: e.data.n, values, stoppingTime: st });
  }

  else if (cmd === 'range') {
    cancelled = false;
    renderMode = e.data.renderMode || 'strokes';
    flipped = e.data.flipped ?? flipped;
    drawRange(e.data.lo, e.data.hi);
  }

  else if (cmd === 'cancel') {
    cancelled = true;
  }

  else if (cmd === 'clear') {
    addedKeys.clear();
    addedList = [];
    colorIndex = 0;
    stepMax = 10;
    valueLogMax = 1;
    if (ctx) {
      clearCanvas();
      sendSnapshot(0, 0);
    }
  }

  else if (cmd === 'refit') {
    renderMode = e.data.renderMode ?? renderMode;
    flipped = e.data.flipped ?? flipped;
    redrawAll();
  }

  else if (cmd === 'addOne') {
    const n = toValue(e.data.n);
    if (n == null) return;
    const key = valueKey(n);
    if (addedKeys.has(key)) return;
    const color = COLORS[colorIndex % COLORS.length];
    colorIndex++;
    addedKeys.add(key);
    addedList.push({ n, color });
    const grew = walkAndDraw(n, color);
    if (grew && ctx) {
      redrawAll();
    } else if (ctx) {
      sendSnapshot(addedList.length, addedList.length);
    }
  }
};

// ── Range fill ──────────────────────────────────────────
function drawRange(lo, hi) {
  if (!ctx) return;
  const total = hi - lo + 1;
  let drawn = 0;

  if (renderMode === 'heatmap') {
    setupHeatmap();
  }

  for (let i = lo; i <= hi; i++) {
    if (cancelled) break;
    const key = String(i);
    if (addedKeys.has(key)) { drawn++; continue; }
    addedKeys.add(key);
    const color = COLORS[colorIndex % COLORS.length];
    colorIndex++;
    addedList.push({ n: i, color });

    walkAndDraw(i, color);
    drawn++;

    if (renderMode === 'heatmap') {
      heatmapLinesDrawn++;
      if (heatmapLinesDrawn % NORMALIZE_INTERVAL === 0) normalizeHeatmap();
    }

    if (drawn % 500 === 0) {
      sendSnapshot(drawn, total);
      self.postMessage({ type: 'progress', drawn, total });
    }
  }

  if (renderMode === 'heatmap') {
    normalizeHeatmap();
    teardownHeatmap();
  }

  sendSnapshot(drawn, total);
  self.postMessage({
    type: 'rangeComplete', lo, hi, drawn,
    stepMax, valueLogMax, needsRescale: false,
  });
}

// ── Walk one sequence + draw ─────────────────────────────
function walkAndDraw(n, color) {
  let current = typeof n === 'number' ? n : toValue(n);
  if (current == null) return false;

  let step = 0;
  let localStepMax = 0;
  let localValueLogMax = 0;

  // Collect downsampled points: walk the full sequence but only
  // record up to MAX_POINTS evenly-spaced samples.
  const MAX_POINTS = 250;
  const MAX_ITER = 500000;

  // First pass: determine length (use cached collatzValues if available,
  // else walk manually).
  const values = collatzValues(current);
  const seqLen = values.length;
  localStepMax = seqLen - 1;

  // Find peak log2 value
  for (const v of values) {
    const lg = log2(v);
    if (Number.isFinite(lg) && lg > localValueLogMax) localValueLogMax = lg;
  }

  // Check if axes need to grow
  let grew = false;
  if (localStepMax > stepMax) { stepMax = localStepMax; grew = true; }
  if (localValueLogMax > valueLogMax) { valueLogMax = localValueLogMax; grew = true; }

  // Downsample + draw
  const renderCount = Math.min(seqLen, MAX_POINTS);
  ctx.beginPath();
  ctx.strokeStyle = renderMode === 'heatmap' ? 'rgba(255,180,100,0.04)' : color;
  ctx.lineWidth = renderMode === 'heatmap' ? 1.5 : 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 0; i < renderCount; i++) {
    const origIdx = seqLen <= MAX_POINTS
      ? i
      : Math.floor(i * (seqLen - 1) / (renderCount - 1));
    const p = pxFor(origIdx, values[origIdx]);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  return grew;
}

// ── Redraw everything from stored addedList ──────────────
function redrawAll() {
  if (!ctx) return;
  clearCanvas();
  drawAxes();

  if (renderMode === 'heatmap') setupHeatmap();

  heatmapLinesDrawn = 0;
  for (const entry of addedList) {
    walkAndDrawCached(entry.n, entry.color);
    if (renderMode === 'heatmap') {
      heatmapLinesDrawn++;
      if (heatmapLinesDrawn % NORMALIZE_INTERVAL === 0) normalizeHeatmap();
    }
  }

  if (renderMode === 'heatmap') {
    normalizeHeatmap();
    teardownHeatmap();
  }

  sendSnapshot(addedList.length, addedList.length);
}

function walkAndDrawCached(n, color) {
  const values = collatzValues(n);
  if (values.length < 2) return;
  const seqLen = values.length;
  const renderCount = Math.min(seqLen, 250);

  ctx.beginPath();
  ctx.strokeStyle = renderMode === 'heatmap' ? 'rgba(255,180,100,0.04)' : color;
  ctx.lineWidth = renderMode === 'heatmap' ? 1.5 : 2;

  for (let i = 0; i < renderCount; i++) {
    const origIdx = seqLen <= 250
      ? i
      : Math.floor(i * (seqLen - 1) / (renderCount - 1));
    const p = pxFor(origIdx, values[origIdx]);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

// ── Coordinate mapping ──────────────────────────────────
function pxFor(step, value) {
  const chartW = canvasSize - LEFT_MARGIN - RIGHT_PADDING;
  const chartH = canvasSize - BOTTOM_MARGIN - TOP_PADDING;
  const normStep = step / Math.max(stepMax, 1);
  const logV = Math.max(0, log2(value));
  const normVal = logV / Math.max(valueLogMax, 1);
  const left = LEFT_MARGIN;
  const bottom = canvasSize - BOTTOM_MARGIN;
  if (flipped) {
    return { x: left + normVal * chartW, y: bottom - normStep * chartH };
  }
  return { x: left + normStep * chartW, y: bottom - normVal * chartH };
}

// ── Canvas helpers ──────────────────────────────────────
function clearCanvas() {
  if (!ctx) return;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#0a0f1e';
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  drawAxes();
}

function drawAxes() {
  if (!ctx) return;
  const logMax = Math.max(valueLogMax, 1);
  let vStep = 1;
  if (logMax > 8) vStep = 2;
  if (logMax > 16) vStep = 4;
  if (logMax > 40) vStep = 8;
  if (logMax > 100) vStep = 20;

  const sInterval = niceInterval(stepMax);
  const left = LEFT_MARGIN;
  const bottom = canvasSize - BOTTOM_MARGIN;
  const chartW = canvasSize - LEFT_MARGIN - RIGHT_PADDING;
  const chartH = canvasSize - BOTTOM_MARGIN - TOP_PADDING;

  // Grid
  ctx.strokeStyle = '#334466';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.3;
  if (!flipped) {
    for (let p = 0; p <= logMax; p += vStep) {
      const y = bottom - (p / logMax) * chartH;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + chartW, y); ctx.stroke();
    }
  } else {
    for (let s = 0; s <= stepMax; s += sInterval) {
      const y = bottom - (s / Math.max(stepMax, 1)) * chartH;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + chartW, y); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Axis lines
  ctx.strokeStyle = '#667799';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, TOP_PADDING);
  ctx.lineTo(left, bottom);
  ctx.lineTo(canvasSize - RIGHT_PADDING, bottom);
  ctx.stroke();

  // Tick labels
  ctx.fillStyle = '#889abb';
  ctx.font = 'bold 32px sans-serif';

  if (!flipped) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let s = 0; s <= stepMax; s += sInterval) {
      const x = left + (s / Math.max(stepMax, 1)) * chartW;
      if (s > 0 || stepMax < 5) ctx.fillText(String(s), x, bottom + 24);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let p = 0; p <= logMax; p += vStep) {
      const y = bottom - (p / logMax) * chartH;
      ctx.fillText(fmtAxis(Math.pow(2, p)), left - 24, y);
    }
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let p = 0; p <= logMax; p += vStep) {
      const x = left + (p / logMax) * chartW;
      ctx.fillText(fmtAxis(Math.pow(2, p)), x, bottom + 24);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let s = 0; s <= stepMax; s += sInterval) {
      const y = bottom - (s / Math.max(stepMax, 1)) * chartH;
      if (s > 0 || stepMax < 5) ctx.fillText(String(s), left - 24, y);
    }
  }

  // Axis titles
  ctx.fillStyle = '#889abb';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(flipped ? 'value (log₂) →' : 'step →', left + chartW / 2, canvasSize - 60);
  ctx.save();
  ctx.translate(60, bottom - chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(flipped ? 'step' : 'value (log₂)', 0, 0);
  ctx.restore();
}

function niceInterval(max) {
  if (max <= 10) return 1;
  if (max <= 30) return 5;
  if (max <= 80) return 10;
  if (max <= 200) return 25;
  if (max <= 1000) return 100;
  return 500;
}

function fmtAxis(n) {
  if (n >= 1e15) return '2^' + Math.round(Math.log2(n));
  if (n >= 1e6) return (n / 1e6).toFixed(0) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}

// ── Heat-map helpers ────────────────────────────────────
function setupHeatmap() {
  ctx.globalCompositeOperation = 'lighter';
  heatmapLinesDrawn = 0;
}

function teardownHeatmap() {
  ctx.globalCompositeOperation = 'source-over';
}

function normalizeHeatmap() {
  if (!ctx) return;
  const imgData = ctx.getImageData(LEFT_MARGIN, TOP_PADDING,
    canvasSize - LEFT_MARGIN - RIGHT_PADDING,
    canvasSize - BOTTOM_MARGIN - TOP_PADDING);
  const d = imgData.data;
  let maxVal = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(d[i], d[i + 1], d[i + 2]);
    if (v > maxVal) maxVal = v;
  }
  if (maxVal > 200) {
    const scale = 100 / maxVal;
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = Math.round(d[i] * scale);
      d[i + 1] = Math.round(d[i + 1] * scale);
      d[i + 2] = Math.round(d[i + 2] * scale);
    }
    ctx.putImageData(imgData, LEFT_MARGIN, TOP_PADDING);
  }
}

// ── Snapshot transfer ───────────────────────────────────
// createImageBitmap copies the canvas (non-destructive) so we can
// keep drawing on top between snapshots. The bitmap is transferred
// (zero-copy) to the main thread via postMessage.
function sendSnapshot(drawn, total) {
  if (!offscreen) return;
  createImageBitmap(offscreen).then(bitmap => {
    self.postMessage({ type: 'snapshot', bitmap, drawn, total }, [bitmap]);
  });
}
