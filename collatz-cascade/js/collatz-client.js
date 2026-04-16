/**
 * Main-thread proxy for the Collatz Web Worker.
 *
 * Provides:
 *   - computeSequenceAsync(n) → Promise<{ values, stoppingTime }>
 *   - streamFlatChartFill(lo, hi, opts) → streams ImageBitmap snapshots
 *   - addOneToChart(n) → draws a single number onto the worker canvas
 *   - cancelFill() → cancels an in-flight range fill
 *   - clearChart() → resets worker canvas + state
 *   - refitChart(opts) → re-draws from cache at correct axis scale
 *   - initCanvas(size) → initializes the OffscreenCanvas in the worker
 *   - isWorkerBusy() → true if a fill is in progress
 */

let worker = null;
let busy = false;

// Pending single-sequence promises, keyed by request id
let nextId = 0;
const pendingSequences = new Map();

// Current fill callbacks
let onSnapshot = null;
let onProgress = null;
let onComplete = null;

// Persistent snapshot handler — always called when any snapshot arrives
// (not just during fills). Set via registerSnapshotHandler.
let persistentSnapshotHandler = null;

function ensureWorker() {
  if (worker) return;
  worker = new Worker('./js/collatz-worker.js', { type: 'module' });
  worker.onmessage = handleMessage;
  worker.onerror = (e) => console.error('Collatz worker error:', e);
}

function handleMessage(e) {
  const { type } = e.data;

  if (type === 'sequence') {
    const { n, values, stoppingTime } = e.data;
    // Resolve all pending promises for this n
    for (const [id, entry] of pendingSequences) {
      if (String(entry.n) === String(n)) {
        entry.resolve({ values, stoppingTime });
        pendingSequences.delete(id);
      }
    }
  }

  else if (type === 'snapshot') {
    if (onSnapshot) onSnapshot(e.data.bitmap, e.data.drawn, e.data.total);
    else if (persistentSnapshotHandler) persistentSnapshotHandler(e.data.bitmap, e.data.drawn, e.data.total);
  }

  else if (type === 'progress') {
    if (onProgress) onProgress(e.data.drawn, e.data.total);
  }

  else if (type === 'rangeComplete') {
    busy = false;
    if (onComplete) onComplete(e.data);
    onSnapshot = null;
    onProgress = null;
    onComplete = null;
  }

  else if (type === 'rangeCancelled') {
    busy = false;
    if (onComplete) onComplete(e.data);
    onSnapshot = null;
    onProgress = null;
    onComplete = null;
  }
}

// ── Public API ──────────────────────────────────────────

export function initCanvas(canvasSize = 2048) {
  ensureWorker();
  worker.postMessage({ cmd: 'init', canvasSize });
}

export function computeSequenceAsync(n) {
  ensureWorker();
  const id = nextId++;
  return new Promise((resolve) => {
    pendingSequences.set(id, { n, resolve });
    worker.postMessage({ cmd: 'sequence', n });
  });
}

export function addOneToChart(n) {
  ensureWorker();
  worker.postMessage({ cmd: 'addOne', n });
}

export function streamFlatChartFill(lo, hi, {
  renderMode = 'strokes',
  flipped = false,
  onSnapshotCb,
  onProgressCb,
  onCompleteCb,
} = {}) {
  ensureWorker();
  busy = true;
  onSnapshot = onSnapshotCb || null;
  onProgress = onProgressCb || null;
  onComplete = onCompleteCb || null;
  worker.postMessage({ cmd: 'range', lo, hi, renderMode, flipped });
}

export function cancelFill() {
  if (worker) worker.postMessage({ cmd: 'cancel' });
  busy = false;
}

export function clearChart() {
  if (worker) worker.postMessage({ cmd: 'clear' });
  busy = false;
}

export function refitChart({ renderMode, flipped } = {}) {
  ensureWorker();
  busy = true;
  worker.postMessage({ cmd: 'refit', renderMode, flipped });
}

export function isWorkerBusy() {
  return busy;
}

export function registerSnapshotHandler(handler) {
  persistentSnapshotHandler = handler;
}
