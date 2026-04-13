/**
 * DOM overlay: input handling, recent inputs panel, tooltips, legend.
 */

import * as THREE from 'three';
import { stoppingTime } from './collatz.js';
import { colorHexForStoppingTime, getNodes, getNodePosition, setMode, getGroup } from './graph.js';
import { pulseAnchor } from './animate.js';
import { autoFrame, flyToNode, recenter, getCamera, getControls } from './camera.js';
import { INPUT_MAX, RECENT_MAX } from './constants.js';
import {
  showNumberLine, hideNumberLine, isNumberLineActive, startSequence,
  getMathDisplay, getPlayState, zoomToExtents, zoomToNumber,
  findLowestUnvisited, findHighestUnvisited, formatValue,
  setSpeed, getSpeed,
} from './numberline.js';

// ── DOM refs ─────────────────────────────────────────────
const input = document.getElementById('num-input');
const btnGo = document.getElementById('btn-go');
const fillInput = document.getElementById('fill-input');
const btnFill = document.getElementById('btn-fill');
const btnRecenter = document.getElementById('btn-recenter');
const recentList = document.getElementById('recent-list');
const tooltip = document.getElementById('tooltip');
const legend = document.getElementById('legend');
const stepInfo = document.getElementById('step-info');

const recentEntries = []; // { value, stoppingTime, li }
let numberLineMode = false; // module-level flag for numberline mode

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
    const n = parseInt(raw, 10);

    if (!raw || isNaN(n) || n < 1 || !Number.isInteger(Number(raw))) {
      showError('Enter a positive integer.');
      return;
    }

    // Number line mode: no upper limit, start sequence
    if (numberLineMode) {
      if (n === 1) { input.value = ''; return; }
      input.value = '';
      clearError();
      startSequence(n);
      return;
    }

    // Graph mode: enforce limit
    if (n > INPUT_MAX) {
      showError(`Keep it under ${INPUT_MAX.toLocaleString()} so the layout stays readable.`);
      return;
    }

    input.value = '';
    clearError();

    if (n === 1) {
      pulseAnchor();
      return;
    }

    const result = onSubmit(n);

    // Add to recent panel
    addRecent(n);

    // Show legend after first input
    legend.classList.remove('hidden');

    // Auto-frame after a short delay to let nodes spawn
    setTimeout(() => autoFrame(), 600);
  }

  btnGo.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    clearError();
  });

  // Fill 1–N
  const FILL_MAX = 500;
  const FILL_BATCH = 5;     // numbers added per tick
  const FILL_INTERVAL = 80; // ms between batches
  let fillTimer = null;

  function submitFill() {
    const raw = fillInput.value.trim();
    const n = parseInt(raw, 10);

    if (!raw || isNaN(n) || n < 2 || !Number.isInteger(Number(raw))) {
      showFillError('Enter an integer ≥ 2.');
      return;
    }
    if (n > FILL_MAX) {
      showFillError(`Keep it under ${FILL_MAX} for fill.`);
      return;
    }

    fillInput.value = '';
    clearFillError();
    btnFill.disabled = true;
    btnFill.textContent = '0%';
    legend.classList.remove('hidden');

    // Stagger additions in batches
    let current = 2;
    const total = n - 1; // 2 through n
    fillTimer = setInterval(() => {
      const end = Math.min(current + FILL_BATCH - 1, n);
      for (let i = current; i <= end; i++) {
        onSubmit(i);
      }
      current = end + 1;
      const pct = Math.round(((current - 2) / total) * 100);
      btnFill.textContent = `${Math.min(pct, 100)}%`;

      if (current > n) {
        clearInterval(fillTimer);
        fillTimer = null;
        btnFill.disabled = false;
        btnFill.textContent = 'Fill';
        addRecent(n);
        setTimeout(() => autoFrame(), 400);
      }
    }, FILL_INTERVAL);
  }

  btnFill.addEventListener('click', submitFill);
  fillInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitFill();
    clearFillError();
  });

  btnRecenter.addEventListener('click', () => recenter());

  // Menu toggle (hamburger)
  const modeSelector = document.getElementById('mode-selector');
  document.getElementById('btn-menu').addEventListener('click', () => {
    modeSelector.classList.toggle('collapsed');
  });

  // Mode selector
  const modeBtns = document.querySelectorAll('.mode-btn');
  const stoppingSubs = document.getElementById('stopping-subs');
  const subBtns = document.querySelectorAll('.sub-btn');
  const nlControls = document.getElementById('nl-controls');
  const mathBar = document.getElementById('math-bar');
  const graphGroup = getGroup();

  function enterNumberLine() {
    numberLineMode = true;
    showNumberLine();
    if (graphGroup) graphGroup.visible = false;
    nlControls.classList.remove('hidden');
    // Change input placeholder
    input.placeholder = 'Enter number';
  }

  function exitNumberLine() {
    numberLineMode = false;
    hideNumberLine();
    if (graphGroup) graphGroup.visible = true;
    nlControls.classList.add('hidden');
    mathBar.classList.add('hidden');
    input.placeholder = 'Try 27';
  }

  for (const btn of modeBtns) {
    btn.addEventListener('click', () => {
      for (const b of modeBtns) b.classList.remove('active');
      btn.classList.add('active');
      modeSelector.classList.add('collapsed'); // auto-close menu

      const mode = btn.dataset.mode;
      if (mode === 'numberline') {
        stoppingSubs.classList.add('hidden');
        enterNumberLine();
      } else {
        if (numberLineMode) exitNumberLine();
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

  // Collect all node meshes
  const meshes = [];
  for (const node of getNodes().values()) {
    meshes.push(node.mesh);
  }

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
