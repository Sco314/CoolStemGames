/**
 * Flat Chart mode: uncapped raster chart via Web Worker.
 *
 * All heavy lifting (Collatz computation + line drawing) happens in
 * collatz-worker.js on an OffscreenCanvas. The main thread receives
 * ImageBitmap snapshots and blits them onto the Three.js CanvasTexture.
 * Memory is fixed (~16 MB texture) regardless of line count.
 *
 * Two render modes:
 *   'strokes'  — individual colored lines (noisy above ~10k)
 *   'heatmap'  — additive density with periodic normalization
 *
 * No artificial cap. Fill 1,000,000 if your CPU can handle it.
 */

import * as THREE from 'three';
import {
  initCanvas, streamFlatChartFill, addOneToChart,
  cancelFill, clearChart, refitChart, isWorkerBusy,
  registerSnapshotHandler,
} from './collatz-client.js';

// ── Constants ────────────────────────────────────────────
const CANVAS_SIZE = 2048;
const PLANE_W = 28;
const PLANE_H = 17;

// ── State ────────────────────────────────────────────────
let group = null;
let plane = null;
let canvas = null;
let ctx = null;
let texture = null;
let active = false;
let flipped = false;
let renderMode = 'strokes';   // 'strokes' | 'heatmap'
let lineCount = 0;
let maxFilledN = 0;           // highest N we've filled to

// ── Public API ───────────────────────────────────────────
export function initFlatChart(scene) {
  group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  ctx = canvas.getContext('2d');

  // Fill with dark background so the texture isn't blank
  ctx.fillStyle = '#0a0f1e';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

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

  // Initialize the worker's OffscreenCanvas
  initCanvas(CANVAS_SIZE);

  // Register a persistent snapshot handler so addOne/refit snapshots
  // always get blitted even when we're not in a streaming fill.
  registerSnapshotHandler((bitmap) => blitSnapshot(bitmap));
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

export function updateFlatChart(_dt) {
  // No per-frame work — snapshots arrive via worker messages.
}

// ── Fill (streaming via worker) ─────────────────────────
/**
 * Start a streaming fill from lo..hi. The worker computes + draws;
 * we receive periodic ImageBitmap snapshots and blit them.
 *
 * Returns callbacks: { onProgress, onComplete } are called internally.
 * The caller (ui.js) passes onProgressCb and onCompleteCb for UI updates.
 */
export function startStreamingFill(lo, hi, { onProgressCb, onCompleteCb } = {}) {
  maxFilledN = Math.max(maxFilledN, hi);

  streamFlatChartFill(lo, hi, {
    renderMode,
    flipped,
    onSnapshotCb: (bitmap, drawn, total) => {
      blitSnapshot(bitmap);
    },
    onProgressCb: (drawn, total) => {
      lineCount = drawn;
      if (onProgressCb) onProgressCb(drawn, total);
    },
    onCompleteCb: (data) => {
      lineCount = data.drawn || lineCount;
      if (onCompleteCb) onCompleteCb(data);
    },
  });
}

export function addFlatChartNumber(n) {
  addOneToChart(n);
  lineCount++;
  // The worker will send a snapshot after drawing
}

export function clearFlatChart() {
  clearChart();
  lineCount = 0;
  maxFilledN = 0;
  // Reset the main-thread canvas too
  if (ctx) {
    ctx.fillStyle = '#0a0f1e';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    texture.needsUpdate = true;
  }
}

export function abortFill() {
  cancelFill();
}

// ── Render mode toggle ──────────────────────────────────
export function setFlatChartRenderMode(mode) {
  if (mode !== 'strokes' && mode !== 'heatmap') return;
  renderMode = mode;
  // Re-stream from worker cache to redraw in new mode
  if (maxFilledN > 0) {
    refitChart({ renderMode, flipped });
  }
}

export function getFlatChartRenderMode() { return renderMode; }

// ── Flip X/Y ────────────────────────────────────────────
export function toggleFlatChartFlip() {
  flipped = !flipped;
  if (maxFilledN > 0) {
    refitChart({ renderMode, flipped });
  }
}

export function isFlatChartFlipped() { return flipped; }

// ── Refit (re-draw at corrected axis scale) ─────────────
export function refitFlatChart() {
  if (maxFilledN > 0) {
    refitChart({ renderMode, flipped });
  }
}

// ── Camera framing ──────────────────────────────────────
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

export function getFlatChartLineCount() { return lineCount; }

// ── Internal: blit a snapshot onto the Three.js canvas ──
function blitSnapshot(bitmap) {
  if (!ctx || !bitmap) return;
  ctx.drawImage(bitmap, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  bitmap.close();
  texture.needsUpdate = true;
}

