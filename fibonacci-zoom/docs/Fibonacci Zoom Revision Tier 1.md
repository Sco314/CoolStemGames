# Fibonacci Zoom Revision Tier 1

**Priority: HIGHEST — build these first.** These three features together fix the core pacing problem (233+ clicks per level becoming a chore) and establish the retention loop that keeps users coming back.

**Reference files in repo:**
- `fibonacci-zoom/index.html` — current app (all logic, styles, Firebase integration)
- `fibonacci-zoom/CLAUDE.md` — architecture, state object, key functions, conventions
- `fibonacci-zoom/README.md` — vision document (Scott's notes, pasted from Claude chat)

**Author:** Scott Sandvik · **Owner-facing philosophy:** clicker mechanism, Fibonacci substance. Every new number introduced by these features should itself be a Fibonacci value where possible.

---

## Feature 1 — Boost Tokens + Permanent Click Multipliers

### The problem this solves

Click costs in fib-steps mode follow F(n) exactly. By F(13)=233 the click cost is punishing; by F(15)=610 and F(16)=1597 the game stops being playable. We cannot reduce the Fibonacci cost without breaking the educational math. Instead, we reduce the *effective* clicks needed by giving each click a multiplier value earned through progression.

### Design

Boost Tokens are a persistent currency earned by committing new n levels. Players spend tokens on permanent upgrades that multiply their tick output per click. Multipliers stack multiplicatively.

**Token awards (granted in `commitN` on new high):**

| Condition | Tokens awarded |
|---|---|
| Each new high `|n| >= 3` | `Math.floor(Math.log(|n|) / Math.log(PHI))` → roughly 1 token per level, scaling gently |
| New high `|n| === 8, 13, 21, 34, 55, 89, 144` (milestones) | Bonus: F(milestone index) tokens (e.g., 5, 8, 13, 21, 34, 55, 89) |

Keep the formula simple and the early game generous. A player reaching F(13) for the first time should have roughly 50-80 tokens — enough to buy the first two upgrades.

**Upgrade catalog:**

```js
const BOOST_UPGRADES = [
  // id                  name              cost  tickMult  unlockAbsN  description
  { id: 'x2',            name: '×2 Click',           cost: 10,   tickMult: 2,     unlock: 3,  desc: 'Each click = 2 ticks' },
  { id: 'x3',            name: '×3 Click',           cost: 50,   tickMult: 1.5,  unlock: 5,  desc: 'Multiplies by another 1.5 (stacks with ×2 → ×3 total)' },
  { id: 'fingers',       name: 'Fibonacci Fingers',  cost: 100,  tickMult: 1.66, unlock: 8,  desc: 'Every 5th click earns F(5)=5 ticks' },
  { id: 'touch',         name: 'Golden Touch',       cost: 500,  tickMult: 2,    unlock: 13, desc: 'Every 13th click earns F(13)=233 ticks' },
  { id: 'phi',           name: 'The Phi Multiplier', cost: 2000, tickMult: PHI,  unlock: 21, desc: 'All clicks ×φ (≈1.618)' },
  { id: 'fermat',        name: "Fermat's Flourish",  cost: 5000, tickMult: 1.5,  unlock: 34, desc: 'Permanent ×1.5 on all output' },
  { id: 'golden_ratio',  name: 'Ratio Resonance',    cost: 13000,tickMult: PHI,  unlock: 55, desc: 'Another ×φ layer' },
];
```

Note on "Fibonacci Fingers" and "Golden Touch": these are **periodic bonuses**, not flat multipliers. Track a counter `clickCounter` that increments on every tick. When `clickCounter % 5 === 0` and Fingers is owned, add extra ticks. When `clickCounter % 13 === 0` and Golden Touch is owned, add extra ticks. Their listed `tickMult` values are the *average* effective multiplier for balance purposes — the actual reward is an occasional burst, which feels great.

### State changes needed

Add to `state` object in `index.html`:

```js
boostTokens: 0,              // current spendable balance
boostTokensLifetime: 0,      // total ever earned (for stats/achievements later)
boostUpgrades: {},           // { x2: true, x3: true, ... } — owned flag per upgrade id
clickCounter: 0,             // total clicks this session, for Fingers/Touch periodic bonuses
```

Add a computed multiplier function (pure — reads state, returns number):

```js
function clickMultiplier() {
  let mult = 1;
  for (const up of BOOST_UPGRADES) {
    if (state.boostUpgrades[up.id]) {
      // Periodic bonuses are NOT applied here — they trigger separately in tickInput
      if (up.id === 'fingers' || up.id === 'touch') continue;
      mult *= up.tickMult;
    }
  }
  return mult;
}
```

### Integration points in `tickInput(dir)`

Current `tickInput` does `state.subStep++` once per call. Replace with:

```js
function tickInput(dir) {
  if (celebrationAF) return;
  state.nlIndSign  = dir;
  state.nlIndAlpha = 1.0;
  state.clickCounter++;

  if (state.mode === 'standard') {
    commitN(state.n + dir);
    return;
  }

  // Fib-steps mode with multipliers
  if (dir !== state.stepDir) {
    state.stepDir = dir;
    state.subStep = 0;
  }

  // Compute ticks for THIS click
  let ticksThisClick = clickMultiplier();

  // Periodic bonuses
  if (state.boostUpgrades.fingers && state.clickCounter % 5 === 0) {
    ticksThisClick += 5;
    showPointsAnimation(lastInputX, lastInputY - 10, '+F(5)');
  }
  if (state.boostUpgrades.touch && state.clickCounter % 13 === 0) {
    ticksThisClick += 233;
    showPointsAnimation(lastInputX, lastInputY - 10, '+F(13)');
  }

  // Apply ticks, potentially advancing multiple levels in one click
  applyTicks(ticksThisClick);

  updateModeInfo();
  // ... existing confetti and smiley handling stays ...
}
```

And the new helper that handles multi-level advances in one click:

```js
// Apply `amount` ticks in fib-steps mode, crossing level boundaries if needed.
// Uses a loop with safety cap to prevent runaway advance at extreme multipliers.
function applyTicks(amount) {
  const SAFETY_CAP = 1000; // max level advances per single click
  let crossed = 0;
  while (amount > 0 && crossed < SAFETY_CAP) {
    const targetN = state.n + state.stepDir;
    const needed  = stepsForN(targetN);
    const remaining = needed - state.subStep;
    if (amount >= remaining) {
      amount -= remaining;
      state.subStep = 0;
      commitN(targetN);
      crossed++;
    } else {
      state.subStep += Math.floor(amount);
      amount = 0;
      // Scroll number line proportionally
      const progress = state.subStep / needed;
      const fromX = state._nlw / 2 - state.n * NL_CELL - NL_CELL / 2;
      const toX   = state._nlw / 2 - targetN * NL_CELL - NL_CELL / 2;
      state.nlWorldX = fromX + (toX - fromX) * progress;
      requestDrawSpiral();
      requestDrawNumberLine();
      debouncedSaveProgress();
    }
  }
  if (crossed >= SAFETY_CAP) {
    console.warn('⚠️  applyTicks hit safety cap — check multipliers');
  }
}
```

Update `bulkTick(dir, count)` to use the same pathway:

```js
function bulkTick(dir, count) {
  if (celebrationAF) return;
  // Power-ups (flower=5, smiley=1..55) bypass click multipliers —
  // their reward is already the Fibonacci value chosen at design time.
  // Apply directly without multiplication.
  if (dir !== state.stepDir) {
    state.stepDir = dir;
    state.subStep = 0;
  }
  applyTicks(count);
  updateModeInfo();
}
```

### Integration in `commitN`

Add token award after the high-water-mark update:

```js
function commitN(newN) {
  const oldHighest = state.highestAbsN;
  state.rotation += (Math.PI / 2) * (newN > state.n ? 1 : -1);
  state.n       = newN;
  state.subStep = 0;
  const isNewHigh = Math.abs(newN) > oldHighest;
  if (isNewHigh) {
    state.highestAbsN = Math.abs(newN);
    // ── NEW: award tokens ──
    awardBoostTokens(Math.abs(newN));
  }
  // ... rest of existing commitN unchanged ...
}

function awardBoostTokens(absN) {
  if (absN < 3) return; // no tokens for F(1), F(2)
  const base = Math.max(1, Math.floor(Math.log(absN) / Math.log(PHI)));
  const milestones = { 8: 5, 13: 8, 21: 13, 34: 21, 55: 34, 89: 55, 144: 89 };
  const bonus = milestones[absN] || 0;
  const total = base + bonus;
  state.boostTokens += total;
  state.boostTokensLifetime += total;
  updateTokenDisplay();
  if (total > 0) {
    showPointsAnimation(state._sw - 60, 40, `+${total} 🪙`);
  }
  console.log(`✅ Earned ${total} Boost Tokens (base ${base} + bonus ${bonus})`);
}
```

### UI — new "Boosts" card

Add a new card in the right sidebar between Account and Leaderboard (and in the mobile bottom sheet). HTML:

```html
<!-- Boosts card (desktop, inside .sidebar-right) -->
<div class="card" id="boostsCard">
  <div class="card-title">⚡ Boosts · <span id="tokenBalance">0</span> 🪙</div>
  <div id="boostsList"></div>
</div>
```

CSS (add to existing stylesheet):

```css
.boost-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(51,65,85,0.4);
  cursor: pointer;
  transition: background .15s;
}
.boost-row:last-child { border-bottom: none; }
.boost-row:hover:not(.boost-locked):not(.boost-owned) { background: rgba(245,166,35,0.08); }
.boost-row.boost-owned { opacity: 0.6; cursor: default; }
.boost-row.boost-owned .boost-cost::after { content: ' ✓'; color: #a8e6cf; }
.boost-row.boost-locked { opacity: 0.35; cursor: not-allowed; }
.boost-row.boost-unaffordable { cursor: not-allowed; }
.boost-row.boost-unaffordable .boost-cost { color: var(--red); }
.boost-name {
  flex: 1; font-size: 12px; color: var(--txt);
  font-weight: 600;
}
.boost-desc {
  font-size: 10px; color: var(--txt3);
  font-family: 'JetBrains Mono', monospace;
}
.boost-cost {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; color: var(--amber);
  font-weight: 600;
  flex-shrink: 0;
}
.boost-locked .boost-cost::before { content: '🔒 '; }
```

Render function:

```js
function renderBoosts() {
  const list = document.getElementById('boostsList');
  if (!list) return;
  const html = BOOST_UPGRADES.map(up => {
    const owned  = !!state.boostUpgrades[up.id];
    const locked = state.highestAbsN < up.unlock;
    const afford = state.boostTokens >= up.cost;
    let cls = 'boost-row';
    if (owned) cls += ' boost-owned';
    else if (locked) cls += ' boost-locked';
    else if (!afford) cls += ' boost-unaffordable';
    return `
      <div class="${cls}" data-boost="${up.id}">
        <div style="flex:1;min-width:0;">
          <div class="boost-name">${up.name}</div>
          <div class="boost-desc">${locked ? `Unlocks at F(${up.unlock})` : up.desc}</div>
        </div>
        <div class="boost-cost">${up.cost} 🪙</div>
      </div>`;
  }).join('');
  list.innerHTML = html;
  // Wire click handlers
  list.querySelectorAll('.boost-row').forEach(row => {
    row.addEventListener('click', () => buyBoost(row.dataset.boost));
  });
}

function buyBoost(id) {
  const up = BOOST_UPGRADES.find(u => u.id === id);
  if (!up) return;
  if (state.boostUpgrades[id]) return; // already owned
  if (state.highestAbsN < up.unlock)   { console.warn('⚠️  Boost locked'); return; }
  if (state.boostTokens < up.cost)     { console.warn('⚠️  Cannot afford'); return; }
  state.boostTokens -= up.cost;
  state.boostUpgrades[id] = true;
  console.log(`✅ Bought boost: ${up.name}`);
  renderBoosts();
  updateTokenDisplay();
  debouncedSaveProgress();
  // Firestore write (non-debounced — significant event)
  if (currentUser && fbDb) {
    fbDb.collection('scores').doc(currentUser.uid).set({
      boostTokens: state.boostTokens,
      boostUpgrades: state.boostUpgrades,
      boostTokensLifetime: state.boostTokensLifetime,
    }, { merge: true });
  }
}

function updateTokenDisplay() {
  const el = document.getElementById('tokenBalance');
  if (el) el.textContent = state.boostTokens;
  renderBoosts(); // re-render to update affordability colors
}
```

Call `renderBoosts()` once at boot (after `drawSpiral()`) and whenever `state.highestAbsN` or `state.boostTokens` change.

### Firestore persistence

Add three fields to the score document:

```js
boostTokens: state.boostTokens,
boostTokensLifetime: state.boostTokensLifetime,
boostUpgrades: state.boostUpgrades,
```

Write these in both `maybeSaveScore` and `saveProgress`. Read them in `onSignIn`:

```js
state.boostTokens         = data.boostTokens         ?? 0;
state.boostTokensLifetime = data.boostTokensLifetime ?? 0;
state.boostUpgrades       = data.boostUpgrades       ?? {};
```

### Backward compatibility

Existing users have no `boostTokens` field. The `?? 0` defaults handle this. Existing click behavior is preserved — a player with zero upgrades clicks exactly as they did before. No migration script needed.

### Testing checklist

- [ ] Start fresh, confirm 0 tokens displayed
- [ ] Reach F(3), confirm token award notification and balance update
- [ ] Reach F(8), confirm milestone bonus applied
- [ ] Buy ×2 Click, confirm subsequent clicks count as 2 ticks
- [ ] Buy ×2 + ×3, confirm clicks count as 3 ticks (2 × 1.5 = 3)
- [ ] Buy Fibonacci Fingers at F(8), click 5 times, confirm +5 tick bonus on 5th click
- [ ] Confirm locked boosts cannot be purchased
- [ ] Confirm unaffordable boosts show red cost
- [ ] Sign out and back in, confirm tokens and upgrades restored
- [ ] Confirm `applyTicks` advances multiple levels in one click if multipliers are high enough (e.g., test with artificially inflated multiplier at low n)

---

## Feature 2 — Auto-Clicker ("The Golden Ratio Engine")

### The problem this solves

Players who reach F(13)+ need a reason to leave the tab open without actively clicking. Auto-progress creates a "plant a seed, come back later" loop that every successful incremental game uses.

### Design

Unlocks at F(13) = 233 as a one-time purchase (not a boost upgrade — a gameplay system). Once owned, a ticker runs at `state._engine.rate` ticks per second, which grows as the player levels up and as they upgrade the engine.

**Base rate scaling:**
- Starts at 1 tick/sec when first bought
- Multiplied by φ each time player reaches a new Fibonacci milestone: F(14), F(15), F(16), ... F(21), F(34), etc.
- This means rate is naturally `φ^(levelsSincePurchase)`

**Engine upgrades** (purchased with Boost Tokens, listed in the same Boosts card or a new "Engine" card):

| id | name | cost | effect | unlock |
|---|---|---|---|---|
| `gears` | Golden Gears | 500 | +1 flat tick/sec | F(13) |
| `servos` | Spiral Servos | 2000 | Engine upgrades cost 50% less | F(14) |
| `interest` | Compound Interest | 8000 | Engine ticks also earn Boost Tokens (0.01/tick) | F(21) |
| `resonance` | Resonance Chamber | 34000 | Rate multiplier becomes φ² per milestone | F(34) |

### State changes

```js
engine: {
  owned:         false,
  rate:          0,        // computed each frame from upgrades + level
  upgrades:      {},       // { gears: true, servos: true, ... }
  accumulator:   0,        // fractional ticks pending
  lastTick:      0,        // performance.now() of last frame
  enabled:       true,     // user can toggle off temporarily
},
```

Put the engine under `state.engine` as its own sub-object for clean Firestore serialization.

### Implementation

One-time purchase button added to the Boosts card (or a new Engine card):

```html
<div class="card" id="engineCard" style="display:none;">
  <div class="card-title">⚙️ Golden Ratio Engine</div>
  <div id="engineStatus"></div>
  <div id="engineUpgrades"></div>
</div>
```

Render logic:

```js
function renderEngine() {
  const card = document.getElementById('engineCard');
  if (!card) return;
  // Show card only once unlock threshold reached
  if (state.highestAbsN < 13) { card.style.display = 'none'; return; }
  card.style.display = '';

  const status = document.getElementById('engineStatus');
  if (!state.engine.owned) {
    status.innerHTML = `
      <div class="boost-row" id="buyEngineBtn">
        <div style="flex:1">
          <div class="boost-name">Unlock the Engine</div>
          <div class="boost-desc">Auto-ticks while you play or idle</div>
        </div>
        <div class="boost-cost">1000 🪙</div>
      </div>`;
    document.getElementById('buyEngineBtn').addEventListener('click', buyEngine);
  } else {
    const rate = computeEngineRate();
    status.innerHTML = `
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--amber);padding:6px 0;">
        ${rate.toFixed(2)} ticks/sec
        <label style="float:right;">
          <input type="checkbox" id="engineToggle" ${state.engine.enabled?'checked':''}> on
        </label>
      </div>`;
    document.getElementById('engineToggle').addEventListener('change', e => {
      state.engine.enabled = e.target.checked;
      debouncedSaveProgress();
    });
    renderEngineUpgrades();
  }
}

function computeEngineRate() {
  if (!state.engine.owned) return 0;
  const MILESTONES = [13, 14, 15, 16, 17, 18, 19, 20, 21, 34, 55, 89, 144, 233];
  const levelsCrossed = MILESTONES.filter(m => state.highestAbsN >= m).length;
  const resonance = state.engine.upgrades.resonance ? PHI * PHI : PHI;
  let rate = Math.pow(resonance, levelsCrossed);
  if (state.engine.upgrades.gears) rate += 1;
  return rate;
}

function buyEngine() {
  if (state.engine.owned) return;
  if (state.boostTokens < 1000) { console.warn('⚠️  Not enough tokens'); return; }
  state.boostTokens -= 1000;
  state.engine.owned = true;
  state.engine.lastTick = performance.now();
  console.log('✅ Engine unlocked');
  renderEngine();
  updateTokenDisplay();
  startEngineLoop();
  debouncedSaveProgress();
}

let engineAF = null;
function startEngineLoop() {
  if (engineAF) return;
  function tick(now) {
    if (!state.engine.owned || !state.engine.enabled || celebrationAF) {
      engineAF = requestAnimationFrame(tick);
      return;
    }
    const dt = (now - state.engine.lastTick) / 1000;
    state.engine.lastTick = now;
    const rate = computeEngineRate();
    state.engine.accumulator += rate * dt;
    const whole = Math.floor(state.engine.accumulator);
    if (whole > 0) {
      state.engine.accumulator -= whole;
      // Engine ticks always go in positive direction
      if (state.stepDir !== 1) {
        state.stepDir = 1;
        state.subStep = 0;
      }
      applyTicks(whole);
      if (state.engine.upgrades.interest) {
        state.boostTokens += whole * 0.01;
        // Only update display when we cross a whole token
        if (Math.floor(state.boostTokens) !== Math.floor(state.boostTokens - whole*0.01)) {
          updateTokenDisplay();
        }
      }
    }
    engineAF = requestAnimationFrame(tick);
  }
  engineAF = requestAnimationFrame(tick);
}
```

### Engine upgrades render

Similar pattern to `renderBoosts`, just reading from a separate `ENGINE_UPGRADES` constant and gating on `state.highestAbsN` per unlock requirement.

### Firestore persistence

```js
engine: {
  owned: state.engine.owned,
  upgrades: state.engine.upgrades,
  enabled: state.engine.enabled,
  // accumulator and lastTick are NOT saved — ephemeral
},
```

### Idle note

The engine loop uses `requestAnimationFrame`, which pauses when the tab is inactive. This is fine for the active experience — Feature 3 (Offline Progress) will handle the "closed tab" case.

### Testing checklist

- [ ] Engine card hidden below F(13)
- [ ] Card appears at F(13) with buy button
- [ ] Buy requires and deducts 1000 tokens
- [ ] Rate increases on milestone crossings
- [ ] Toggle off halts auto-ticks
- [ ] Upgrades apply correctly
- [ ] Celebration zoom halts engine cleanly (no accumulator leak)

---

## Feature 3 — Offline Progress ("The Nautilus Sleeps")

### The problem this solves

Nothing pulls a user back to a web app like opening it and discovering a reward waiting. This is the single strongest retention mechanic in the genre.

### Design

While the tab is closed, Firestore stores the last-active timestamp and the engine rate at close. When the user returns, we compute offline ticks as `rate × min(elapsedSeconds, CAP)` where `CAP = 8 hours`. We show them a friendly "welcome back" modal with the banked ticks, and they tap "collect" to apply.

Offline progress requires the engine to be owned. No engine = no offline ticks (the user is on a click-only loop).

### State changes

Add to `state`:

```js
lastSeenAt:  0,   // performance.now() on each active frame — NOT used for offline (Firestore handles that)
```

In Firestore doc, add:

```js
offlineRateSnapshot: number,  // engine rate at time of last write
offlineSinceTs:      Timestamp, // when the engine went idle (tab close or last save)
```

### Implementation

**On each save (debounced saveProgress), update the offline anchor:**

```js
async function saveProgress() {
  if (!currentUser || !fbDb) return;
  try {
    await fbDb.collection('scores').doc(currentUser.uid).set({
      currentN:       state.n,
      currentSubStep: state.subStep,
      currentStepDir: state.stepDir,
      boostTokens:    state.boostTokens,
      boostTokensLifetime: state.boostTokensLifetime,
      boostUpgrades:  state.boostUpgrades,
      engine:         { owned: state.engine.owned, upgrades: state.engine.upgrades, enabled: state.engine.enabled },
      offlineRateSnapshot: state.engine.owned && state.engine.enabled ? computeEngineRate() : 0,
      offlineSinceTs: firebase.firestore.FieldValue.serverTimestamp(),
      displayName: currentUser.displayName || currentUser.email || 'Guest',
      photoURL:    currentUser.photoURL    || '',
      uid:         currentUser.uid,
      updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error('❌ Error saving progress:', err.message);
  }
}
```

**On sign-in, compute offline progress:**

In `onSignIn(user)`, after restoring state from the doc, add:

```js
// Offline progress computation
const OFFLINE_CAP_SECONDS = 8 * 3600; // 8 hours
const rate = data.offlineRateSnapshot ?? 0;
const sinceTs = data.offlineSinceTs;
if (rate > 0 && sinceTs && sinceTs.toMillis) {
  const elapsedSec = Math.max(0, (Date.now() - sinceTs.toMillis()) / 1000);
  const cappedSec  = Math.min(elapsedSec, OFFLINE_CAP_SECONDS);
  const ticks      = Math.floor(rate * cappedSec);
  if (ticks > 0) {
    showOfflineWelcomeModal(ticks, cappedSec, elapsedSec >= OFFLINE_CAP_SECONDS);
  }
}
```

**Welcome modal** (reuses existing overlay-backdrop pattern):

```html
<div class="overlay-backdrop" id="offlineModal">
  <div class="overlay-panel">
    <div class="overlay-title">🐚 The Nautilus Sleeps</div>
    <p style="color:var(--txt2);font-size:13px;line-height:1.5;margin-bottom:16px;">
      While you were away, the Golden Ratio Engine kept spiraling.
    </p>
    <div style="text-align:center;padding:20px;background:var(--bg2);border-radius:10px;margin-bottom:16px;">
      <div style="font-family:'JetBrains Mono',monospace;font-size:28px;color:var(--amber);font-weight:600;" id="offlineTicks">0</div>
      <div style="font-size:11px;color:var(--txt3);margin-top:4px;" id="offlineDuration">away for 0s</div>
    </div>
    <button class="btn btn-primary" id="collectOfflineBtn" style="width:100%;padding:12px;">Collect</button>
  </div>
</div>
```

```js
function showOfflineWelcomeModal(ticks, cappedSec, wasCapped) {
  document.getElementById('offlineTicks').textContent = fmt(BigInt(ticks)) + ' ticks';
  const hrs = Math.floor(cappedSec / 3600);
  const min = Math.floor((cappedSec % 3600) / 60);
  const durText = hrs > 0 ? `${hrs}h ${min}m` : `${min}m`;
  const capNote = wasCapped ? ' (capped at 8h)' : '';
  document.getElementById('offlineDuration').textContent = `away for ${durText}${capNote}`;
  document.getElementById('offlineModal').classList.add('open');
  document.getElementById('collectOfflineBtn').onclick = () => {
    document.getElementById('offlineModal').classList.remove('open');
    // Apply the ticks
    if (state.stepDir !== 1) { state.stepDir = 1; state.subStep = 0; }
    applyTicks(ticks);
    console.log(`✅ Collected ${ticks} offline ticks`);
  };
}
```

### Saving on tab close

Browser `visibilitychange` and `beforeunload` events are unreliable, but we can best-effort write the timestamp:

```js
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && currentUser) {
    saveProgress(); // flush immediately
  }
});
```

The debounced save already fires every 2 seconds during activity, so the `offlineSinceTs` is always reasonably fresh.

### Security note

Offline ticks rely on the client clock and Firestore server timestamp. A malicious user could manipulate their local clock to claim more offline time — but since Firestore writes the server timestamp, the computation `Date.now() - sinceTs.toMillis()` is bounded by how far out their local clock is skewed. Cap at 8 hours prevents pathological cases. For a teacher tool, this is acceptable — no need for server-side validation.

### Testing checklist

- [ ] No engine owned → no offline modal on sign-in
- [ ] Engine owned, close tab, wait 1 min, reopen → modal shows with small tick count
- [ ] Simulate 9-hour absence (manually adjust sinceTs in Firestore console) → modal caps at 8h
- [ ] Collect button applies ticks correctly
- [ ] Modal does not appear on page refresh within a few seconds (below threshold of meaningful rate × time)
- [ ] Signing out and back in quickly does not double-award

---

## Order of implementation

Do these in strict order. Each depends on the previous.

1. **Boost Tokens + multipliers** — adds the currency, `applyTicks`, and the Boosts UI card. Test thoroughly. Ship.
2. **Auto-Clicker** — adds `state.engine`, the engine loop, the Engine card. Requires `applyTicks` from step 1.
3. **Offline Progress** — adds the modal, the offline computation on sign-in, the visibility listener. Requires `state.engine` and `applyTicks`.

Commit each feature separately with a clear message so rollback is possible. Test in an incognito window (fresh user) between features to confirm new-user flow still works end-to-end.

---

## Integration notes for Claude Code

- All three features write to Firestore. Make sure the security rule in `README.md` still allows these writes (it does — `scores/{uid}` is wide-open for that UID's own writes).
- All three features respect the existing `debouncedSaveProgress` pattern. Do not add synchronous writes in hot loops (engine, click handlers).
- `applyTicks` is the new canonical entry point for mass tick application. After this refactor, `tickInput`, `bulkTick`, engine loop, and offline collection all funnel through it.
- Honor the style conventions in `CLAUDE.md`: 2-space indent, `✅/❌/⚠️` console prefixes, no bundler, single file.
- Do NOT touch `buildSquares`, `arcParams`, the transform order, or the Fibonacci math. These features are all layered on top of the existing simulation.
- Add a version comment to the HTML header noting these features shipped, e.g., `<!-- v2.0 — Tier 1: Boosts + Engine + Offline -->`. Maintain the changelog convention.

When these three features ship, the game has fundamentally different pacing: a player can reach F(21) and beyond in a single session, leave for lunch, come back to banked progress, and keep climbing. That's the loop that makes them come back tomorrow.
