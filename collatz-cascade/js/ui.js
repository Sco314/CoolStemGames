/**
 * DOM overlay: input handling, recent inputs panel, tooltips, legend.
 */

import * as THREE from 'three';
import { stoppingTime } from './collatz.js';
import { parseValueExpression, isBig, formatValue as fmtValue, SAFE_MAX } from './valueUtils.js';
import { scheduleBatch, cancelAll, pending } from './scheduler.js';
import {
  colorHexForStoppingTime, getNodePosition, setMode, getGroup,
  setGraphVisibleMax, getGraphVisibleMax, MAX_VISIBLE_NODES,
  getRaycastCandidates, getNodes,
} from './graph.js';
import { pulseAnchor } from './animate.js';
import { autoFrame, flyToNode, recenter, getCamera, getControls, setPostFxEnabled, isPostFxEnabled } from './camera.js';
import {
  getGameState, getGameMode, getTotalScore, getStreak, getBuckets,
  getSelectedBucket, getChallenge, getHighScore, getBestStreak,
  submitNumber, selectBucket, confirmLaunch, onRunStart, onRunComplete,
  nextRound, cancelPrediction, getCurrentNumber, setGameMode, generateChallenge, MODES,
} from './game.js';
import { INPUT_MAX, RECENT_MAX } from './constants.js';
import {
  showNumberLine, hideNumberLine, startSequence,
  getMathDisplay, getPlayState, formatValue,
  setSpeed, getSpeed, setPaused, isPausedPlayback, getRunStats,
  setOrbRunPerformanceMode,
  clearNumberLine, resetRun, setOrbVisibleMax, getOrbVisibleMax, MAX_ORBS,
  isDensityMode, skipToEnd, getHitCount, getMilestoneCallout,
  getFollowBall, setFollowBall, getDiscoveryCount, getRunDiscovery,
} from './numberline.js';
import {
  showTimeSeries, hideTimeSeries, addTimeSeriesNumber,
  clearTimeSeries, getTimeSeriesCameraTarget,
  toggleFlip, setVisibleMax, MAX_TIME_SERIES_LINES,
} from './timeseries.js';
import {
  showSpiral, hideSpiral, isSpiralActive,
  addSpiralNumber, clearSpiral, getSpiralCameraTarget,
  setSpiralVisibleMax, getSpiralVisibleMax, MAX_SPIRAL_LINES,
} from './spiral.js';
import {
  showFlatChart, hideFlatChart, isFlatChartActive,
  addFlatChartNumber, clearFlatChart, getFlatChartCameraTarget,
  startStreamingFill, abortFill, toggleFlatChartFlip,
  setFlatChartRenderMode, getFlatChartRenderMode,
  refitFlatChart,
} from './flatchart.js';
import { isMobileTier } from './quality.js';

// ── DOM refs ─────────────────────────────────────────────
const input = document.getElementById('num-input');
const btnGo = document.getElementById('btn-go');
const fillInput = document.getElementById('fill-input');
const btnFill = document.getElementById('btn-fill');
const btnAbort = document.getElementById('btn-abort');
const btnRecenter = document.getElementById('btn-recenter');
const recentList = document.getElementById('recent-list');
const tooltip = document.getElementById('tooltip');
const legend = document.getElementById('legend');
const stepInfo = document.getElementById('step-info');

/**
 * Rubberband slider: the user drags right to push the ceiling up.
 * When released past 75% of the current range, the range extends so
 * the released value becomes roughly the new midpoint — giving the
 * user room to keep dragging right indefinitely, up to a hardware
 * safety cap.
 *
 * onChange is rAF-debounced so fast drags don't flood the renderer.
 */
function makeRubberbandSlider({ sliderEl, valEl, onChange, safetyMax, initialMax, initialValue }) {
  let rangeMax = initialMax;
  sliderEl.min = 0;
  sliderEl.max = rangeMax;
  sliderEl.value = initialValue;
  valEl.textContent = String(initialValue);

  let rafPending = null;
  sliderEl.addEventListener('input', () => {
    const n = parseInt(sliderEl.value, 10) || 0;
    valEl.textContent = String(n);
    if (rafPending != null) return;
    rafPending = requestAnimationFrame(() => {
      rafPending = null;
      onChange(parseInt(sliderEl.value, 10) || 0);
    });
  });

  sliderEl.addEventListener('change', () => {
    const val = parseInt(sliderEl.value, 10) || 0;
    // Already at safety cap — can't extend further.
    if (rangeMax >= safetyMax) return;
    // Rubberband: if released in the upper 25% of the range, extend
    // so the released value ≈ midpoint of the new range.
    if (val > rangeMax * 0.75) {
      const newMax = Math.min(Math.max(val * 2, val + 1), safetyMax);
      rangeMax = newMax;
      sliderEl.max = rangeMax;
      sliderEl.value = val;   // effective ceiling stays where user put it
      valEl.textContent = String(val);
    }
  });
}

const recentEntries = []; // { value, stoppingTime, li }
let numberLineMode = false;
let timeSeriesMode = false;
let spiralMode = false;
let flatChartMode = false;

// ── Backdrop helper (for modal dialogs) ─────────────────
let activeBackdrop = null;
function showBackdrop(closeFn) {
  removeBackdrop();
  activeBackdrop = document.createElement('div');
  activeBackdrop.className = 'panel-backdrop';
  activeBackdrop.addEventListener('pointerdown', closeFn);
  document.getElementById('scene-wrap').appendChild(activeBackdrop);
}
function removeBackdrop() {
  if (activeBackdrop) { activeBackdrop.remove(); activeBackdrop = null; }
}

// ── Tooltip state ────────────────────────────────────────
let hoveredValue = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
raycaster.params.Points = { threshold: 0.5 };

export function getRaycaster() { return raycaster; }
export function getMouse() { return mouse; }

// ── Init ─────────────────────────────────────────────────
export function initUI(onSubmit) {
  input.focus();
  const mobileTier = isMobileTier();

  function submit() {
    const raw = input.value.trim();
    if (!raw) { showError('Enter a positive integer.'); return; }

    // Parse the input — supports plain digits ("12345"), expressions ("27^27"),
    // and scientific notation ("1.5e30"). Returns Number or BigInt.
    const n = parseValueExpression(raw);
    if (n == null || (typeof n === 'number' && (n < 1 || !Number.isFinite(n)))) {
      showError('Enter a positive integer (or "27^27").');
      return;
    }
    if (typeof n === 'bigint' && n < 1n) {
      showError('Enter a positive integer.');
      return;
    }

    const isOne = (typeof n === 'bigint') ? n === 1n : n === 1;

    // Chart modes (Time Series, Spiral, Number Line) support BigInt
    if (numberLineMode) {
      if (isOne) { input.value = ''; return; }
      input.value = '';
      clearError();
      const mode = getGameMode();
      if (mode === 'freeExplore' || mode === 'hitRange' || mode === 'findLongest') {
        // These modes skip bucket prediction
        if (submitNumber(n)) {
          const num = confirmLaunch();
          if (num != null) { onRunStart(); startSequence(num); }
        }
      } else {
        // guessSteps: show prediction panel
        if (submitNumber(n)) showPredictionPanel(n);
      }
      return;
    }
    if (timeSeriesMode) {
      if (isOne) { input.value = ''; return; }
      input.value = '';
      clearError();
      addTimeSeriesNumber(n);
      frameTimeSeriesCamera();
      return;
    }
    if (spiralMode) {
      if (isOne) { input.value = ''; return; }
      input.value = '';
      clearError();
      addSpiralNumber(n);
      const t = getSpiralCameraTarget();
      getCamera().position.lerp(t.position, 0.5);
      getControls().target.lerp(t.center, 0.5);
      return;
    }
    if (flatChartMode) {
      if (isOne) { input.value = ''; return; }
      input.value = '';
      clearError();
      addFlatChartNumber(n);
      frameFlatChartCamera();
      return;
    }

    // Graph modes use Number values internally — reject BigInt
    if (isBig(n) || n > INPUT_MAX) {
      showError(`Graph modes need a number ≤ ${INPUT_MAX.toLocaleString()}. Try a chart mode for huge numbers.`);
      return;
    }

    input.value = '';
    clearError();

    if (n === 1) {
      pulseAnchor();
      return;
    }

    onSubmit(n);
    addRecent(n);
    legend.classList.remove('hidden');
    setTimeout(() => autoFrame(), 600);
  }

  btnGo.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    clearError();
  });

  // Fill 1–N: no hard upper limit. Batch size scales with N for responsiveness.
  // Fill uses the frame-budgeted scheduler — work spreads across frames
  // so the renderer never blocks long enough to be killed by the browser.
  function submitFill() {
    const raw = fillInput.value.trim();
    const n = parseInt(raw, 10);

    if (!raw || isNaN(n) || n < 2 || !Number.isInteger(Number(raw))) {
      showFillError('Enter an integer ≥ 2.');
      return;
    }
    // No upper cap. Shared-tail caching keeps the Collatz computation
    // cheap even for huge N, and rendering work is staged across frames
    // by the scheduler. The per-mode visual ceiling is enforced in
    // setVisibleMax (Time Series) — Fill computes everything but only
    // shows what the device can render.

    fillInput.value = '';
    clearFillError();

    btnFill.disabled = true;
    btnFill.textContent = '0%';
    legend.classList.remove('hidden');

    // Time series fast path: setVisibleMax flips visibility flags only
    if (timeSeriesMode) {
      setVisibleMax(n);
      frameTimeSeriesCamera();
      btnFill.disabled = false;
      btnFill.textContent = 'Fill';
      return;
    }

    // Flat chart: stream fill via Web Worker (no cap)
    if (flatChartMode) {
      btnFill.disabled = true;
      btnFill.textContent = '0%';
      startStreamingFill(2, n, {
        onProgressCb: (drawn, total) => {
          const pct = Math.round((drawn / total) * 100);
          btnFill.textContent = `${Math.min(pct, 100)}%`;
        },
        onCompleteCb: () => {
          btnFill.disabled = false;
          btnFill.textContent = 'Fill';
          frameFlatChartCamera();
        },
      });
      return;
    }

    const dispatch = (i) => {
      if (spiralMode) return addSpiralNumber(i);
      return onSubmit(i);
    };

    // Build the work list and stage it via the scheduler.
    const items = [];
    for (let i = 2; i <= n; i++) items.push(i);

    scheduleBatch(items, (i) => dispatch(i), {
      priority: 5,
      onProgress: (done, total) => {
        const pct = Math.round((done / total) * 100);
        btnFill.textContent = `${Math.min(pct, 100)}%`;
      },
    }).then(() => {
      btnFill.disabled = false;
      btnFill.textContent = 'Fill';
      if (!spiralMode) addRecent(n);
      if (!spiralMode) setTimeout(() => autoFrame(), 400);
    });
  }

  btnFill.addEventListener('click', submitFill);
  fillInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitFill();
    clearFillError();
  });

  btnRecenter.addEventListener('click', () => recenter());

  // Settings gear: toggle mode selector visibility
  const btnSettings = document.getElementById('btn-settings');
  const modeSelector = document.getElementById('mode-selector');
  btnSettings.addEventListener('click', () => {
    modeSelector.classList.toggle('hidden');
  });

  // Mode selector
  const modeBtns = document.querySelectorAll('.mode-btn');
  const stoppingSubs = document.getElementById('stopping-subs');
  const subBtns = document.querySelectorAll('.sub-btn');
  const nlControls = document.getElementById('nl-controls');
  const chartControls = document.getElementById('chart-controls');
  const tsSliderWrap = document.getElementById('ts-slider-wrap');
  const tsSlider = document.getElementById('ts-slider');
  const tsSliderVal = document.getElementById('ts-slider-val');
  const graphSliderWrap = document.getElementById('graph-slider-wrap');
  const graphSlider = document.getElementById('graph-slider');
  const graphSliderVal = document.getElementById('graph-slider-val');
  const spiralSliderWrap = document.getElementById('spiral-slider-wrap');
  const spiralSlider = document.getElementById('spiral-slider');
  const spiralSliderVal = document.getElementById('spiral-slider-val');
  const nlSliderWrap = document.getElementById('nl-slider-wrap');
  const nlSlider = document.getElementById('nl-slider');
  const nlSliderVal = document.getElementById('nl-slider-val');
  const flatSliderWrap = document.getElementById('flat-slider-wrap');
  const flatSlider = document.getElementById('flat-slider');
  const flatSliderVal = document.getElementById('flat-slider-val');
  const chartFlipBtn = document.getElementById('chart-flip');
  const heatmapToggleBtn = document.getElementById('flat-heatmap-toggle');
  const refitBtn = document.getElementById('flat-refit');
  const mathBar = document.getElementById('math-bar');
  const graphGroup = getGroup();

  function exitOrbRun() {
    if (!numberLineMode) return;
    numberLineMode = false;
    hideNumberLine();
    clearNumberLine();
    nlControls.classList.add('hidden');
    mathBar.classList.add('hidden');
    // Restore fill controls hidden by enterOrbRun
    fillInput.classList.remove('hidden');
    btnFill.classList.remove('hidden');
  }

  // Exit all special modes, return to graph
  function exitAllSpecialModes() {
    // Stop any background fill work when changing modes.
    cancelAll();
    abortFill();
    btnFill.disabled = false;
    btnFill.textContent = 'Fill';

    exitOrbRun();
    if (timeSeriesMode) {
      timeSeriesMode = false;
      hideTimeSeries();
    }
    if (spiralMode) {
      spiralMode = false;
      hideSpiral();
    }
    if (flatChartMode) {
      flatChartMode = false;
      hideFlatChart();
    }
    chartControls.classList.add('hidden');
    tsSliderWrap.classList.add('hidden');
    spiralSliderWrap.classList.add('hidden');
    graphSliderWrap.classList.add('hidden');
    nlSliderWrap.classList.add('hidden');
    chartFlipBtn.classList.add('hidden');
    heatmapToggleBtn.classList.add('hidden');
    refitBtn.classList.add('hidden');
    if (graphGroup) graphGroup.visible = true;
    input.placeholder = 'Try 27';
  }

  function enterOrbRun() {
    exitAllSpecialModes();
    numberLineMode = true;
    showNumberLine();
    // Orb Run should launch immediately on number entry.
    // Default this mode to Free Explore so users are not blocked
    // behind the Guess Steps prediction panel on first load.
    if (getGameMode() !== 'freeExplore') {
      setGameMode('freeExplore');
    }
    if (graphGroup) graphGroup.visible = false;
    nlControls.classList.remove('hidden');
    // Hide fill + orbs slider — not used in Orb Run
    fillInput.classList.add('hidden');
    btnFill.classList.add('hidden');
    input.placeholder = 'Enter number';
    // Camera: slightly above and in front, looking down the line
    // at ~30° so the plunger is lower-left and orbs recede upper-right
    const cam = getCamera();
    const ctrl = getControls();
    cam.position.set(-0.3, 1.8, 2.5);
    ctrl.target.set(0.4, 0, 0);
  }

  function enterTimeSeries() {
    exitAllSpecialModes();
    timeSeriesMode = true;
    showTimeSeries();
    if (graphGroup) graphGroup.visible = false;
    chartControls.classList.remove('hidden');
    tsSliderWrap.classList.remove('hidden');
    chartFlipBtn.classList.remove('hidden');
    input.placeholder = 'Try 27';
    frameTimeSeriesCamera();
  }

  function enterSpiral() {
    exitAllSpecialModes();
    spiralMode = true;
    showSpiral();
    if (graphGroup) graphGroup.visible = false;
    chartControls.classList.remove('hidden');
    spiralSliderWrap.classList.remove('hidden');
    input.placeholder = 'Try 27';
    frameSpiralCamera();
  }

  function enterFlatChart() {
    exitAllSpecialModes();
    flatChartMode = true;
    showFlatChart();
    if (graphGroup) graphGroup.visible = false;
    chartControls.classList.remove('hidden');
    chartFlipBtn.classList.remove('hidden');
    heatmapToggleBtn.classList.remove('hidden');
    refitBtn.classList.remove('hidden');
    input.placeholder = 'Try 27 or 27^27';
    frameFlatChartCamera();
  }

  function enterGraphMode() {
    // Called when a graph-based mode (particles/value/parity/stopping)
    // is selected. Shows the graph visibility slider.
    graphSliderWrap.classList.remove('hidden');
    const particleLimit = particleLoadSetting === 'low' ? MOBILE_PARTICLE_CAP : userGraphVisibleMax;
    const clamped = Math.max(1, Math.min(particleLimit, MAX_VISIBLE_NODES));
    setGraphVisibleMax(clamped);
    graphSlider.value = clamped;
    graphSliderVal.textContent = String(clamped);
  }

  function frameTimeSeriesCamera() {
    const cam = getCamera();
    const t = getTimeSeriesCameraTarget(cam.aspect);
    cam.position.copy(t.position);
    getControls().target.copy(t.center);
  }

  function frameSpiralCamera() {
    const t = getSpiralCameraTarget();
    getCamera().position.copy(t.position);
    getControls().target.copy(t.center);
  }

  function frameFlatChartCamera() {
    const cam = getCamera();
    const t = getFlatChartCameraTarget(cam.aspect);
    cam.position.copy(t.position);
    getControls().target.copy(t.center);
  }

  for (const btn of modeBtns) {
    btn.addEventListener('click', () => {
      for (const b of modeBtns) b.classList.remove('active');
      btn.classList.add('active');
      // Auto-hide mode selector after selection
      modeSelector.classList.add('hidden');

      const mode = btn.dataset.mode;
      if (mode === 'orbrun' || mode === 'numberline') {
        stoppingSubs.classList.add('hidden');
        enterOrbRun();
      } else if (mode === 'timeseries') {
        stoppingSubs.classList.add('hidden');
        enterTimeSeries();
      } else if (mode === 'spiral') {
        stoppingSubs.classList.add('hidden');
        enterSpiral();
      } else if (mode === 'flatchart') {
        stoppingSubs.classList.add('hidden');
        enterFlatChart();
      } else {
        exitAllSpecialModes();
        enterGraphMode();
        if (mode === 'stopping') {
          stoppingSubs.classList.remove('hidden');
          const activeSub = stoppingSubs.querySelector('.sub-btn.active');
          setMode(activeSub ? activeSub.dataset.mode : 'stopping');
        } else {
          stoppingSubs.classList.add('hidden');
          setMode(mode);
        }
        setTimeout(() => autoFrame(), 800);
      }
    });
  }

  // Stopping Time sub-mode buttons
  for (const btn of subBtns) {
    btn.addEventListener('click', () => {
      for (const b of subBtns) b.classList.remove('active');
      btn.classList.add('active');
      setMode(btn.dataset.mode);
      setTimeout(() => autoFrame(), 800);
    });
  }

  // ── Speed button (kept for game mode) ─────────────────
  const ffBtn = document.getElementById('nl-ff');
  const perfBtn = document.createElement('button');
  perfBtn.className = 'nl-btn';
  perfBtn.id = 'nl-perf';
  perfBtn.textContent = 'Perf: Auto';
  document.getElementById('nl-controls').appendChild(perfBtn);
  const FF_SPEEDS = [1, 2, 4, 8];
  let ffIndex = 0;
  let perfMode = 'auto';
  ffBtn.addEventListener('click', () => {
    ffIndex = (ffIndex + 1) % FF_SPEEDS.length;
    const spd = FF_SPEEDS[ffIndex];
    setSpeed(spd);
    ffBtn.textContent = `${spd}x`;
  });
  perfBtn.addEventListener('click', () => {
    perfMode = perfMode === 'auto' ? 'eco' : 'auto';
    setOrbRunPerformanceMode(perfMode);
    perfBtn.textContent = perfMode === 'auto' ? 'Perf: Auto' : 'Perf: Eco';
  });

  const pauseBtn = document.getElementById('nl-pause');
  pauseBtn.addEventListener('click', () => {
    const nextPaused = !isPausedPlayback();
    setPaused(nextPaused);
    pauseBtn.textContent = nextPaused ? 'Resume' : 'Pause';
  });

  // Skip to End (Number Line density mode only)
  const skipBtn = document.getElementById('nl-skip');
  skipBtn.addEventListener('click', () => skipToEnd());

  // Follow Ball toggle
  const followBtn = document.getElementById('nl-follow');
  followBtn.addEventListener('click', () => {
    const next = !getFollowBall();
    setFollowBall(next);
    followBtn.classList.toggle('active', next);
    followBtn.textContent = next ? 'Free Cam' : 'Follow Ball';
  });

  // Clear All (wipe persistent orbs + trails)
  const clearAllBtn = document.getElementById('nl-clear-all');
  clearAllBtn.addEventListener('click', () => {
    clearNumberLine();
    discoveryCountEl.textContent = '0';
  });

  // Discovery counter (persistent)
  const discoveryCounterEl = document.getElementById('discovery-counter');
  const discoveryCountEl = document.getElementById('discovery-count');

  const MOBILE_PARTICLE_CAP = 180;
  let userGraphVisibleMax = getGraphVisibleMax();
  let particleLoadSetting = mobileTier ? 'low' : 'auto';
  const particleToggleBtn = document.getElementById('toggle-particle-load');
  const postFxToggleBtn = document.getElementById('toggle-postfx');

  function refreshPerfToggles() {
    if (particleToggleBtn) {
      particleToggleBtn.textContent = `Particle load: ${particleLoadSetting}`;
    }
    if (postFxToggleBtn) {
      postFxToggleBtn.textContent = `Post FX: ${isPostFxEnabled() ? 'on' : 'off'}`;
    }
  }

  if (particleToggleBtn) {
    particleToggleBtn.addEventListener('click', () => {
      particleLoadSetting = particleLoadSetting === 'low' ? 'auto' : 'low';
      const nextMax = particleLoadSetting === 'low'
        ? Math.min(userGraphVisibleMax, MOBILE_PARTICLE_CAP)
        : userGraphVisibleMax;
      setGraphVisibleMax(nextMax);
      graphSlider.value = nextMax;
      graphSliderVal.textContent = String(nextMax);
      refreshPerfToggles();
    });
  }

  if (postFxToggleBtn) {
    postFxToggleBtn.addEventListener('click', () => {
      setPostFxEnabled(!isPostFxEnabled());
      refreshPerfToggles();
    });
  }

  setPostFxEnabled(!mobileTier);
  refreshPerfToggles();

  // Clear for chart modes (time series + spiral + flat chart)
  document.getElementById('chart-clear').addEventListener('click', () => {
    cancelAll();  // cancel any in-flight fill scheduler work
    btnFill.disabled = false;
    btnFill.textContent = 'Fill';
    if (timeSeriesMode) {
      clearTimeSeries();
      tsSlider.value = 0;
      tsSliderVal.textContent = '0';
    }
    if (spiralMode) clearSpiral();
    if (flatChartMode) {
      clearFlatChart();
    }
  });

  // Flip X/Y for the active chart mode (time series OR flat chart)
  chartFlipBtn.addEventListener('click', () => {
    if (timeSeriesMode) {
      toggleFlip();
      frameTimeSeriesCamera();
    } else if (flatChartMode) {
      toggleFlatChartFlip();
      frameFlatChartCamera();
    }
  });

  // Heat-map toggle (Flat Chart mode only)
  heatmapToggleBtn.addEventListener('click', () => {
    const current = getFlatChartRenderMode();
    const next = current === 'strokes' ? 'heatmap' : 'strokes';
    setFlatChartRenderMode(next);
    heatmapToggleBtn.textContent = next === 'strokes' ? 'Heat Map' : 'Strokes';
  });

  // Refit (Flat Chart mode only): re-draw at corrected axis scale
  refitBtn.addEventListener('click', () => {
    refitFlatChart();
  });

  // Rubberband sliders — drag right to push the per-mode ceiling up.
  // On release past 75% of the current range, the range extends so the
  // slider re-centers and more headroom is available. Capped at the
  // per-mode hardware safety max.
  makeRubberbandSlider({
    sliderEl: tsSlider, valEl: tsSliderVal,
    initialMax: 200, initialValue: 0, safetyMax: MAX_TIME_SERIES_LINES,
    onChange: (n) => {
      setVisibleMax(n);
      frameTimeSeriesCamera();
    },
  });
  makeRubberbandSlider({
    sliderEl: graphSlider, valEl: graphSliderVal,
    initialMax: 200, initialValue: 100, safetyMax: MAX_VISIBLE_NODES,
    onChange: (n) => {
      userGraphVisibleMax = n;
      const effective = particleLoadSetting === 'low' ? Math.min(n, MOBILE_PARTICLE_CAP) : n;
      setGraphVisibleMax(effective);
      graphSliderVal.textContent = String(effective);
    },
  });
  makeRubberbandSlider({
    sliderEl: spiralSlider, valEl: spiralSliderVal,
    initialMax: 100, initialValue: 50, safetyMax: MAX_SPIRAL_LINES,
    onChange: (n) => setSpiralVisibleMax(n),
  });
  makeRubberbandSlider({
    sliderEl: nlSlider, valEl: nlSliderVal,
    initialMax: 500, initialValue: 250, safetyMax: MAX_ORBS,
    onChange: (n) => setOrbVisibleMax(n),
  });
  // Flat Chart has no slider — it's uncapped. Fill goes via worker streaming.

  // ── Abort button + Escape key ─────────────────────────
  function abortWork() {
    cancelAll();
    abortFill();    // cancel any in-flight worker range fill
    btnFill.disabled = false;
    btnFill.textContent = 'Fill';
    btnAbort.classList.add('hidden');
  }
  btnAbort.addEventListener('click', abortWork);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pending() > 0) {
      abortWork();
    }
  });

  // Self-scheduling RAF loop: show the Abort button only while the
  // scheduler has pending work. Throttled to every 10 frames — the
  // check is a cheap array-length read but there's no reason to
  // re-touch the DOM 60 times/sec.
  let abortFrame = 0;
  function updateAbortVisibility() {
    requestAnimationFrame(updateAbortVisibility);
    abortFrame = (abortFrame + 1) % 10;
    if (abortFrame !== 0) return;
    const busy = pending() > 0;
    btnAbort.classList.toggle('hidden', !busy);
  }
  requestAnimationFrame(updateAbortVisibility);

  // Mouse move for tooltip raycasting
  document.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    tooltipScreenPos = { x: e.clientX, y: e.clientY };
  });

  // ── Math bar update (self-scheduling RAF loop) ─────────
  const hitCounter = document.getElementById('hit-counter');
  const hitCountEl = document.getElementById('hit-count');

  const milestoneEl = document.getElementById('milestone-callout');
  const runStatsEl = document.getElementById('nl-stats');
  const statValueEl = document.getElementById('nl-stat-value');
  const statStepEl = document.getElementById('nl-stat-step');
  const statPeakEl = document.getElementById('nl-stat-peak');
  const statEtaEl = document.getElementById('nl-stat-eta');
  const badgesEl = document.getElementById('nl-badges');

  function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'done';
    if (seconds < 10) return `${seconds.toFixed(1)}s`;
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }

  function updateMathBar() {
    requestAnimationFrame(updateMathBar);
    // Show/hide Skip button based on density mode
    skipBtn.classList.toggle('hidden', !(numberLineMode && isDensityMode() && getPlayState() !== 'complete'));

    // Discovery counter: visible in Orb Run mode, updates every frame
    if (numberLineMode) {
      discoveryCounterEl.classList.remove('hidden');
      discoveryCountEl.textContent = String(getDiscoveryCount());
    } else {
      discoveryCounterEl.classList.add('hidden');
    }

    // Milestone callout
    const callout = getMilestoneCallout();
    if (callout && numberLineMode) {
      milestoneEl.textContent = callout.text;
      milestoneEl.className = 'milestone-callout-visible milestone-' + callout.type;
    } else {
      milestoneEl.className = 'hidden';
    }

    // Hit counter: visible in number line mode when a sequence is playing
    if (numberLineMode && getPlayState() !== 'idle') {
      hitCounter.classList.remove('hidden');
      hitCountEl.textContent = String(getHitCount());
    } else {
      hitCounter.classList.add('hidden');
    }

    const stats = getRunStats();
    if (numberLineMode && stats && getPlayState() !== 'idle') {
      runStatsEl.classList.remove('hidden');
      statValueEl.textContent = formatValue(stats.currentValue);
      statStepEl.textContent = `${stats.stepIndex}/${stats.totalSteps}`;
      statPeakEl.textContent = formatValue(stats.peakValue);
      statEtaEl.textContent = stats.isPaused ? 'paused' : formatEta(stats.estimatedRemainingSec);
      badgesEl.innerHTML = stats.badges.map((b) => `<span class="nl-badge">${b}</span>`).join('');
    } else {
      runStatsEl.classList.add('hidden');
      badgesEl.innerHTML = '';
    }

    pauseBtn.textContent = isPausedPlayback() ? 'Resume' : 'Pause';

    if (!numberLineMode) {
      mathBar.classList.add('hidden');
      return;
    }
    const data = getMathDisplay();
    if (data && data.label !== 'DONE') {
      mathBar.classList.remove('hidden');
      const labelEl = document.getElementById('math-label');
      labelEl.textContent = data.label;
      labelEl.className = data.isEven ? 'even' : 'odd';
      document.getElementById('math-rule').textContent = data.rule;
      document.getElementById('math-operation').textContent = data.operation;
      document.getElementById('math-result').textContent = '= ' + data.result;
    }
    // When data is null (during travel), bar stays showing the LAST values.
    // When data.label === 'DONE', hide.
    if (data && data.label === 'DONE') {
      mathBar.classList.add('hidden');
    }
  }
  requestAnimationFrame(updateMathBar);

  // ── Game UI wiring ────────────────────────────────────
  const predictPanel = document.getElementById('predict-panel');
  const predictNumber = document.getElementById('predict-number');
  const predictBucketsEl = document.getElementById('predict-buckets');
  const btnLaunch = document.getElementById('btn-launch');
  const resultsPanel = document.getElementById('results-panel');
  const btnNext = document.getElementById('btn-next');
  const scoreValueEl = document.getElementById('score-value');
  const streakValueEl = document.getElementById('streak-value');
  const streakLabelEl = document.getElementById('streak-label');
  const modeSelectPanel = document.getElementById('mode-select-panel');
  const modeSelectBtns = document.getElementById('mode-select-buttons');
  const challengePanel = document.getElementById('challenge-panel');
  const challengeInstruction = document.getElementById('challenge-instruction');
  const challengeInput = document.getElementById('challenge-input');
  const btnChallengeGo = document.getElementById('btn-challenge-go');
  const highScoreEl = document.getElementById('high-score');
  const highScoreValue = document.getElementById('high-score-value');

  // Build mode selector buttons
  modeSelectBtns.innerHTML = MODES.map(m =>
    `<button class="mode-select-btn${m.id === getGameMode() ? ' active' : ''}" data-mode="${m.id}">` +
    `<span class="mode-select-icon">${m.icon}</span>` +
    `<span><span>${m.label}</span><br><span class="mode-select-desc">${m.desc}</span></span>` +
    `</button>`
  ).join('');

  for (const btn of modeSelectBtns.querySelectorAll('.mode-select-btn')) {
    btn.addEventListener('click', () => {
      setGameMode(btn.dataset.mode);
      for (const b of modeSelectBtns.querySelectorAll('.mode-select-btn')) b.classList.remove('active');
      btn.classList.add('active');
      modeSelectPanel.classList.add('hidden');
      // Show challenge panel for hitRange/findLongest
      if (btn.dataset.mode === 'hitRange' || btn.dataset.mode === 'findLongest') {
        const ch = generateChallenge();
        if (ch) {
          challengeInstruction.textContent = ch.instruction;
          challengePanel.classList.remove('hidden');
          showBackdrop(closeChallengePanel);
          challengeInput.value = '';
          challengeInput.focus();
        }
      }
    });
  }

  function closeChallengePanel() {
    challengePanel.classList.add('hidden');
    removeBackdrop();
    input.focus();
  }

  // Challenge panel submit (hitRange / findLongest)
  function submitChallengeInput() {
    const raw = challengeInput.value.trim();
    const n = parseInt(raw, 10);
    if (!raw || isNaN(n) || n < 1) return;
    if (submitNumber(n)) {
      challengePanel.classList.add('hidden');
      removeBackdrop();
      // For these modes, skip prediction → go straight to launch
      const num = confirmLaunch();
      if (num != null) {
        onRunStart();
        startSequence(num);
      }
    }
  }
  btnChallengeGo.addEventListener('click', submitChallengeInput);
  challengeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitChallengeInput();
  });

  // Show mode selector when idle and user clicks a "Mode" button
  // For now, show it via a small link in the input area
  function showModeSelector() {
    modeSelectPanel.classList.toggle('hidden');
  }

  function showPredictionPanel(n) {
    predictNumber.textContent = fmtValue(n);
    // Build bucket buttons
    const buckets = getBuckets();
    predictBucketsEl.innerHTML = buckets.map((b, i) =>
      `<button class="bucket-btn" data-idx="${i}">${b.label}</button>`
    ).join('');
    // Wire bucket clicks
    for (const btn of predictBucketsEl.querySelectorAll('.bucket-btn')) {
      btn.addEventListener('click', () => {
        for (const b of predictBucketsEl.querySelectorAll('.bucket-btn')) b.classList.remove('selected');
        btn.classList.add('selected');
        selectBucket(parseInt(btn.dataset.idx, 10));
        btnLaunch.disabled = false;
      });
    }
    btnLaunch.disabled = true;
    predictPanel.classList.remove('hidden');
    showBackdrop(closePredictPanel);
  }

  function closePredictPanel() {
    predictPanel.classList.add('hidden');
    removeBackdrop();
    cancelPrediction();
    input.focus();
  }

  function hidePredictionPanel() {
    predictPanel.classList.add('hidden');
    removeBackdrop();
  }

  function showResultsPanel(results) {
    // Tag with icon + color
    const tagIcon = document.getElementById('results-tag-icon');
    const tagLabel = document.getElementById('results-tag');
    tagIcon.textContent = results.tagIcon || '';
    tagLabel.textContent = results.tag;
    tagLabel.style.color = results.tagColor || '#889abb';

    // Number
    const numEl = document.getElementById('results-number');
    if (numEl) numEl.textContent = results.numberDisplay;

    // Actual steps
    document.getElementById('results-actual').textContent = String(results.actualSteps);

    // Guess display depends on mode
    const guessEl = document.getElementById('results-guess');
    if (results.mode === 'guessSteps' && results.guessedBucket) {
      guessEl.textContent = results.guessedBucket.label;
    } else if (results.mode === 'hitRange' && results.challenge) {
      guessEl.textContent = results.challenge.label;
      guessEl.parentElement.querySelector('.results-stat-label').textContent = 'target range';
    } else if (results.mode === 'findLongest' && results.challenge) {
      guessEl.textContent = `best: ${results.challenge.bestSteps}`;
      guessEl.parentElement.querySelector('.results-stat-label').textContent = 'best in range';
    } else {
      guessEl.textContent = '—';
    }

    // Verdict
    const verdict = document.getElementById('results-verdict');
    verdict.textContent = results.verdictText || '';
    verdict.className = 'results-verdict ' + (results.verdictClass || '');

    // Peak
    const peakEl = document.getElementById('results-peak');
    if (peakEl) peakEl.textContent = `Peak value: ${results.peakDisplay}`;

    // Score + discovery
    const scoreEl = document.getElementById('results-score');
    if (results.mode === 'freeExplore') {
      const disc = getRunDiscovery();
      const total = getDiscoveryCount();
      scoreEl.textContent = disc.newCount > 0 ? `+${disc.newCount} new orbs` : '';
      const verdictEl = document.getElementById('results-verdict');
      if (verdictEl && disc.newCount > 0) {
        verdictEl.textContent = `${total} total discovered${disc.sharedCount > 0 ? ` | ${disc.sharedCount} shared` : ''}`;
        verdictEl.className = 'results-verdict correct';
      } else if (verdictEl) {
        verdictEl.textContent = `${total} total discovered — try a bigger number!`;
        verdictEl.className = 'results-verdict close';
      }
    } else {
      scoreEl.textContent = `+${results.roundScore}`;
    }
    const streakEl = document.getElementById('results-streak');
    if (streakEl) {
      streakEl.textContent = results.streak > 1 ? `${results.streak}\u00D7 streak!` : '';
      streakEl.style.display = results.streak > 1 ? 'inline' : 'none';
    }

    resultsPanel.classList.remove('hidden');
    showBackdrop(closeResultsPanel);
    updateScoreDisplay();
  }

  function closeResultsPanel() {
    resultsPanel.classList.add('hidden');
    removeBackdrop();
    nextRound();
    const mode = getGameMode();
    if (mode === 'hitRange' || mode === 'findLongest') {
      const ch = generateChallenge();
      if (ch) {
        challengeInstruction.textContent = ch.instruction;
        challengePanel.classList.remove('hidden');
        showBackdrop(closeChallengePanel);
        challengeInput.value = '';
        challengeInput.focus();
        return;
      }
    }
    input.focus();
  }

  function hideResultsPanel() {
    resultsPanel.classList.add('hidden');
    removeBackdrop();
  }

  function updateScoreDisplay() {
    scoreValueEl.textContent = String(getTotalScore());
    const s = getStreak();
    if (s > 1) {
      streakValueEl.textContent = `${s}×`;
      streakValueEl.classList.remove('hidden');
      streakLabelEl.classList.remove('hidden');
    } else {
      streakValueEl.classList.add('hidden');
      streakLabelEl.classList.add('hidden');
    }
  }

  // Mode select button (in input area)
  document.getElementById('btn-mode-select').addEventListener('click', showModeSelector);

  // Launch button
  btnLaunch.addEventListener('click', () => {
    const n = confirmLaunch();
    if (n == null) return;
    hidePredictionPanel();
    onRunStart();
    startSequence(n);
  });

  // Next button (after results) — same logic as closeResultsPanel
  btnNext.addEventListener('click', closeResultsPanel);

  // Update high score display
  function updateHighScore() {
    const hs = getHighScore();
    if (hs > 0) {
      highScoreValue.textContent = String(hs);
      highScoreEl.classList.remove('hidden');
    }
  }
  updateHighScore();

  // ── Panel × close buttons ────────────────────────────
  modeSelector.querySelector('.panel-close').addEventListener('click', () => {
    modeSelector.classList.add('hidden');
  });
  modeSelectPanel.querySelector('.panel-close').addEventListener('click', () => {
    modeSelectPanel.classList.add('hidden');
  });
  challengePanel.querySelector('.panel-close').addEventListener('click', closeChallengePanel);
  predictPanel.querySelector('.panel-close').addEventListener('click', closePredictPanel);
  resultsPanel.querySelector('.panel-close').addEventListener('click', closeResultsPanel);

  // ── Popovers: outside-click to dismiss ────────────────
  const btnModeSelect = document.getElementById('btn-mode-select');
  document.addEventListener('pointerdown', (e) => {
    if (!modeSelector.classList.contains('hidden') &&
        !modeSelector.contains(e.target) && e.target !== btnSettings) {
      modeSelector.classList.add('hidden');
    }
    if (!modeSelectPanel.classList.contains('hidden') &&
        !modeSelectPanel.contains(e.target) && e.target !== btnModeSelect) {
      modeSelectPanel.classList.add('hidden');
    }
  });

  // ── Escape key closes the topmost open panel ──────────
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!resultsPanel.classList.contains('hidden')) { closeResultsPanel(); return; }
    if (!predictPanel.classList.contains('hidden')) { closePredictPanel(); return; }
    if (!challengePanel.classList.contains('hidden')) { closeChallengePanel(); return; }
    if (!modeSelectPanel.classList.contains('hidden')) { modeSelectPanel.classList.add('hidden'); return; }
    if (!modeSelector.classList.contains('hidden')) { modeSelector.classList.add('hidden'); return; }
  });

  // Poll for run completion — when Orb Run playState becomes
  // 'complete' and game state is 'running', trigger results.
  function checkRunCompletion() {
    requestAnimationFrame(checkRunCompletion);
    if (getGameState() === 'running' && getPlayState() === 'complete') {
      const results = onRunComplete();
      if (results) showResultsPanel(results);
    }
  }
  requestAnimationFrame(checkRunCompletion);

  // ── Default mode: Orb Run ─────────────────────────────
  enterOrbRun();
}

let tooltipScreenPos = { x: 0, y: 0 };

// ── Error feedback ───────────────────────────────────────
function showError(msg) {
  input.classList.add('error');
  input.placeholder = msg;
  setTimeout(() => {
    input.placeholder = 'Try 27';
    input.classList.remove('error');
  }, 2000);
}

function clearError() {
  input.classList.remove('error');
}

function showFillError(msg) {
  fillInput.classList.add('error');
  fillInput.placeholder = msg;
  setTimeout(() => {
    fillInput.placeholder = 'Fill 1–N';
    fillInput.classList.remove('error');
  }, 2000);
}

function clearFillError() {
  fillInput.classList.remove('error');
}

// ── Recent panel ─────────────────────────────────────────
function addRecent(value) {
  // Remove if already in list
  const existingIdx = recentEntries.findIndex(e => e.value === value);
  if (existingIdx >= 0) {
    recentEntries[existingIdx].li.remove();
    recentEntries.splice(existingIdx, 1);
  }

  const st = stoppingTime(value);
  const li = document.createElement('li');
  li.innerHTML = `
    <span class="recent-swatch" style="background:${colorHexForStoppingTime(st)}"></span>
    <span class="recent-num">${value}</span>
    <span class="recent-steps">${st} steps</span>
  `;
  li.addEventListener('click', () => {
    const pos = getNodePosition(value);
    if (pos) flyToNode(pos);
  });

  recentList.prepend(li);
  recentEntries.unshift({ value, stoppingTime: st, li });

  // Cap at RECENT_MAX
  while (recentEntries.length > RECENT_MAX) {
    const removed = recentEntries.pop();
    removed.li.remove();
  }
}

/**
 * Update the color swatches in the recent panel (after rescale).
 */
export function updateRecentColors() {
  for (const entry of recentEntries) {
    const swatch = entry.li.querySelector('.recent-swatch');
    if (swatch) {
      swatch.style.background = colorHexForStoppingTime(entry.stoppingTime);
    }
  }
}

// ── Tooltip ──────────────────────────────────────────────
export function updateTooltip(camera, scene) {
  raycaster.setFromCamera(mouse, camera);

  // Raycast only against recently-added nodes (ring buffer of ≤200).
  // Keeps hover cost bounded even with thousands of nodes in the scene.
  const meshes = getRaycastCandidates();

  const intersects = raycaster.intersectObjects(meshes, false);

  if (intersects.length > 0) {
    const obj = intersects[0].object;
    const value = obj.userData.collatzValue;
    if (value !== undefined) {
      hoveredValue = value;
      const st = stoppingTime(value);
      tooltip.innerHTML = `
        <div class="tt-value">${value}</div>
        <div class="tt-detail">${st} steps to 1</div>
        <div class="tt-detail">${value % 2 === 0 ? 'Even (÷2)' : 'Odd (×3+1)'}</div>
      `;
      tooltip.classList.remove('hidden');
      tooltip.style.left = (tooltipScreenPos.x + 14) + 'px';
      tooltip.style.top = (tooltipScreenPos.y - 10) + 'px';

      // Brighten the hovered node slightly
      if (value !== 1) {
        obj.material.emissiveIntensity = Math.min(obj.material.emissiveIntensity + 0.15, 0.8);
      }
      return;
    }
  }

  // Reset previously hovered node
  if (hoveredValue !== null && hoveredValue !== 1) {
    const node = getNodes().get(hoveredValue);
    if (node) {
      const climber = hoveredValue > 1 && hoveredValue % 2 !== 0;
      node.mesh.material.emissiveIntensity = climber ? 0.35 : 0.05;
    }
  }
  hoveredValue = null;
  tooltip.classList.add('hidden');
}

// ── Step info display ────────────────────────────────────
export function showStepInfo(value, detail) {
  const el = document.getElementById('step-info');
  document.getElementById('step-value').textContent = value;
  document.getElementById('step-detail').textContent = detail;
  el.classList.remove('hidden');
}

export function hideStepInfo() {
  document.getElementById('step-info').classList.add('hidden');
}
