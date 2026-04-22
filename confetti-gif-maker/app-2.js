
// ── Mode & auto-fire ───────────────────────
let mode = 'bloom', afOn = false, afInterval = null, afRate = 2;

document.querySelectorAll('.mb').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mb').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    mode = btn.dataset.mode;
    if (afOn) { stopAF(); startAF(); }
  });
});

const afBtn   = document.getElementById('af-btn');
const rateRow = document.getElementById('rate-row');
const rateInp = document.getElementById('s_rate');
const rateVal = document.getElementById('v_rate');

afBtn.addEventListener('click', () => {
  afOn = !afOn;
  afBtn.textContent = (afOn ? '⏸' : '▶') + ' Auto-fire: ' + (afOn ? 'On' : 'Off');
  afBtn.classList.toggle('on', afOn);
  rateRow.classList.toggle('dim', !afOn);
  afOn ? startAF() : stopAF();
});
rateInp.addEventListener('input', () => {
  afRate = parseFloat(rateInp.value);
  rateVal.textContent = afRate.toFixed(1);
  if (afOn) { stopAF(); startAF(); }
});
function fireAuto() {
  const W = testArea.clientWidth, H = testArea.clientHeight;
  if (mode === 'rain') spawnRain();
  else if (mode === 'fountain') spawnFountain();
  else if (mode === 'bloom') spawnBloom(W / 2, H / 2);
  else burst(W*0.2+Math.random()*W*0.6, H*0.35+Math.random()*H*0.3);
}
function startAF() { stopAF(); fireAuto(); afInterval = setInterval(fireAuto, afRate*1000); }
function stopAF()  { clearInterval(afInterval); afInterval = null; }

// ── Launch interactions ────────────────────
const hint = document.getElementById('test-hint');
let hintGone = false;

function launch(x, y) {
  if (!hintGone) { hint.style.opacity = '0'; hintGone = true; }
  if (mode === 'rain') spawnRain();
  else if (mode === 'fountain') spawnFountain();
  else if (mode === 'bloom') spawnBloom(x, y);
  else burst(x, y);
}

testArea.addEventListener('click', e => {
  if (e.target.closest('#launch-center-btn')) return;
  const r = testArea.getBoundingClientRect();
  launch(e.clientX - r.left, e.clientY - r.top);
});

let dragging = false;
testArea.addEventListener('mousedown', e => { if (!e.target.closest('#launch-center-btn')) dragging = true; });
testArea.addEventListener('mousemove', e => {
  if (!dragging) return;
  const r = testArea.getBoundingClientRect();
  for (let i = 0; i < Math.max(2, Math.round(cfg.count * 0.06)); i++)
    particles.push(mkParticle(e.clientX - r.left, e.clientY - r.top));
  tick();
  if (!hintGone) { hint.style.opacity = '0'; hintGone = true; }
});
window.addEventListener('mouseup', () => dragging = false);

// ── Touch events (mobile Safari) ──────────────────
testArea.addEventListener('touchstart', e => {
  if (e.target.closest('#launch-center-btn')) return;
  e.preventDefault();
  dragging = true;
  const t = e.touches[0];
  const r = testArea.getBoundingClientRect();
  launch(t.clientX - r.left, t.clientY - r.top);
}, { passive: false });

testArea.addEventListener('touchmove', e => {
  if (!dragging) return;
  e.preventDefault();
  const t = e.touches[0];
  const r = testArea.getBoundingClientRect();
  for (let i = 0; i < Math.max(2, Math.round(cfg.count * 0.06)); i++)
    particles.push(mkParticle(t.clientX - r.left, t.clientY - r.top));
  tick();
  if (!hintGone) { hint.style.opacity = '0'; hintGone = true; }
}, { passive: false });

window.addEventListener('touchend', () => dragging = false);
window.addEventListener('touchcancel', () => dragging = false);

document.getElementById('launch-center-btn').addEventListener('click', () => {
  launch(testArea.clientWidth/2, testArea.clientHeight/2);
});
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    launch(testArea.clientWidth/2, testArea.clientHeight/2);
  }
});

// ── Presets ────────────────────────────────
const PRESETS = {
  default:   { count:115, spread:0,   vx:14, vy:16, vyMin:4, wind:0,   gravity:0.55, drag:1,     spin:0.30, fade:0.005, w:8,  h:6, sizeVar:0.5 },
  gentle:    { count:50,  spread:100, vx:4,  vy:7,  vyMin:2, wind:0.5, gravity:0.10, drag:0.990, spin:0.08, fade:0.003, w:6,  h:5, sizeVar:0.7 },
  fireworks: { count:200, spread:8,   vx:20, vy:24, vyMin:5, wind:0,   gravity:0.38, drag:0.980, spin:0.45, fade:0.007, w:6,  h:6, sizeVar:0.9 },
  blizzard:  { count:100, spread:180, vx:3,  vy:3,  vyMin:1, wind:1.2, gravity:0.06, drag:0.997, spin:0.05, fade:0.003, w:7,  h:7, sizeVar:0.6 },
  party:     { count:300, spread:80,  vx:16, vy:20, vyMin:6, wind:0,   gravity:0.28, drag:1,     spin:0.35, fade:0.004, w:10, h:8, sizeVar:0.5 },
  subtle:    { count:35,  spread:40,  vx:6,  vy:9,  vyMin:2, wind:0,   gravity:0.18, drag:0.990, spin:0.12, fade:0.009, w:5,  h:4, sizeVar:0.4 },
};
// ── Shared state helpers ──────────────────
function getCurrentState() {
  return {
    cfg: { ...cfg },
    colors: palette.map(c => ({ hex: c.hex, on: c.on })),
    custom: customPalette.map(c => ({ hex: c.hex, on: c.on })),
    shapes: [...activeShapes],
    mode: mode,
  };
}
function applyState(state) {
  suppressPreview = true;
  if (state.cfg) {
    Object.entries(state.cfg).forEach(([k,v]) => {
      const inp = document.getElementById('s_'+k);
      if (inp) { inp.value = v; inp.dispatchEvent(new Event('input')); }
    });
  }
  if (state.colors) {
    state.colors.forEach((c, i) => {
      if (!palette[i]) return;
      palette[i].hex = c.hex; palette[i].on = c.on;
      const el = swDefault.children[i];
      if (!el) return;
      el.style.background = c.hex;
      el.classList.toggle('on', c.on);
      el.classList.toggle('off', !c.on);
      const cinp = el.querySelector('input[type=color]');
      if (cinp) cinp.value = c.hex;
      const xb = el.querySelector('.swatch-x');
      if (xb) xb.style.display = (c.hex !== palette[i].orig) ? 'flex' : 'none';
    });
  }
  if (state.custom) {
    state.custom.forEach((c, i) => {
      if (!customPalette[i]) return;
      customPalette[i].hex = c.hex; customPalette[i].on = c.on;
      const slot = swCustom.children[i];
      if (!slot) return;
      if (c.hex) {
        slot.style.background = c.hex;
        slot.childNodes[0].textContent = '';
        slot.classList.add('has');
        slot.classList.toggle('on', c.on);
        slot.classList.toggle('off', !c.on);
        const cinp = slot.querySelector('input[type=color]');
        if (cinp) { cinp.value = c.hex; cinp.style.pointerEvents = 'none'; }
      } else {
        slot.style.background = '';
        slot.childNodes[0].textContent = '+';
        slot.classList.remove('has','on','off');
        const cinp = slot.querySelector('input[type=color]');
        if (cinp) cinp.style.pointerEvents = 'auto';
      }
    });
  }
  if (state.shapes) {
    activeShapes = [...state.shapes];
    document.querySelectorAll('.sb').forEach(btn => {
      btn.classList.toggle('on', activeShapes.includes(btn.dataset.shape));
    });
  }
  if (state.mode) {
    mode = state.mode;
    document.querySelectorAll('.mb').forEach(b => {
      b.classList.toggle('on', b.dataset.mode === mode);
    });
  }
  suppressPreview = false;
}

// ── Save/load custom presets ──────────────
const STORAGE_KEY = 'confetti-lab-presets';
function getSavedPresets() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveSavedPresets(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
function rebuildPresetDropdown() {
  const sel = document.getElementById('preset-sel');
  const old = sel.querySelector('optgroup');
  if (old) old.remove();
  const saved = getSavedPresets();
  if (!saved.length) return;
  const group = document.createElement('optgroup');
  group.label = 'Saved';
  saved.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = '__saved_' + i;
    opt.textContent = '⭐ ' + p.name;
    group.appendChild(opt);
  });
  sel.appendChild(group);
}
document.getElementById('save-preset-btn').addEventListener('click', () => {
  const name = prompt('Preset name:');
  if (!name || !name.trim()) return;
  const saved = getSavedPresets();
  saved.push({ name: name.trim(), state: getCurrentState() });
  saveSavedPresets(saved);
  rebuildPresetDropdown();
});

document.getElementById('preset-sel').addEventListener('change', e => {
  const val = e.target.value;
  if (!val) return;
  if (val.startsWith('__saved_')) {
    const idx = parseInt(val.replace('__saved_', ''));
    const saved = getSavedPresets();
    if (saved[idx]) applyState(saved[idx].state);
  } else {
    const p = PRESETS[val];
    if (!p) return;
    suppressPreview = true;
    Object.entries(p).forEach(([k,v]) => {
      const inp = document.getElementById('s_'+k);
      if (inp) { inp.value = v; inp.dispatchEvent(new Event('input')); }
    });
    suppressPreview = false;
  }
  e.target.value = '';
});

// Long-press on save button to delete a saved preset
let savePressTimer = null;
const saveBtn = document.getElementById('save-preset-btn');
saveBtn.addEventListener('pointerdown', () => {
  savePressTimer = setTimeout(() => {
    const saved = getSavedPresets();
    if (!saved.length) { alert('No saved presets to delete.'); return; }
    const names = saved.map((p, i) => (i + 1) + '. ' + p.name).join('\n');
    const idx = prompt('Delete which preset? Enter number:\n' + names);
    if (idx === null) return;
    const n = parseInt(idx) - 1;
    if (n >= 0 && n < saved.length) {
      saved.splice(n, 1);
      saveSavedPresets(saved);
      rebuildPresetDropdown();
    }
  }, 500);
});
saveBtn.addEventListener('pointerup', () => clearTimeout(savePressTimer));
saveBtn.addEventListener('pointerleave', () => clearTimeout(savePressTimer));

rebuildPresetDropdown();
