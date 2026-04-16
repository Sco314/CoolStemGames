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
import { autoFrame, flyToNode, recenter, getCamera, getControls } from './camera.js';
import { INPUT_MAX, RECENT_MAX } from './constants.js';
import {
  showNumberLine, hideNumberLine, isNumberLineActive, startSequence,
  getMathDisplay, getPlayState, zoomToExtents, zoomToNumber,
  findLowestUnvisited, findHighestUnvisited, formatValue,
  setSpeed, getSpeed, setScaleMode, getScaleMode,
  clearNumberLine, setOrbVisibleMax, getOrbVisibleMax, MAX_ORBS,
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
      startSequence(n);
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

    if (numberLineMode) {
      showFillError('Fill not supported in Number Line.');
      return;
    }

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

  // Exit all special modes, return to graph
  function exitAllSpecialModes() {
    if (numberLineMode) {
      numberLineMode = false;
      hideNumberLine();
      // Full dispose on mode-switch away — keeps VRAM from accumulating
      // across Graph → NumberLine → Spiral cycles.
      clearNumberLine();
      nlControls.classList.add('hidden');
      nlSliderWrap.classList.add('hidden');
      mathBar.classList.add('hidden');
    }
    if (timeSeriesMode) {
      timeSeriesMode = false;
      hideTimeSeries();
      chartControls.classList.add('hidden');
      tsSliderWrap.classList.add('hidden');
      chartFlipBtn.classList.add('hidden');
    }
    if (spiralMode) {
      spiralMode = false;
      hideSpiral();
      chartControls.classList.add('hidden');
      spiralSliderWrap.classList.add('hidden');
    }
    if (flatChartMode) {
      flatChartMode = false;
      hideFlatChart();
      abortFill();
      chartControls.classList.add('hidden');
      chartFlipBtn.classList.add('hidden');
      heatmapToggleBtn.classList.add('hidden');
      refitBtn.classList.add('hidden');
    }
    graphSliderWrap.classList.add('hidden');
    if (graphGroup) graphGroup.visible = true;
    input.placeholder = 'Try 27';
  }

  function enterNumberLine() {
    exitAllSpecialModes();
    numberLineMode = true;
    showNumberLine();
    if (graphGroup) graphGroup.visible = false;
    nlControls.classList.remove('hidden');
    nlSliderWrap.classList.remove('hidden');
    input.placeholder = 'Enter number';
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

      const mode = btn.dataset.mode;
      if (mode === 'numberline') {
        stoppingSubs.classList.add('hidden');
        enterNumberLine();
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

  // ── Number line controls ─────────────────────────────────
  const nlGotoInput = document.getElementById('nl-goto-input');
  let gotoVisible = false;

  document.getElementById('nl-extents').addEventListener('click', () => {
    zoomToExtents(getCamera(), getControls());
  });

  document.getElementById('nl-goto').addEventListener('click', () => {
    gotoVisible = !gotoVisible;
    nlGotoInput.classList.toggle('hidden', !gotoVisible);
    if (gotoVisible) nlGotoInput.focus();
  });

  nlGotoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const n = parseInt(nlGotoInput.value.trim(), 10);
      if (n > 0) {
        zoomToNumber(n, getCamera(), getControls());
        nlGotoInput.value = '';
        nlGotoInput.classList.add('hidden');
        gotoVisible = false;
      }
    }
  });

  document.getElementById('nl-low').addEventListener('click', () => {
    const low = findLowestUnvisited();
    if (low) zoomToNumber(low, getCamera(), getControls());
  });

  document.getElementById('nl-high').addEventListener('click', () => {
    const high = findHighestUnvisited();
    if (high) zoomToNumber(high, getCamera(), getControls());
  });

  // Fast-forward button: cycles through 1x → 2x → 4x → 8x → 1x
  const ffBtn = document.getElementById('nl-ff');
  const FF_SPEEDS = [1, 2, 4, 8];
  let ffIndex = 0;
  ffBtn.addEventListener('click', () => {
    ffIndex = (ffIndex + 1) % FF_SPEEDS.length;
    const spd = FF_SPEEDS[ffIndex];
    setSpeed(spd);
    ffBtn.textContent = `${spd}x`;
  });

  // Linear/Log scale toggle
  const scaleBtn = document.getElementById('nl-scale');
  scaleBtn.addEventListener('click', () => {
    const next = getScaleMode() === 'linear' ? 'log' : 'linear';
    setScaleMode(next);
    scaleBtn.textContent = next === 'linear' ? 'Linear' : 'Log';
    setTimeout(() => zoomToExtents(getCamera(), getControls()), 50);
  });

  // Clear for chart modes (time series + spiral)
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
    onChange: (n) => setGraphVisibleMax(n),
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
  function updateMathBar() {
    requestAnimationFrame(updateMathBar);
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

  // ── Default mode: Time Series ─────────────────────────
  enterTimeSeries();
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
