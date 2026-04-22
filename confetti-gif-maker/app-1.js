// ═══════════════════════════════════════════
//  Confetti GIF Maker — based on Confetti Lab
// ═══════════════════════════════════════════

const testArea = document.getElementById('test-area');
const canvas   = document.getElementById('c');
const ctx      = canvas.getContext('2d');
const pcEl     = document.getElementById('particle-count');

// ── Canvas resize ──────────────────────────
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const r   = testArea.getBoundingClientRect();
  canvas.width  = r.width  * dpr;
  canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);

// ── BG color ───────────────────────────────
document.getElementById('bg-color').addEventListener('input', e => {
  testArea.style.background = e.target.value;
});

// ── Default palette ────────────────────────
const PALETTE_HEX = [
  '#FF6B6B','#4ECDC4','#45B7D1','#FFEAA7','#DDA0DD',
  '#F7DC6F','#BB8FCE','#85C1E9','#F0B27A','#82E0AA'
];
const palette = PALETTE_HEX.map((hex, i) => ({ hex, orig: hex, on: true }));
const swDefault = document.getElementById('sw-default');
palette.forEach((c, i) => {
  const el = document.createElement('div');
  el.className = 'sw on';
  el.style.background = c.hex;

  // Color input inside swatch (for long-press edit)
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = c.hex;
  el.appendChild(inp);

  // Reset button (shows if color was changed from original)
  const xBtn = document.createElement('button');
  xBtn.className = 'swatch-x';
  xBtn.textContent = '↺';
  xBtn.title = 'Reset to original';
  el.appendChild(xBtn);

  function refresh() {
    el.style.background = c.hex;
    el.classList.toggle('on', c.on);
    el.classList.toggle('off', !c.on);
    inp.value = c.hex;
    xBtn.style.display = (c.hex !== c.orig) ? 'flex' : 'none';
  }

  // Tap = toggle on/off
  // Long-press = open color picker
  let pressTimer = null, didLongPress = false;
  el.addEventListener('pointerdown', e => {
    if (e.target === xBtn) return;
    didLongPress = false;
    pressTimer = setTimeout(() => { didLongPress = true; inp.click(); }, 500);
  });
  el.addEventListener('pointerup', e => {
    clearTimeout(pressTimer);
    if (e.target === xBtn) return;
    if (!didLongPress && e.target !== inp) {
      c.on = !c.on;
      refresh();
    }
  });
  el.addEventListener('pointerleave', () => clearTimeout(pressTimer));

  // Color changed via picker
  inp.addEventListener('input', () => {
    c.hex = inp.value;
    c.on = true;
    refresh();
  });

  // Reset to original
  xBtn.addEventListener('click', e => {
    e.stopPropagation();
    c.hex = c.orig;
    c.on = true;
    refresh();
  });

  swDefault.appendChild(el);
});

// ── Custom color slots (8) ─────────────────
const customPalette = Array.from({ length: 8 }, () => ({ hex: null, on: false }));
const swCustom = document.getElementById('sw-custom');

customPalette.forEach(c => {
  const slot = document.createElement('div');
  slot.className = 'cslot';

  const plus = document.createTextNode('+');
  slot.appendChild(plus);

  // Color input: fills the slot as invisible overlay
  // When slot is empty, pointer-events: auto (CSS handles this)
  // so tapping the slot directly opens the native picker
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = '#ff6b6b';
  slot.appendChild(inp);

  // Clear button
  const xBtn = document.createElement('button');
  xBtn.className = 'swatch-x';
  xBtn.textContent = '✕';
  xBtn.title = 'Clear color';
  slot.appendChild(xBtn);

  function refresh() {
    if (c.hex) {
      slot.style.background = c.hex;
      plus.textContent = '';
      slot.classList.add('has');
      slot.classList.toggle('on', c.on);
      slot.classList.toggle('off', !c.on);
      inp.value = c.hex;
      inp.style.pointerEvents = 'none';
    } else {
      slot.style.background = '';
      plus.textContent = '+';
      slot.classList.remove('has', 'on', 'off');
      inp.style.pointerEvents = 'auto';
    }
  }

  // Tap on filled slot = toggle on/off
  // Long-press on filled slot = edit color
  let pressTimer = null, didLongPress = false;
  slot.addEventListener('pointerdown', e => {
    if (e.target === xBtn || e.target === inp) return;
    if (!c.hex) return; // empty slots: input handles it
    didLongPress = false;
    pressTimer = setTimeout(() => { didLongPress = true; inp.click(); }, 500);
  });
  slot.addEventListener('pointerup', e => {
    clearTimeout(pressTimer);
    if (e.target === xBtn || e.target === inp) return;
    if (!c.hex) return;
    if (!didLongPress) {
      c.on = !c.on;
      refresh();
    }
  });
  slot.addEventListener('pointerleave', () => clearTimeout(pressTimer));

  // Color picked (new or edited)
  inp.addEventListener('input', () => {
    c.hex = inp.value;
    c.on = true;
    refresh();
  });

  // Clear slot
  xBtn.addEventListener('click', e => {
    e.stopPropagation();
    c.hex = null;
    c.on = false;
    refresh();
  });

  swCustom.appendChild(slot);
  refresh();
});

// ── Active colors ──────────────────────────
function getColors() {
  const a = [
    ...palette.filter(c => c.on).map(c => c.hex),
    ...customPalette.filter(c => c.hex && c.on).map(c => c.hex),
  ];
  return a.length ? a : PALETTE_HEX;
}

// ── Slider wiring ──────────────────────────
const DEFAULTS = {
  count:115, spread:0, vx:14, vy:16, vyMin:4,
  wind:0, gravity:0.55, drag:1, spin:0.3, fade:0.005,
  w:8, h:6, sizeVar:0.5,
};
const cfg = { ...DEFAULTS };

const FMT = {
  drag:    v => ((1 - parseFloat(v)) * 100).toFixed(0) + '%',
  sizeVar: v => (parseFloat(v) * 100).toFixed(0) + '%',
  wind:    v => parseFloat(v).toFixed(2),
  gravity: v => parseFloat(v).toFixed(2),
  fade:    v => parseFloat(v).toFixed(3),
  spin:    v => parseFloat(v).toFixed(2),
};
// ── Auto-preview on slider change ─────────
let previewTimer = null;
const autoPreviewCb = document.getElementById('auto-preview-cb');
if (localStorage.getItem('confetti-lab-autopreview') === 'off') autoPreviewCb.checked = false;
autoPreviewCb.addEventListener('change', () => {
  localStorage.setItem('confetti-lab-autopreview', autoPreviewCb.checked ? 'on' : 'off');
});
function schedulePreview() {
  if (!initDone || suppressPreview || !autoPreviewCb.checked) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const alive = particles.filter(p => p.alpha > 0).length;
    if (alive > 50) return;
    const W = testArea.clientWidth, H = testArea.clientHeight;
    const origCount = cfg.count;
    cfg.count = 18;
    if (mode === 'bloom') spawnBloom(W/2, H/2);
    else if (mode === 'rain') spawnRain();
    else if (mode === 'fountain') spawnFountain();
    else burst(W/2, H/2);
    cfg.count = origCount;
  }, 400);
}

let initDone = false, suppressPreview = false;
Object.keys(DEFAULTS).forEach(key => {
  const inp = document.getElementById('s_' + key);
  const val = document.getElementById('v_' + key);
  if (!inp || !val) return;
  const upd = () => { cfg[key] = parseFloat(inp.value); val.textContent = FMT[key] ? FMT[key](inp.value) : inp.value; schedulePreview(); };
  inp.addEventListener('input', upd);
  upd();
});
initDone = true;

// ── Shape selection ────────────────────────
let activeShapes = ['rect','circle','star'];
document.querySelectorAll('.sb').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('on');
    const on = [...document.querySelectorAll('.sb.on')].map(b => b.dataset.shape);
    activeShapes = on.length ? on : ['rect'];
  });
});

// ── Particles ─────────────────────────────
let particles = [], animId = null;

function mkParticle(x, y, ov = {}) {
  const vm = cfg.sizeVar, colors = getColors();
  return {
    x: x + (Math.random() - 0.5) * cfg.spread, y,
    vx: (Math.random() - 0.5) * cfg.vx,
    vy: -(Math.random() * cfg.vy + cfg.vyMin),
    w:  cfg.w * (1 - vm * 0.5) + Math.random() * cfg.w * vm,
    h:  cfg.h * (1 - vm * 0.5) + Math.random() * cfg.h * vm,
    color:    colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * Math.PI * 2,
    rv:       (Math.random() - 0.5) * cfg.spin,
    alpha:    1,
    shape:    activeShapes[Math.floor(Math.random() * activeShapes.length)],
    ...ov,
  };
}

function drawShape(p) {
  const hw = p.w / 2, hh = p.h / 2;
  ctx.fillStyle = p.color;
  switch (p.shape) {
    case 'rect':   ctx.fillRect(-hw,-hh,p.w,p.h); break;
    case 'circle': ctx.beginPath(); ctx.ellipse(0,0,hw,hh,0,0,Math.PI*2); ctx.fill(); break;
    case 'tri':    ctx.beginPath(); ctx.moveTo(0,-hh); ctx.lineTo(hw,hh); ctx.lineTo(-hw,hh); ctx.closePath(); ctx.fill(); break;
    case 'star': {
      const r = Math.max(hw,hh), ri = r * 0.38;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = i*Math.PI/5 - Math.PI/2, d = i%2===0 ? r : ri;
        i ? ctx.lineTo(Math.cos(a)*d, Math.sin(a)*d) : ctx.moveTo(Math.cos(a)*d, Math.sin(a)*d);
      }
      ctx.closePath(); ctx.fill(); break;
    }
    case 'line': { const l = Math.max(hw,hh)*2; ctx.fillRect(-l/2,-1.5,l,3); break; }
    default: ctx.fillRect(-hw,-hh,p.w,p.h);
  }
}

let fc = 0;
function animate() {
  const W = testArea.clientWidth, H = testArea.clientHeight;
  ctx.clearRect(0, 0, W, H);
  let alive = false;
  const { drag, gravity: grav, wind, fade } = cfg;
  for (const p of particles) {
    if (p._bloom) {
      p._age++;
      const t = Math.min(p._age / p._lifespan, 1);
      p.vx = (p.vx + wind * 0.01) * drag;
      p.vy = p.vy * drag;
      if (t > 0.55) {
        const dx = p._ox - p.x, dy = p._oy - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const pull = grav * 0.3 * Math.min((t - 0.55) / 0.45, 1);
        p.vx += (dx / dist) * pull;
        p.vy += (dy / dist) * pull;
      }
      let s;
      if (t < 0.3) {
        const e = t / 0.3;
        s = p._birthScale + (p._peakScale - p._birthScale) * (1 - (1 - e) * (1 - e));
      } else if (t < 0.65) {
        s = p._peakScale;
      } else {
        const e = (t - 0.65) / 0.35;
        s = p._peakScale + (p._endScale - p._peakScale) * e * e;
      }
      p.x += p.vx; p.y += p.vy;
      p.rotation += p.rv;
      p.alpha -= fade;
      if (p.alpha <= 0 || p.x < -80 || p.x > W + 80 || p.y < -80 || p.y > H + 80) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.scale(s, s);
      ctx.rotate(p.rotation);
      drawShape(p);
      ctx.restore();
    } else {
      p.vx = (p.vx + wind * 0.01) * drag;
      p.vy = p.vy * drag + grav;
      p.x += p.vx; p.y += p.vy;
      p.rotation += p.rv;
      p.alpha -= fade;
      if (p.alpha <= 0 || p.y > H + 80) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      drawShape(p);
      ctx.restore();
    }
  }
  if (++fc % 90 === 0) particles = particles.filter(p => p.alpha > 0 && p.x > -80 && p.x < W + 80 && p.y < H + 80 && p.y > -80);
  if (fc % 10 === 0) pcEl.textContent = 'particles: ' + particles.filter(p => p.alpha > 0).length;
  if (alive) { animId = requestAnimationFrame(animate); }
  else { particles = []; animId = null; pcEl.textContent = 'particles: 0'; ctx.clearRect(0,0,W,H); }
}
function tick() { if (!animId) animId = requestAnimationFrame(animate); }

function burst(x, y) {
  for (let i = 0; i < Math.round(cfg.count); i++) particles.push(mkParticle(x, y));
  tick();
}
function spawnRain() {
  const W = testArea.clientWidth;
  for (let i = 0; i < Math.max(5, Math.round(cfg.count * 0.12)); i++)
    particles.push(mkParticle(Math.random()*W, -12, { vy: Math.random()*3+1, vx: (Math.random()-.5)*cfg.vx*0.35 }));
  tick();
}
function spawnFountain() {
  const W = testArea.clientWidth, H = testArea.clientHeight;
  for (let i = 0; i < Math.max(5, Math.round(cfg.count * 0.1)); i++)
    particles.push(mkParticle(W/2+(Math.random()-.5)*40, H-10, {
      vx: (Math.random()-.5)*cfg.vx*0.5,
      vy: -(Math.random()*cfg.vy*0.75+cfg.vyMin),
    }));
  tick();
}
function spawnBloom(x, y) {
  for (let i = 0; i < Math.round(cfg.count); i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * cfg.vy + cfg.vyMin;
    const depth = 0.6 + Math.random() * 0.8;
    particles.push(mkParticle(x, y, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      _bloom: true,
      _ox: x, _oy: y,
      _age: 0,
      _lifespan: (1 / Math.max(cfg.fade, 0.001)),
      _depth: depth,
      _birthScale: 0.15 + depth * 0.1,
      _peakScale: 0.7 + depth * 0.55,
      _endScale: 0.25 + depth * 0.15,
    }));
  }
  tick();
}
