// Preload.js — v0.1.0
// Prefetch every texture + audio file the game relies on, updating a
// DOM progress bar as each asset lands. The HTML elements live in index.html
// under #preload; Main.js hides the overlay once the returned promise resolves.
//
// We fetch each URL directly (cheap, lets the CDN warm its cache) — the
// actual Audio elements and THREE.TextureLoader instances will hit the
// browser cache when the game asks for them.

// Each preload entry is fetched via fetch() — failures are non-fatal and the
// progress bar still advances. .mp3 candidates are listed alongside .wav so
// the CDN cache is warm for whichever exists; Sound.js picks .mp3 first at
// runtime and falls back to .wav.
const ASSETS = [
  'textures/lander.png',
  'textures/particle.png',
  'audio/rocket.mp3', 'audio/rocket.wav',
  'audio/crash.mp3',  'audio/crash.wav',
  'audio/alarm.mp3',  'audio/alarm.wav',
  'audio/morse.mp3',  'audio/morse.wav',
  'audio/wind.mp3',   'audio/wind.wav'
];

export function preloadAssets() {
  const bar    = document.getElementById('preload-bar');
  const label  = document.getElementById('preload-label');
  const count  = document.getElementById('preload-count');
  const total  = ASSETS.length;
  let done = 0;

  if (count) count.textContent = `0 / ${total}`;

  const tasks = ASSETS.map(url =>
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .catch(err => {
        // Non-fatal — missing audio degrades to silence, missing texture
        // degrades to the texture loader's magenta placeholder. We still
        // want the progress bar to advance so boot isn't blocked.
        // .mp3 candidates are optional (companion to .wav) so we suppress
        // their warnings to keep the console quiet when only WAVs are present.
        if (!url.endsWith('.mp3')) {
          console.warn(`[preload] ${url} failed:`, err.message);
        }
      })
      .finally(() => {
        done += 1;
        if (bar)   bar.style.width = `${Math.round((done / total) * 100)}%`;
        if (count) count.textContent = `${done} / ${total}`;
        if (label) label.textContent = done < total ? 'LOADING…' : 'READY';
      })
  );

  return Promise.all(tasks);
}

export function hidePreloadOverlay() {
  const overlay = document.getElementById('preload');
  if (overlay) overlay.hidden = true;
}
