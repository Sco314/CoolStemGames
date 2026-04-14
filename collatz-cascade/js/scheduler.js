/**
 * Frame-budgeted work scheduler — inspired by Margaret Hamilton's
 * priority display system for Apollo. Each frame we process as much
 * queued work as we can in ~4ms, then yield to the renderer. If we
 * fall behind, work spills to the next frame instead of blowing up
 * the frame budget and freezing the browser.
 */

const BUDGET_MS = 4;            // per-frame time budget for background work
const queue = [];               // array of { fn, priority }
let running = false;

/**
 * Schedule a function to run when the frame has spare time.
 * Lower priority number = higher priority (runs first).
 */
export function schedule(fn, priority = 5) {
  queue.push({ fn, priority });
  queue.sort((a, b) => a.priority - b.priority);
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
}

/**
 * Schedule a batch of items. `items` is iterable; `work(item, index)`
 * is called for each with frame-budget awareness. Returns a promise
 * resolved when done. Use this to stage many mesh creations over
 * multiple frames.
 */
export function scheduleBatch(items, work, { priority = 5, onProgress } = {}) {
  return new Promise((resolve) => {
    const list = Array.from(items);
    let index = 0;

    function step() {
      const start = performance.now();
      while (index < list.length && performance.now() - start < BUDGET_MS) {
        work(list[index], index);
        index++;
      }
      if (onProgress) onProgress(index, list.length);
      if (index < list.length) {
        schedule(step, priority);
      } else {
        resolve();
      }
    }
    schedule(step, priority);
  });
}

function tick() {
  const start = performance.now();
  while (queue.length > 0 && performance.now() - start < BUDGET_MS) {
    const task = queue.shift();
    try {
      task.fn();
    } catch (e) {
      console.error('Scheduled task failed:', e);
    }
  }
  if (queue.length > 0) {
    requestAnimationFrame(tick);
  } else {
    running = false;
  }
}

/** Clear all pending scheduled work (used on Clear button). */
export function cancelAll() {
  queue.length = 0;
}

/** Current backlog size (for UI progress). */
export function pending() {
  return queue.length;
}
