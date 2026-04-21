# Fibonacci Zoom Revision Tier 2

**Priority: HIGH — build these after Tier 1 ships and is stable.** Tier 1 fixed the core pacing problem and retention loop. Tier 2 is about identity, pride, and personalization — the reasons a player logs in tomorrow and the next day, and the reasons they tell their friend about this game.

**Reference files in repo:**
- `fibonacci-zoom/index.html` — current app
- `fibonacci-zoom/CLAUDE.md` — architecture, state object, key functions, conventions
- `fibonacci-zoom/README.md` — vision document
- `fibonacci-zoom/Fibonacci Zoom Revision Tier 1.md` — Boost Tokens, Engine, Offline Progress (must ship first)

**Dependencies from Tier 1:**
- `state.boostTokens` and `applyTicks()` must exist before Feature 4 (Daily Streak rewards reference both)
- Firestore `scores/{uid}` schema should already include `boostTokens`, `boostUpgrades`, `engine`, `offlineSinceTs`

---

## Feature 4 — Daily Streak with Fibonacci Rewards

### The problem this solves

Today's session ends. Why come back tomorrow? Without a daily hook, a player who reached F(13) on Monday has no reason to open the tab on Tuesday. Streaks are the single most effective "come back tomorrow" mechanism in every mobile/casual game ever shipped.

The twist that makes ours special: **the streak reward schedule IS the Fibonacci sequence.** A student who plays 7 days in a row has physically felt F(1) through F(13) in their gut, as rewards, before they could ever tell you what Fibonacci was. That's the incidental learning we're after.

### Design

- A "day" is defined by the user's local calendar date (not 24-hour rolling windows — this is more forgiving and matches user intuition).
- Each new calendar day, the first sign-in (or first active session if already signed in) advances the streak counter.
- Missing a day resets the streak to 1 — **unless** the user has a Freeze available. Every player gets 1 Freeze automatically restored per week.
- The streak reward schedule uses the Fibonacci sequence itself as the token bonus:

| Streak day | Reward | Why this number |
|---|---|---|
| 1 | +1 🪙 | F(1) |
| 2 | +1 🪙 | F(2) |
| 3 | +2 🪙 | F(3) |
| 4 | +3 🪙 | F(4) |
| 5 | +5 🪙 | F(5) |
| 6 | +8 🪙 | F(6) |
| 7 | +13 🪙 | F(7) |
| 8 | +21 🪙 | F(8) |
| 9 | +34 🪙 | F(9) |
| 10 | +55 🪙 | F(10) |
| 11 | +89 🪙 | F(11) |
| 12 | +144 🪙 | F(12) |
| 13 | +233 🪙 | F(13) |
| 14+ | +F(14) = 377 (caps here) | no runaway inflation |

On the 13th day specifically, also grant a visual celebration: a full-screen spiral animation with confetti, and a one-time permanent cosmetic badge.

### State changes

Add to `state`:

```js
streak: {
  count:         0,           // consecutive days, current
  longestCount:  0,           // personal best
  lastDateStr:   '',          // YYYY-MM-DD of last rewarded day (local)
  freezesLeft:   1,           // freezes available to skip a missed day
  lastFreezeRestoreWk: '',    // ISO week string of last freeze restore
  todayClaimed:  false,       // derived each session; not persisted
},
```

All fields except `todayClaimed` persist to Firestore.

### Helpers

```js
// Local YYYY-MM-DD string — stable across timezones for a given user
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ISO week string for weekly freeze restore (e.g., "2026-W17")
function isoWeekStr(d = new Date()) {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  const wk = 1 + Math.ceil((firstThursday - target) / 604800000);
  return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`;
}

// Days between two YYYY-MM-DD strings (local dates, inclusive of DST transitions)
function daysBetween(a, b) {
  const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
  return Math.round((parse(b) - parse(a)) / 86400000);
}

// The reward for a given streak day number
function streakReward(dayNum) {
  const capped = Math.min(dayNum, 14);
  return Number(fibPos(capped));
}
```

### Streak evaluation

Runs once on sign-in, after Firestore data loads, after offline progress modal (so the claim doesn't stack visually):

```js
function evaluateStreak() {
  const today = localDateStr();
  const thisWeek = isoWeekStr();

  // Weekly freeze restore — once per ISO week, back to 1 (never accumulates past 1)
  if (state.streak.lastFreezeRestoreWk !== thisWeek) {
    state.streak.freezesLeft = Math.max(state.streak.freezesLeft, 1);
    state.streak.lastFreezeRestoreWk = thisWeek;
  }

  // First-ever claim
  if (!state.streak.lastDateStr) {
    state.streak.count = 1;
    state.streak.lastDateStr = today;
    state.streak.longestCount = Math.max(state.streak.longestCount, 1);
    state.streak.todayClaimed = false; // not yet claimed — show claim modal
    showStreakClaimModal();
    return;
  }

  const gap = daysBetween(state.streak.lastDateStr, today);

  if (gap === 0) {
    // Same day — already claimed today
    state.streak.todayClaimed = true;
    return;
  }

  if (gap === 1) {
    // Consecutive day — continue streak
    state.streak.count++;
    state.streak.lastDateStr = today;
    state.streak.longestCount = Math.max(state.streak.longestCount, state.streak.count);
    state.streak.todayClaimed = false;
    showStreakClaimModal();
    return;
  }

  if (gap === 2 && state.streak.freezesLeft > 0) {
    // Used a freeze to bridge a missed day
    state.streak.freezesLeft--;
    state.streak.count++;
    state.streak.lastDateStr = today;
    state.streak.longestCount = Math.max(state.streak.longestCount, state.streak.count);
    state.streak.todayClaimed = false;
    console.log('✅ Freeze used — streak preserved');
    showStreakClaimModal(/* freezeUsed */ true);
    return;
  }

  // Gap too large — streak resets
  console.log(`⚠️  Streak broken (gap of ${gap} days) — resetting`);
  state.streak.count = 1;
  state.streak.lastDateStr = today;
  state.streak.todayClaimed = false;
  showStreakClaimModal(/* freezeUsed */ false, /* wasReset */ true);
}
```

### Claim modal

Reuses the overlay-backdrop pattern:

```html
<div class="overlay-backdrop" id="streakModal">
  <div class="overlay-panel">
    <div class="overlay-title">🔥 Daily Streak</div>
    <div id="streakModalBody"></div>
    <button class="btn btn-primary" id="streakClaimBtn" style="width:100%;padding:12px;margin-top:16px;">Claim</button>
  </div>
</div>
```

```js
function showStreakClaimModal(freezeUsed = false, wasReset = false) {
  const reward = streakReward(state.streak.count);
  const body = document.getElementById('streakModalBody');

  let html = '';
  if (wasReset) {
    html += `<p style="color:var(--red);font-size:12px;margin-bottom:12px;">Your streak reset. Welcome back — let's start a new one!</p>`;
  }
  if (freezeUsed) {
    html += `<p style="color:var(--teal);font-size:12px;margin-bottom:12px;">❄️ Freeze used — your streak is safe.</p>`;
  }

  html += `
    <div style="text-align:center;padding:20px;background:var(--bg2);border-radius:10px;margin-bottom:16px;">
      <div style="font-size:12px;color:var(--txt3);font-family:'JetBrains Mono',monospace;">Day</div>
      <div style="font-size:44px;color:var(--amber);font-weight:700;font-family:'Cormorant Garamond',serif;">${state.streak.count}</div>
      <div style="font-size:12px;color:var(--txt3);font-family:'JetBrains Mono',monospace;margin-top:6px;">F(${Math.min(state.streak.count, 14)}) = ${reward}</div>
      <div style="font-size:28px;color:var(--amber);font-weight:600;font-family:'JetBrains Mono',monospace;margin-top:10px;">+${reward} 🪙</div>
    </div>
    <div style="font-size:11px;color:var(--txt3);font-family:'JetBrains Mono',monospace;text-align:center;">
      Freezes: ${'❄️'.repeat(state.streak.freezesLeft)}${state.streak.freezesLeft === 0 ? '—' : ''}
      &nbsp;·&nbsp;
      Longest: ${state.streak.longestCount}
    </div>`;

  body.innerHTML = html;
  document.getElementById('streakModal').classList.add('open');

  document.getElementById('streakClaimBtn').onclick = () => {
    document.getElementById('streakModal').classList.remove('open');
    state.boostTokens += reward;
    state.boostTokensLifetime += reward;
    state.streak.todayClaimed = true;
    updateTokenDisplay();
    saveProgress(); // immediate write, not debounced
    console.log(`✅ Claimed streak day ${state.streak.count}: +${reward} tokens`);

    // Day 13 celebration
    if (state.streak.count === 13) {
      playStreak13Celebration();
    }
  };
}

function playStreak13Celebration() {
  // Reuse confetti system at maximum intensity
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      launchConfetti(state._sw / 2, state._sh / 2, 150);
    }, i * 400);
  }
  // Grant permanent "Phi Disciple" cosmetic badge (see Achievements feature 5)
  if (!state.achievements.phiDisciple) {
    state.achievements.phiDisciple = Date.now();
    saveProgress();
  }
}
```

### Streak indicator in the UI

Small badge in the top-bar or Account card showing current streak count. Add after the title in `.top-bar`:

```html
<div class="streak-badge" id="streakBadge" title="Daily streak">
  🔥 <span id="streakCount">0</span>
</div>
```

```css
.streak-badge {
  position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; gap: 4px;
  background: var(--card); border: 1px solid var(--border);
  border-radius: 8px; padding: 6px 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px; font-weight: 600; color: var(--amber);
  cursor: pointer; transition: all .2s;
}
.streak-badge:hover { border-color: var(--amber); }
.streak-badge.streak-zero { color: var(--txt3); }

@media (max-width: 640px) {
  .streak-badge { font-size: 11px; padding: 4px 8px; }
}
```

```js
function updateStreakBadge() {
  const badge = document.getElementById('streakBadge');
  const count = document.getElementById('streakCount');
  if (!badge || !count) return;
  count.textContent = state.streak.count;
  badge.classList.toggle('streak-zero', state.streak.count === 0);
}

// Click the badge to show a read-only streak info card
document.getElementById('streakBadge').addEventListener('click', () => {
  // Re-show the modal in info mode (no claim button) — easy pattern,
  // just set todayClaimed=true display without mutating state
  showStreakInfoModal();
});
```

### Firestore persistence

Add to `saveProgress`:

```js
streak: {
  count:         state.streak.count,
  longestCount:  state.streak.longestCount,
  lastDateStr:   state.streak.lastDateStr,
  freezesLeft:   state.streak.freezesLeft,
  lastFreezeRestoreWk: state.streak.lastFreezeRestoreWk,
},
```

In `onSignIn`:

```js
if (data.streak) {
  state.streak.count         = data.streak.count         ?? 0;
  state.streak.longestCount  = data.streak.longestCount  ?? 0;
  state.streak.lastDateStr   = data.streak.lastDateStr   ?? '';
  state.streak.freezesLeft   = data.streak.freezesLeft   ?? 1;
  state.streak.lastFreezeRestoreWk = data.streak.lastFreezeRestoreWk ?? '';
}
// Evaluate AFTER offline progress modal dismisses, to avoid stacked overlays
```

### Ordering on sign-in

Two modals may want to appear: offline-progress (from Tier 1) and streak-claim. Sequence them:

```js
// In onSignIn, after data loads:
const showOffline = /* ... tier 1 logic ... */;
if (showOffline) {
  // Modify showOfflineWelcomeModal collect handler to also call evaluateStreak()
  // at the end instead of calling it directly here.
} else {
  evaluateStreak();
}
```

### Anonymous users

Streaks work for anonymous users too — their UID persists across reloads via Firebase IndexedDB. If an anonymous user signs up for Google mid-streak (account linking), their streak data is preserved automatically because the Firestore doc keys on UID which is retained through linking. No special handling needed.

### Testing checklist

- [ ] New user signs in, sees day-1 claim modal with +1 token
- [ ] Claim grants +1 token, badge updates to 🔥 1
- [ ] Close and reopen same day — no new modal
- [ ] Manually advance `state.streak.lastDateStr` back by 1 day in console, reload — day-2 modal shows with +1 token
- [ ] Manually advance back by 2 days, reload — freeze used, modal shows "❄️ Freeze used", streak continues
- [ ] Manually advance back by 3 days with 0 freezes, reload — streak resets to 1
- [ ] Click streak badge — info modal shows without re-claiming
- [ ] Reach streak day 13 — celebration fires, Phi Disciple achievement unlocks
- [ ] Streak day 15 capped at F(14) = 377 tokens

---

## Feature 5 — Achievements System

### The problem this solves

Players need **collectible identity markers** they can point to and say "I got this." Achievements turn discrete gameplay events into persistent trophies. They're cheap to build (just flags and UI) and enormous for retention and sharing.

The twist: every achievement includes a **"Did you know?" fact** about where that Fibonacci number shows up in nature, mathematics, or culture. This is the incidental learning channel — kids absorb context without being quizzed.

### Design

An achievement is a `{ id, emblem, title, condition, fact, unlockedAt }` record. The unlock condition is evaluated automatically after each relevant state change. Unlocked achievements are displayed in a new Achievements modal accessible from the settings or from a dedicated icon.

### The catalog

```js
const ACHIEVEMENTS = [
  // Early progression
  { id: 'sprout',      emblem: '🌱', title: 'Sprout',         unlock: 'reach F(3)',
    fact: 'A tree branches in Fibonacci patterns — one trunk splits into two, then three branches, then five. This is how trees maximize sunlight.' },
  { id: 'sunflower',   emblem: '🌻', title: 'Sunflower',      unlock: 'reach F(8)',
    fact: 'Real sunflower heads have 21 spirals in one direction and 34 in the other — always consecutive Fibonacci numbers. This packs seeds most efficiently.' },
  { id: 'nautilus',    emblem: '🐚', title: 'Nautilus',       unlock: 'reach F(13)',
    fact: 'The nautilus shell grows each chamber φ times larger than the last. This exact proportion appears in ferns, shells, and galaxies.' },
  { id: 'hurricane',   emblem: '🌀', title: 'Hurricane',      unlock: 'reach F(21)',
    fact: 'Hurricane arms are logarithmic spirals — the same mathematical shape the Fibonacci spiral converges to. The closer you look, the more repeats.' },
  { id: 'galaxy',      emblem: '🌌', title: 'Galaxy',         unlock: 'reach F(34)',
    fact: 'Spiral galaxies like the Milky Way have arms that follow logarithmic spirals. At galactic scale, φ still shows up.' },
  { id: 'phi_master',  emblem: 'φ',  title: 'Phi Master',     unlock: 'reach F(55)',
    fact: 'φ = (1 + √5) / 2 ≈ 1.6180339887. It appears in human anatomy, the Parthenon, and Da Vinci paintings.' },
  { id: 'transcendent',emblem: '∞',  title: 'Transcendent',   unlock: 'reach F(89)',
    fact: 'F(89) = 1,134,903,170. In 10 more steps F(99) surpasses the number of atoms in a human body. Growth is not linear.' },

  // Negative exploration
  { id: 'mirror',      emblem: '🪞', title: 'Through the Mirror', unlock: 'reach F(-5)',
    fact: 'Negafibonacci numbers follow F(-n) = (-1)^(n+1) · F(n). The sequence extends infinitely backward, alternating sign.' },
  { id: 'antimatter',  emblem: '⚛️', title: 'Antimatter',      unlock: 'reach F(-13)',
    fact: 'Going backward in the Fibonacci sequence matches going forward in a mirrored universe — a pattern physicists call CPT symmetry.' },

  // Engagement
  { id: 'first_boost', emblem: '⚡', title: 'First Boost',     unlock: 'buy any boost upgrade',
    fact: 'Compounding multipliers turn linear effort into exponential progress. This is how money in an investment account grows — and how your clicks work now.' },
  { id: 'engine',      emblem: '⚙️', title: 'Autonomous',     unlock: 'buy the Golden Ratio Engine',
    fact: 'Automation is how humans turned the industrial revolution into the information age. Your spiral now grows on its own.' },
  { id: 'phi_disciple',emblem: '🔥', title: 'Phi Disciple',   unlock: '13-day streak',
    fact: 'You played 13 days in a row — F(7). Your persistence matches the sequence itself.' },
  { id: 'dedicated',   emblem: '📅', title: 'Dedicated',      unlock: '34-day streak',
    fact: 'Thirty-four days — F(9). Most players stop by day 7. You are in rare company.' },

  // Oddities
  { id: 'zero',        emblem: '⚪', title: 'The Zero Point',  unlock: 'reach n=0',
    fact: 'F(0) = 0. The sequence starts here — the void from which everything grows.' },
  { id: 'explorer',    emblem: '🧭', title: 'Free Explorer',   unlock: 'drag the number line to five different n values',
    fact: 'Mathematicians often play with numbers just to see what happens. Curiosity is how discovery starts.' },
  { id: 'collector',   emblem: '🏆', title: 'Completionist',  unlock: 'unlock all other achievements',
    fact: 'Every shape in nature is a compromise between growth and space. Same with achievements — you claimed them all.' },
];
```

### State changes

Add to `state`:

```js
achievements: {},  // { sprout: 1718390400000, nautilus: 1718390500000, ... } — unlockedAt timestamps
```

### Condition-check function

Called from multiple integration points. Takes the event context and evaluates all achievements whose condition might now be true:

```js
function checkAchievements() {
  const unlocks = [];

  const has = id => !!state.achievements[id];
  const unlock = id => {
    if (has(id)) return;
    state.achievements[id] = Date.now();
    unlocks.push(id);
  };

  // Progression
  if (state.highestAbsN >= 3)  unlock('sprout');
  if (state.highestAbsN >= 8)  unlock('sunflower');
  if (state.highestAbsN >= 13) unlock('nautilus');
  if (state.highestAbsN >= 21) unlock('hurricane');
  if (state.highestAbsN >= 34) unlock('galaxy');
  if (state.highestAbsN >= 55) unlock('phi_master');
  if (state.highestAbsN >= 89) unlock('transcendent');

  // Negative — track separately in a min-tracked field
  if (state._minNReached !== undefined) {
    if (state._minNReached <= -5)  unlock('mirror');
    if (state._minNReached <= -13) unlock('antimatter');
  }

  // Boost-related
  if (Object.keys(state.boostUpgrades).length >= 1) unlock('first_boost');
  if (state.engine && state.engine.owned) unlock('engine');

  // Streak
  if (state.streak.longestCount >= 13) unlock('phi_disciple');
  if (state.streak.longestCount >= 34) unlock('dedicated');

  // Special
  if (state.n === 0 || state._zeroVisited) unlock('zero');
  if ((state._dragExploredNs || new Set()).size >= 5) unlock('explorer');

  // Completionist — all OTHER achievements owned
  const others = ACHIEVEMENTS.filter(a => a.id !== 'collector');
  if (others.every(a => has(a.id))) unlock('collector');

  // Fire unlock notifications
  unlocks.forEach(id => showAchievementToast(id));
  if (unlocks.length > 0) saveProgress();
}
```

Add ancillary state for special achievements:

```js
_minNReached:    1,                 // tracks lowest n ever reached
_zeroVisited:    false,             // tracked the moment n === 0
_dragExploredNs: new Set(),         // unique n values reached via drag (for explorer)
```

These do NOT persist to Firestore directly — they're derived/transient. `_minNReached` could be persisted if desired, but `state.highestAbsN` alongside tracking the furthest negative `n` is cleaner. Simplify by adding a `state.lowestN` field instead (analog to `highestAbsN`) and persisting it.

### Integration points

In `commitN`, after updating `highestAbsN`:

```js
if (newN < (state.lowestN ?? 1)) state.lowestN = newN;
if (newN === 0) state._zeroVisited = true;
checkAchievements();
```

In `buyBoost` (Tier 1), after marking the upgrade owned:

```js
checkAchievements();
```

In `buyEngine` (Tier 1), after marking owned:

```js
checkAchievements();
```

In `evaluateStreak` (Feature 4), after updating `longestCount`:

```js
checkAchievements();
```

In the number line drag handlers (mousemove and touchmove), after `if (centN !== state.n)`:

```js
if (!state._dragExploredNs) state._dragExploredNs = new Set();
state._dragExploredNs.add(centN);
// Debounce the achievement check so we don't hammer it
if (state._dragExploredNs.size >= 5) checkAchievements();
```

### Achievement toast

A brief notification that appears in the corner when an achievement unlocks. Stacks if multiple fire at once.

```html
<div id="achievementToasts" style="position:fixed;top:80px;right:20px;z-index:200;display:flex;flex-direction:column;gap:8px;pointer-events:none;"></div>
```

```css
.achievement-toast {
  background: #111827;
  border: 1px solid var(--amber);
  border-radius: 10px;
  padding: 12px 16px;
  display: flex; align-items: center; gap: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  animation: toastSlide 5s ease-in-out forwards;
  min-width: 240px; max-width: 320px;
  pointer-events: auto; cursor: pointer;
}
.achievement-toast .emblem {
  font-size: 28px; line-height: 1; flex-shrink: 0;
}
.achievement-toast .ach-title {
  font-size: 13px; color: var(--txt); font-weight: 600;
}
.achievement-toast .ach-label {
  font-size: 10px; color: var(--amber);
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: .1em; text-transform: uppercase;
}
@keyframes toastSlide {
  0%   { transform: translateX(120%); opacity: 0; }
  10%  { transform: translateX(0); opacity: 1; }
  85%  { transform: translateX(0); opacity: 1; }
  100% { transform: translateX(120%); opacity: 0; }
}
```

```js
function showAchievementToast(achievementId) {
  const ach = ACHIEVEMENTS.find(a => a.id === achievementId);
  if (!ach) return;
  const container = document.getElementById('achievementToasts');
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `
    <div class="emblem">${ach.emblem}</div>
    <div>
      <div class="ach-label">Achievement unlocked</div>
      <div class="ach-title">${ach.title}</div>
    </div>`;
  toast.addEventListener('click', () => {
    toast.remove();
    openAchievementsModal(achievementId); // scroll to this achievement
  });
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5100);
  console.log(`✅ Achievement unlocked: ${ach.title}`);
}
```

### Achievements modal

A browsable gallery accessible from the settings panel (add a new row) or a dedicated icon in the top bar. Recommend: add a trophy icon button in `.top-bar-right`.

```html
<button class="icon-btn" id="achievementsBtn" title="Achievements">🏆</button>

<div class="overlay-backdrop" id="achievementsOverlay">
  <div class="overlay-panel" style="width: 480px; max-width: 94vw;">
    <button class="overlay-close" id="achievementsClose">✕</button>
    <div class="overlay-title">🏆 Achievements · <span id="achievementsCount">0</span> / ${ACHIEVEMENTS.length}</div>
    <div id="achievementsGrid"></div>
  </div>
</div>
```

```css
.ach-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.ach-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 10px;
  text-align: center;
  cursor: pointer;
  transition: all .2s;
}
.ach-card:hover:not(.ach-locked) { border-color: var(--amber); transform: translateY(-2px); }
.ach-card.ach-locked { opacity: 0.35; cursor: default; }
.ach-card .emblem { font-size: 34px; line-height: 1; margin-bottom: 8px; }
.ach-card.ach-locked .emblem { filter: grayscale(1); }
.ach-card .ach-title {
  font-size: 12px; color: var(--txt); font-weight: 600;
  margin-bottom: 4px;
}
.ach-card .ach-unlock {
  font-size: 9px; color: var(--txt3);
  font-family: 'JetBrains Mono', monospace;
}

.ach-fact-overlay {
  display: none;
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.75);
  z-index: 150;
  align-items: center; justify-content: center;
  padding: 20px;
}
.ach-fact-overlay.open { display: flex; }
.ach-fact-card {
  background: #111827;
  border: 1px solid var(--amber);
  border-radius: 14px;
  padding: 28px; max-width: 400px; text-align: center;
}
.ach-fact-card .emblem { font-size: 56px; margin-bottom: 14px; }
.ach-fact-card .ach-title { font-size: 20px; color: var(--amber); font-weight: 700; margin-bottom: 12px; font-family: 'Cormorant Garamond', serif; }
.ach-fact-card .fact { font-size: 14px; color: var(--txt); line-height: 1.6; margin-bottom: 20px; font-family: 'Cormorant Garamond', serif; font-style: italic; }
.ach-fact-card .unlocked { font-size: 11px; color: var(--txt3); font-family: 'JetBrains Mono', monospace; }
```

```js
function openAchievementsModal(scrollToId) {
  renderAchievementsGrid();
  document.getElementById('achievementsOverlay').classList.add('open');
  if (scrollToId) {
    setTimeout(() => {
      const el = document.querySelector(`.ach-card[data-id="${scrollToId}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
  }
}

function renderAchievementsGrid() {
  const grid = document.getElementById('achievementsGrid');
  const count = document.getElementById('achievementsCount');
  const owned = ACHIEVEMENTS.filter(a => state.achievements[a.id]).length;
  count.textContent = owned;
  grid.innerHTML = '<div class="ach-grid">' + ACHIEVEMENTS.map(a => {
    const unlocked = !!state.achievements[a.id];
    return `
      <div class="ach-card ${unlocked ? '' : 'ach-locked'}" data-id="${a.id}">
        <div class="emblem">${a.emblem}</div>
        <div class="ach-title">${unlocked ? a.title : '???'}</div>
        <div class="ach-unlock">${unlocked ? 'Unlocked' : a.unlock}</div>
      </div>`;
  }).join('') + '</div>';

  grid.querySelectorAll('.ach-card:not(.ach-locked)').forEach(card => {
    card.addEventListener('click', () => showAchievementFact(card.dataset.id));
  });
}

function showAchievementFact(id) {
  const ach = ACHIEVEMENTS.find(a => a.id === id);
  if (!ach) return;
  const ts = state.achievements[id];
  const date = ts ? new Date(ts).toLocaleDateString() : '';
  const overlay = document.createElement('div');
  overlay.className = 'ach-fact-overlay open';
  overlay.innerHTML = `
    <div class="ach-fact-card">
      <div class="emblem">${ach.emblem}</div>
      <div class="ach-title">${ach.title}</div>
      <div class="fact">${ach.fact}</div>
      <div class="unlocked">Unlocked ${date}</div>
    </div>`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// Wire the button
document.getElementById('achievementsBtn').addEventListener('click', () => openAchievementsModal());
document.getElementById('achievementsClose').addEventListener('click', () => closeOverlay('achievementsOverlay'));
document.getElementById('achievementsOverlay').addEventListener('click', e => {
  if (e.target.id === 'achievementsOverlay') closeOverlay('achievementsOverlay');
});
```

### Firestore persistence

```js
// In saveProgress
achievements: state.achievements,
lowestN:      state.lowestN,
```

In `onSignIn`:

```js
state.achievements = data.achievements ?? {};
state.lowestN      = data.lowestN ?? 1;
```

### Testing checklist

- [ ] Reach F(3) for the first time — toast appears, "Sprout" unlocks
- [ ] Click the toast — achievements modal opens, scrolled to Sprout
- [ ] Click Sprout card — fact overlay shows the branching-tree fact
- [ ] Locked achievements show as grayed ??? with unlock condition
- [ ] Reach F(89) — Transcendent fires
- [ ] Buy a boost — First Boost fires
- [ ] Reach F(-5) — Through the Mirror fires
- [ ] Refresh — previously-unlocked achievements persist
- [ ] Unlock all achievements — Completionist fires
- [ ] Modal count updates correctly (13/16 etc.)

---

## Feature 6 — Themed Skins

### The problem this solves

Cosmetic customization is the #1 reason players stay with a game beyond its mechanical loop. "This spiral is MY spiral" is a powerful form of ownership. Skins are cheap to build (cosmetic only, no gameplay effect) and give every Fibonacci milestone a tangible payoff beyond a number.

### Design

A skin is a set of CSS variable overrides and optional canvas-color overrides applied when active. Skins unlock at specific Fibonacci milestones and are free — no token cost. Only one active at a time. The default "Classic" skin is always available.

### The skin catalog

```js
const SKINS = [
  { id: 'classic',  name: 'Classic',   unlock: 0,  preview: '🌀',
    palette: {
      // This is the current default — listing explicitly so toggling back is trivial
      amber:  '#f5a623', amberLight: '#fbbf24', orange: '#f97316',
      red:    '#e05c5c', teal:       '#a8e6cf',
      bg:     '#0b0f1a', bg2:        '#111827',
      canvasBg: '#0a0e1a',
      spiralColor: '#f1f5f9',
    }
  },
  { id: 'nautilus', name: 'Nautilus',  unlock: 8,  preview: '🐚',
    palette: {
      amber:  '#d4a574', amberLight: '#e8c39e', orange: '#a67653',
      red:    '#8b4a3f', teal:       '#c9b99a',
      bg:     '#1c1410', bg2:        '#28201a',
      canvasBg: '#161108',
      spiralColor: '#e8ddc6',
    }
  },
  { id: 'sunflower',name: 'Sunflower', unlock: 13, preview: '🌻',
    palette: {
      amber:  '#fbbf24', amberLight: '#fde047', orange: '#f59e0b',
      red:    '#dc2626', teal:       '#86efac',
      bg:     '#1e1a0e', bg2:        '#2d2818',
      canvasBg: '#141006',
      spiralColor: '#fef3c7',
    }
  },
  { id: 'galaxy',   name: 'Galaxy',    unlock: 21, preview: '🌌',
    palette: {
      amber:  '#a78bfa', amberLight: '#c4b5fd', orange: '#ec4899',
      red:    '#f472b6', teal:       '#67e8f9',
      bg:     '#050514', bg2:        '#0d0a24',
      canvasBg: '#02010a',
      spiralColor: '#e0d7ff',
    }
  },
  { id: 'hurricane',name: 'Hurricane', unlock: 34, preview: '🌀',
    palette: {
      amber:  '#94a3b8', amberLight: '#cbd5e1', orange: '#64748b',
      red:    '#ef4444', teal:       '#7dd3fc',
      bg:     '#0f172a', bg2:        '#1e293b',
      canvasBg: '#0a1220',
      spiralColor: '#e2e8f0',
    }
  },
  { id: 'fern',     name: 'Fern',      unlock: 55, preview: '🌿',
    palette: {
      amber:  '#84cc16', amberLight: '#a3e635', orange: '#65a30d',
      red:    '#dc2626', teal:       '#bbf7d0',
      bg:     '#0a1408', bg2:        '#141e10',
      canvasBg: '#060b04',
      spiralColor: '#d9f99d',
    }
  },
  { id: 'cosmic',   name: 'Cosmic',    unlock: 89, preview: '✨',
    palette: {
      amber:  '#f59e0b', amberLight: '#fcd34d', orange: '#ef4444',
      red:    '#f43f5e', teal:       '#06b6d4',
      bg:     '#000000', bg2:        '#0a0a0a',
      canvasBg: '#000000',
      spiralColor: '#fef3c7',
    }
  },
];
```

### State

```js
activeSkin: 'classic',
```

### Applying a skin

CSS variables are set at `:root`. Override them programmatically:

```js
function applySkin(skinId) {
  const skin = SKINS.find(s => s.id === skinId);
  if (!skin) { console.warn('⚠️  Unknown skin:', skinId); return; }

  const root = document.documentElement.style;
  root.setProperty('--amber',    skin.palette.amber);
  root.setProperty('--amber-l',  skin.palette.amberLight);
  root.setProperty('--orange',   skin.palette.orange);
  root.setProperty('--red',      skin.palette.red);
  root.setProperty('--teal',     skin.palette.teal);
  root.setProperty('--bg',       skin.palette.bg);
  root.setProperty('--bg2',      skin.palette.bg2);

  state.activeSkin = skinId;
  state._canvasBg        = skin.palette.canvasBg;
  state._spiralStrokeCol = skin.palette.spiralColor;

  requestDrawSpiral();
  requestDrawNumberLine();
  console.log(`✅ Skin applied: ${skin.name}`);
}
```

### Canvas color override

Inside `drawSpiral`, change the hardcoded values:

```js
// Replace:
// ctx.fillStyle = '#0a0e1a';
// With:
ctx.fillStyle = state._canvasBg || '#0a0e1a';

// Replace:
// ctx.strokeStyle = isNeg ? '#e05c5c' : '#f1f5f9';
// With:
ctx.strokeStyle = isNeg ? getComputedStyle(document.documentElement).getPropertyValue('--red').trim() :
                          (state._spiralStrokeCol || '#f1f5f9');
```

For the ghost arc color in the fib-steps mode, similarly derive from `state._spiralStrokeCol`.

The colored squares (`col(i)` function using the `COLORS` palette) stay as-is — they're semantic indicators per level, not theme colors.

### Skins picker UI

Add a new card in the sidebar-right between Boosts and Leaderboard, or a new section in the settings overlay. Recommend: settings overlay section:

```html
<div class="overlay-section" style="margin-top:16px;">Skin</div>
<div id="skinsList" class="skins-grid"></div>
```

```css
.skins-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
  gap: 8px;
}
.skin-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 6px;
  text-align: center;
  cursor: pointer;
  transition: all .15s;
}
.skin-card:hover:not(.skin-locked) { border-color: var(--amber); }
.skin-card.skin-locked { opacity: 0.3; cursor: not-allowed; }
.skin-card.skin-active {
  border-color: var(--amber);
  background: rgba(245,166,35,0.1);
}
.skin-card .preview { font-size: 22px; margin-bottom: 4px; }
.skin-card .skin-name {
  font-size: 10px; color: var(--txt);
  font-family: 'JetBrains Mono', monospace;
}
.skin-card.skin-locked .skin-name::before { content: '🔒 '; }
```

```js
function renderSkins() {
  const list = document.getElementById('skinsList');
  if (!list) return;
  list.innerHTML = SKINS.map(s => {
    const locked = state.highestAbsN < s.unlock;
    const active = state.activeSkin === s.id;
    let cls = 'skin-card';
    if (locked) cls += ' skin-locked';
    if (active) cls += ' skin-active';
    return `
      <div class="${cls}" data-skin="${s.id}" title="${locked ? `Unlocks at F(${s.unlock})` : s.name}">
        <div class="preview">${s.preview}</div>
        <div class="skin-name">${s.name}</div>
      </div>`;
  }).join('');
  list.querySelectorAll('.skin-card:not(.skin-locked)').forEach(card => {
    card.addEventListener('click', () => {
      applySkin(card.dataset.skin);
      renderSkins();
      debouncedSaveProgress();
    });
  });
}
```

### Firestore persistence

```js
// In saveProgress
activeSkin: state.activeSkin,
```

In `onSignIn`:

```js
state.activeSkin = data.activeSkin ?? 'classic';
applySkin(state.activeSkin);
```

### Skin unlock notifications

When `state.highestAbsN` crosses a skin's unlock threshold, show a toast similar to the achievement toast:

```js
// In commitN, after updating highestAbsN:
SKINS.forEach(s => {
  if (s.unlock > 0 && state.highestAbsN === s.unlock) {
    showSkinUnlockToast(s);
  }
});

function showSkinUnlockToast(skin) {
  const container = document.getElementById('achievementToasts');
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `
    <div class="emblem">${skin.preview}</div>
    <div>
      <div class="ach-label">New skin unlocked</div>
      <div class="ach-title">${skin.name}</div>
    </div>`;
  toast.addEventListener('click', () => {
    toast.remove();
    openOverlay('settingsOverlay');
    setTimeout(() => {
      const el = document.querySelector(`.skin-card[data-skin="${skin.id}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
  });
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5100);
}
```

### Testing checklist

- [ ] Classic skin active on fresh load
- [ ] Skins grid shows Classic as active, all others locked
- [ ] Reach F(8) — Nautilus skin unlock toast appears
- [ ] Click Nautilus in settings — colors change across UI and canvas
- [ ] Reload — Nautilus remains active
- [ ] Reach F(13), F(21), ... each unlocks corresponding skin
- [ ] Negative spiral (e.g., F(-5)) uses the palette's red color, not hardcoded
- [ ] Achievements and Boost cards maintain readability in every skin
- [ ] Switch skins mid-session — canvas redraws without flicker

---

## Order of implementation

1. **Daily Streak** — independent of achievements and skins, ship first. Immediate retention impact.
2. **Achievements** — depends on streak data for Phi Disciple and Dedicated achievements. Also hooks into Tier 1 boost and engine state.
3. **Themed Skins** — independent of achievements; can ship last. Least risky, most visual polish.

Each feature is 200-400 lines of new code. A careful day of work per feature is realistic, plus a half-day of testing each.

---

## Integration notes for Claude Code

- None of these features modify Fibonacci math, canvas transforms, or input handling — they're all additive UI and state layers.
- All three features write to Firestore via `saveProgress` with `{ merge: true }`. No schema migration needed; `?? default` handles missing fields.
- The achievement toast container and overlay styling are shared between the achievement system and skin-unlock notifications — keep the same CSS classes.
- `checkAchievements()` is called from many places. Make it cheap: it's a short loop over ~16 flag checks. Do not debounce — the user clicking in and seeing a toast immediately is the reward.
- Respect the single-HTML-file rule. All three features fit comfortably in the existing file; expect total file size to grow by ~500-800 lines.
- Update the `<!-- vN — ... -->` header comment to reflect the shipped tier, e.g., `<!-- v2.5 — Tier 2: Streak + Achievements + Skins -->`.
- Add a version-bump note to `CLAUDE.md` under a new section "Versioning" if not already present.

After Tier 2 ships, the game has an **identity**: a streak that feels personal, trophies that feel earned, and a visual style the player chose. A returning user is no longer just "someone with a score" — they're Scott with a 21-day streak, Galaxy skin, and 11 of 16 achievements. That's the player who tells a friend.
