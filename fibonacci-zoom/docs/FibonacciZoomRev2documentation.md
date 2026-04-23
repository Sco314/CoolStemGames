# Fibonacci Zoom — Revision 2 Documentation

**Versions covered:**
- **v2.0** — Tier 1 (Boosts + Engine + Offline) — shipped 2026-04
- **v2.5** — Tier 2 (Streak + Achievements + Skins) — shipped 2026-04
- **v3.0** — Tier 3 (Combo + Golden Moment + Gallery + Weekly Challenge) — shipped 2026-04
- **v4.0** — Tier 4 (Level Facts + Classroom Challenge) — shipped 2026-04

**Author:** Scott Sandvik
**Source plans:**
- `fibonacci-zoom/docs/Fibonacci Zoom Revision Tier 1.md`
- `fibonacci-zoom/docs/Fibonacci Zoom Revision Tier 2.md`
- `fibonacci-zoom/docs/Fibonacci Zoom Revision Tier 3.md`
- `fibonacci-zoom/docs/Fibonacci Zoom Revision Tier 4.md`

---

## Overview

Tier 1 of the Fibonacci Zoom revision fixes the core pacing problem (F(13)=233 clicks per level becoming a chore) and establishes the retention loop that keeps players returning. It layers three cooperating systems on top of the existing simulation without touching the Fibonacci math, tiling, or arc chain:

1. **Boost Tokens + Permanent Click Multipliers** — a persistent currency and upgrade catalog that multiplies the effective ticks earned per click.
2. **Auto-Clicker ("The Golden Ratio Engine")** — an unlockable auto-ticker that progresses while the tab is open.
3. **Offline Progress ("The Nautilus Sleeps")** — banked ticks while the tab was closed, collected on return.

Every new number introduced by these features is itself a Fibonacci value where possible (upgrade costs, unlock thresholds, periodic-bonus intervals, rate multipliers).

### File touched

All changes land in the single-file app `fibonacci-zoom/index.html`. No bundler, no split files, no new dependencies. The file now carries a version-header comment immediately after `<!DOCTYPE html>`:

```html
<!-- v2.0 — Tier 1: Boosts + Engine + Offline -->
```

---

## Table of Contents

### Tier 1 — v2.0 (Pacing + Retention Loop)
1. [Feature 1 — Boost Tokens + Click Multipliers](#feature-1--boost-tokens--click-multipliers)
2. [Feature 2 — Golden Ratio Engine](#feature-2--golden-ratio-engine)
3. [Feature 3 — Offline Progress](#feature-3--offline-progress)

### Tier 2 — v2.5 (Identity + Personalization)
4. [Feature 4 — Daily Streak with Fibonacci Rewards](#feature-4--daily-streak-with-fibonacci-rewards)
5. [Feature 5 — Achievements System](#feature-5--achievements-system)
6. [Feature 6 — Themed Skins](#feature-6--themed-skins)

### Tier 3 — v3.0 (Surprise + Rhythm + Community + Depth)
7. [Feature 7 — Weekly Class Challenge](#feature-7--weekly-class-challenge)
8. [Feature 8 — "Found in Nature" Gallery](#feature-8--found-in-nature-gallery)
9. [Feature 9 — Combo System](#feature-9--combo-system)
10. [Feature 10 — Golden Moment](#feature-10--golden-moment)

### Tier 4 — v4.0 (Classroom / Educational Layer)
11. [Feature 11 — Level Pop-ups ("Why Does This Matter?")](#feature-11--level-pop-ups-why-does-this-matter)
12. [Feature 12 — Classroom Challenge Mode](#feature-12--classroom-challenge-mode)

### Reference
13. [State + Firestore schema reference](#state--firestore-schema-reference)
14. [Testing checklist](#testing-checklist)
15. [Maintenance notes](#maintenance-notes)
16. [Changelog](#changelog)

---

## Feature 1 — Boost Tokens + Click Multipliers

### Problem

In `fib-steps` mode, click costs follow `F(n)` exactly — by F(13)=233 the cost is punishing, by F(15)=610 and F(16)=1597 the game stops being playable. The Fibonacci cost cannot be reduced without breaking the educational math, so instead we reduce the *effective* clicks needed by giving each click a multiplier value earned through progression.

### Design

Boost Tokens are a persistent currency earned by committing new `|n|` levels. Players spend tokens on permanent upgrades that multiply their tick output per click. Multipliers stack multiplicatively.

#### Token awards (granted inside `commitN` when a new high is reached)

| Condition | Tokens awarded |
|---|---|
| New high `\|n\| >= 3` | `Math.max(1, Math.floor(log_φ(\|n\|)))` → roughly 1 token per level, scaling gently |
| New-high milestone (8, 13, 21, 34, 55, 89, 144) | Bonus tokens: 5, 8, 13, 21, 34, 55, 89 respectively |

A player reaching F(13) for the first time should have roughly 50–80 tokens — enough to buy the first two upgrades.

#### Upgrade catalog (`BOOST_UPGRADES`)

| id | name | cost (🪙) | tickMult (avg) | unlock | desc |
|---|---|---|---|---|---|
| `x2` | ×2 Click | 10 | 2 | F(3) | Each click = 2 ticks |
| `x3` | ×3 Click | 50 | 1.5 | F(5) | Stacks to ×3 total (2 × 1.5) |
| `fingers` | Fibonacci Fingers | 100 | 1.66 *avg* | F(8) | Every 5th click: +F(5)=5 ticks |
| `touch` | Golden Touch | 500 | 2 *avg* | F(13) | Every 13th click: +F(13)=233 ticks |
| `phi` | The Phi Multiplier | 2000 | φ (≈1.618) | F(21) | All clicks ×φ |
| `fermat` | Fermat's Flourish | 5000 | 1.5 | F(34) | Permanent ×1.5 on all output |
| `golden_ratio` | Ratio Resonance | 13000 | φ | F(55) | Another ×φ layer |

"Fibonacci Fingers" and "Golden Touch" are **periodic bonuses**, not flat multipliers. A `state.clickCounter` increments on every tick; when `clickCounter % 5 === 0` and Fingers is owned, extra F(5)=5 ticks are added; when `clickCounter % 13 === 0` and Touch is owned, +F(13)=233 is added. Their listed multipliers are *average* effective values for balance — the actual reward is an occasional burst, which feels great.

### Implementation notes (`index.html`)

- **State additions** (inside the existing `state = { ... }` literal):
  ```js
  boostTokens:         0,
  boostTokensLifetime: 0,
  boostUpgrades:       {},   // { x2: true, ... }
  clickCounter:        0,
  ```
- **Pure helper** `clickMultiplier()` reads `state.boostUpgrades` and returns the product of non-periodic `tickMult` values.
- **Canonical mass-apply** `applyTicks(amount)` crosses level boundaries if a single click's ticks exceed the remaining sub-steps. A `SAFETY_CAP = 1000` prevents runaway loops at extreme multipliers.
- **`tickInput(dir)`** was refactored to compute `ticksThisClick = clickMultiplier()`, add periodic bonuses, and then `applyTicks(ticksThisClick)`. Confetti / smiley / celebration hooks are preserved.
- **`bulkTick(dir, count)`** (used by flower and smiley power-ups) now funnels through `applyTicks`. Power-up rewards bypass click multipliers — their reward is already the Fibonacci value chosen at design time.
- **`commitN(newN)`** calls `awardBoostTokens(|n|)` only when `|newN|` exceeds the old high-water mark, and re-renders the Boosts / Engine cards on every new high (so unlocks appear immediately).
- **UI** — a new `#boostsCard` sits in the desktop right sidebar between Account and Leaderboard, and is mirrored in the mobile bottom sheet (`#mobileBoostsCard`). Rendering is handled by `renderBoosts()`; buying is handled by `buyBoost(id)`.

### CSS classes

`.boost-row`, `.boost-row.boost-owned`, `.boost-row.boost-locked`, `.boost-row.boost-unaffordable`, `.boost-name`, `.boost-desc`, `.boost-cost`, `.engine-status`.

### Backward compatibility

Existing users have no `boostTokens` field. The `?? 0` defaults in `onSignIn` handle this — a player with zero upgrades clicks exactly as before. No migration script needed.

---

## Feature 2 — Golden Ratio Engine

### Problem

Players who reach F(13)+ need a reason to leave the tab open without actively clicking. Auto-progress creates a "plant a seed, come back later" loop that every successful incremental game uses.

### Design

Unlocks at F(13) = 233 as a one-time purchase for **1000 🪙** (`ENGINE_COST`). Once owned, a ticker runs at `computeEngineRate()` ticks per second, which grows as the player crosses Fibonacci milestones and as the engine is upgraded.

#### Rate scaling

- `ENGINE_MILESTONES = [13, 14, 15, 16, 17, 18, 19, 20, 21, 34, 55, 89, 144, 233]`
- Base rate = `base^levelsCrossed` where `levelsCrossed` counts how many milestones are at or below `state.highestAbsN`.
- `base = φ` normally; `base = φ²` once Resonance Chamber is owned.
- `+1` flat tick/sec if Golden Gears is owned.

#### Engine upgrades (`ENGINE_UPGRADES`)

| id | name | cost (🪙) | unlock | effect |
|---|---|---|---|---|
| `gears` | Golden Gears | 500 | F(13) | +1 flat tick/sec |
| `servos` | Spiral Servos | 2000 | F(14) | Other engine upgrades cost 50% less |
| `interest` | Compound Interest | 8000 | F(21) | Engine ticks earn 0.01 🪙 each |
| `resonance` | Resonance Chamber | 34000 | F(34) | Rate base becomes φ² per milestone |

`engineUpgradeCost(up)` applies the Spiral Servos 50% discount (except when buying Servos itself).

### Implementation notes (`index.html`)

- **State addition**:
  ```js
  engine: {
    owned:       false,
    upgrades:    {},     // { gears: true, ... }
    accumulator: 0,      // fractional ticks pending
    lastTick:    0,      // performance.now() anchor
    enabled:     true,   // user-facing on/off toggle
  },
  ```
  Stored under a single sub-object for clean Firestore serialization. `accumulator` and `lastTick` are ephemeral (not saved).
- **`computeEngineRate()`** is pure; called every frame in the engine loop and on each UI render.
- **`startEngineLoop()`** uses `requestAnimationFrame`, pauses cleanly during `celebrationAF`, honors `state.engine.enabled`, and in **standard mode** commits one `commitN(state.n + 1)` per whole tick rather than calling `applyTicks` (which applies F(|n|) ticks per level). In fib-steps mode it delegates to `applyTicks(whole)`.
- **`buyEngine()`** deducts `ENGINE_COST`, marks owned, resets `lastTick`, and kicks off the loop.
- **`buyEngineUpgrade(id)`** handles unlock + afford checks and respects the Spiral Servos discount.
- **UI** — `#engineCard` (desktop) + `#mobileEngineCard` (mobile) are hidden until `state.highestAbsN >= 13`. Content is rendered by `renderEngine()`; it shows either an "Unlock the Engine" row (pre-purchase) or the rate readout + enable toggle + upgrade list (post-purchase).

### Idle-tab note

The engine loop uses `requestAnimationFrame`, which pauses when the browser tab is inactive. This is by design — Feature 3 (Offline Progress) handles the "tab hidden or closed" case instead.

---

## Feature 3 — Offline Progress ("The Nautilus Sleeps")

### Problem

Nothing pulls a user back to a web app like opening it and discovering a reward waiting. This is the single strongest retention mechanic in the genre.

### Design

While the tab is closed, Firestore stores the last-active server timestamp and the engine rate at close. When the user returns, we compute offline ticks as `rate × min(elapsedSeconds, OFFLINE_CAP_SECONDS)` where `OFFLINE_CAP_SECONDS = 8 * 3600` (8 hours). A friendly "welcome back" modal shows the banked ticks; the player taps **Collect** to apply them.

Offline progress **requires the engine to be owned**. No engine = no offline ticks.

### Firestore fields added

```js
boostTokens:         number,
boostTokensLifetime: number,
boostUpgrades:       { [id]: true },
engine:              { owned, upgrades, enabled },
offlineRateSnapshot: number,              // engine rate at time of last write
offlineSinceTs:      serverTimestamp(),   // anchor for elapsed-time computation
```

`saveProgress()` writes these on every debounced save (2s cadence during activity) and immediately on `visibilitychange` → `hidden`. `maybeSaveScore()` also merges these so a new high doesn't clobber them.

### On-sign-in flow

Inside `onSignIn(user)`, after restoring the standard score doc:

1. Restore `boostTokens`, `boostTokensLifetime`, `boostUpgrades` with `?? 0` / `?? {}` defaults.
2. Restore `engine.owned`, `engine.upgrades`, `engine.enabled` (defaults `false`, `{}`, `true`).
3. If `engine.owned && offlineRateSnapshot > 0 && offlineSinceTs`, compute:
   ```js
   elapsedSec = (Date.now() - offlineSinceTs.toMillis()) / 1000
   cappedSec  = min(elapsedSec, OFFLINE_CAP_SECONDS)
   ticks      = floor(offlineRateSnapshot * cappedSec)
   ```
   and call `showOfflineWelcomeModal(ticks, cappedSec, wasCapped)`.
4. If `engine.owned`, call `startEngineLoop()` to resume live auto-ticking.
5. Call `updateTokenDisplay()` to paint balances and re-render the Boosts / Engine cards.

### Modal UI (`#offlineModal`)

Reuses the existing `.overlay-backdrop` / `.overlay-panel` pattern. The Collect button applies `applyTicks(ticks)` (forcing `stepDir = 1` first so momentum always goes forward).

### Tab-close flush

```js
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && currentUser) saveProgress();
});
```

`beforeunload` is intentionally avoided — browsers are unreliable about firing it, and the 2s debounced save already keeps `offlineSinceTs` reasonably fresh. The `visibilitychange` handler is best-effort; the server-timestamp anchoring means worst-case drift is one debounce interval.

### Security note

Offline ticks use the client clock for `Date.now()` and Firestore's server timestamp for `offlineSinceTs`. A malicious user could skew their local clock forward, but the 8-hour cap bounds the damage. For a teacher tool, this is acceptable — no server-side validation is needed. The existing Firestore security rule (`match /scores/{uid} { allow write: if request.auth.uid == uid; }`) is unchanged.

---

# Tier 2 — v2.5 Overview

Tier 1 fixed pacing and retention; Tier 2 is about identity, pride, and personalization — the reasons a player logs in tomorrow and tells a friend today. Three cooperating systems layer on top of Tier 1 without touching the Fibonacci math, canvas transforms, or input handling:

4. **Daily Streak with Fibonacci Rewards** — a "come back tomorrow" hook whose reward schedule *is* the Fibonacci sequence. A 7-day streak gives F(1)..F(7); a 13-day streak gives a visual celebration and a permanent badge. One Freeze per ISO week softens a missed day.
5. **Achievements System** — 16 collectible identity markers spanning progression (Sprout, Nautilus, Galaxy…), negative exploration (Through the Mirror, Antimatter), engagement (First Boost, Autonomous, Phi Disciple), and oddities (The Zero Point, Free Explorer, Completionist). Each includes a "Did you know?" fact about where that Fibonacci number appears in nature or mathematics.
6. **Themed Skins** — cosmetic-only palette overrides that unlock at Fibonacci milestones. One active at a time; free (no token cost). "This spiral is MY spiral."

All three features are additive UI + state layers. The version header comment is updated to:

```html
<!-- v2.5 — Tier 2: Streak + Achievements + Skins (atop v2.0 Tier 1) -->
```

---

## Feature 4 — Daily Streak with Fibonacci Rewards

### Problem

Today's session ends. Why come back tomorrow? Without a daily hook, a player who reached F(13) on Monday has no reason to open the tab on Tuesday. Streaks are the single most effective "come back tomorrow" mechanism in casual gaming — and the twist that makes ours special: **the streak reward schedule IS the Fibonacci sequence.**

A student who plays 7 days in a row has physically felt F(1) through F(7) in their gut, as rewards, before they could ever tell you what Fibonacci was. That is the incidental learning we want.

### Design

- A "day" is the **local calendar date** (`YYYY-MM-DD`), not a rolling 24-hour window — more forgiving and matches user intuition.
- On first sign-in each new local day, the streak advances and the claim modal appears.
- Missing a day resets the streak to 1 — **unless** the user has a Freeze available.
- Every player gets one Freeze automatically restored per ISO week (`lastFreezeRestoreWk`). Freezes do not accumulate beyond 1 — the cap keeps the math simple and the forgiveness finite.

#### Reward schedule

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
| 14+ | +377 🪙 = F(14) | cap (no runaway inflation) |

On day 13 specifically, `playStreak13Celebration()` fires: five 150-particle confetti bursts centered on the spiral canvas, and the permanent **Phi Disciple** achievement unlocks.

### Implementation notes (`index.html`)

- **State addition:**
  ```js
  streak: {
    count:               0,
    longestCount:        0,
    lastDateStr:         '',   // YYYY-MM-DD
    freezesLeft:         1,
    lastFreezeRestoreWk: '',   // ISO week, e.g., 2026-W17
    todayClaimed:        false,   // transient; not persisted
  },
  ```
- **Helpers:** `localDateStr(d)`, `isoWeekStr(d)`, `daysBetween(a, b)`, `streakReward(dayNum)`.
- **`evaluateStreak()`** — single decision point. Handles first-ever claim, gap=0 (already claimed today), gap=1 (continue), gap=2 with a freeze (bridge), otherwise reset. Called from `onSignIn` (or from the offline-modal Collect handler when an offline modal fires first, to avoid stacked overlays).
- **`showStreakClaimModal(freezeUsed?, wasReset?)`** — opens `#streakModal`, paints the claim body, wires the Claim button to add the reward to `state.boostTokens` and lifetime, triggers day-13 celebration if applicable, and calls `checkAchievements()` and `saveProgress()`.
- **`showStreakInfoModal()`** — read-only variant for the streak badge click-through; hides the Claim button.
- **`updateStreakBadge()`** — top-bar `#streakBadge` shows 🔥 + count. Grey when count === 0.
- **Day-13 celebration** — `playStreak13Celebration()` launches confetti bursts via the existing `launchConfetti(x, y, count)` system.

### Sequencing with offline modal

If both offline progress and a streak claim would appear on sign-in, the offline modal shows first. Its Collect handler calls `evaluateStreak()` at the end so the streak modal follows cleanly. If no offline modal fires, `onSignIn` calls `evaluateStreak()` directly.

### Anonymous users

Streaks work for anonymous users — their UID persists across reloads via Firebase IndexedDB. If an anonymous user upgrades to Google mid-streak, linking preserves the Firestore document keyed by UID, so streak data is retained automatically.

---

## Feature 5 — Achievements System

### Problem

Players need collectible identity markers they can point to. Achievements turn discrete gameplay events into persistent trophies — cheap to build (just flags and UI), enormous for retention and sharing. Our twist: each achievement carries a **"Did you know?" fact** about where that Fibonacci number shows up in nature, mathematics, or culture. The incidental-learning channel keeps context absorbed without quizzing.

### Design

An achievement is a `{ id, emblem, title, fact, unlock }` record. Unlock conditions are evaluated by `checkAchievements()` after each relevant state change. The function is a short (~16 flag check) pure-ish read of `state`; no debouncing — immediate toasts are the reward. Unlocked achievements are stored as `state.achievements[id] = unlockedAtMillis`.

### Catalog (16 achievements)

| Category | Achievements |
|---|---|
| Early progression | Sprout (F3), Sunflower (F8), Nautilus (F13), Hurricane (F21), Galaxy (F34), Phi Master (F55), Transcendent (F89) |
| Negative exploration | Through the Mirror (F-5), Antimatter (F-13) |
| Engagement | First Boost (any boost), Autonomous (Engine owned), Phi Disciple (13-day streak), Dedicated (34-day streak) |
| Oddities | The Zero Point (n=0), Free Explorer (drag to 5 distinct n), Completionist (all others owned) |

Each entry includes a short prose fact — e.g., Sprout's fact: *"A tree branches in Fibonacci patterns — one trunk splits into two, then three branches, then five. This is how trees maximize sunlight."*

### Implementation notes (`index.html`)

- **State additions:**
  ```js
  achievements:    {},        // { id: unlockedAtMillis }
  lowestN:         1,          // mirrors highestAbsN for negative-exploration tracking
  _dragExploredNs: null,       // lazy Set<number>; transient — not persisted
  ```
- **`checkAchievements()`** — reads `state.highestAbsN`, `state.lowestN`, `state.boostUpgrades`, `state.engine.owned`, `state.streak.longestCount`, `state.n`, and the transient drag Set; unlocks matching IDs; fires one toast per unlock. Completionist is granted when every other achievement is owned.
- **Integration points:**
  - `commitN(newN)` — updates `state.lowestN`, calls `checkAchievements()` on every commit.
  - `buyBoost(id)` — after successful purchase.
  - `buyEngine()` — after engine purchase.
  - `evaluateStreak()` — when `longestCount` ticks up into a new range.
  - Number-line drag handlers (mousemove + touchmove) — add reached n to `_dragExploredNs` Set and call `checkAchievements()` only once the size hits 5 (prevents hammering on every pixel of drag motion).
  - Streak claim handler — in case the claim advances `longestCount`.

### UI

- **Toasts** (`#achievementToasts` container) — slide in from the right, auto-dismiss after 5.1s, clickable to scroll the achievements gallery to that entry.
- **Gallery** (`#achievementsOverlay`) — trophy `🏆` button in the top-right opens it. Responsive grid of 16 cards. Locked cards are greyscaled and show "???" + the unlock hint. Unlocked cards are clickable and show the full emblem + title.
- **Fact card** — clicking an unlocked achievement opens a black-tinted overlay with the emblem, title, italic prose fact, and unlock date. Click anywhere to dismiss.

Skin-unlock toasts reuse the same `.achievement-toast` CSS for visual consistency.

---

## Feature 6 — Themed Skins

### Problem

Cosmetic customization is the #1 reason players stay with a game beyond its mechanical loop. "This spiral is MY spiral" is a powerful form of ownership. Skins are cheap to build, give every Fibonacci milestone a tangible payoff beyond a number, and scale cleanly — one more skin per milestone forever.

### Design

A skin is a set of CSS-variable overrides plus two canvas-only color overrides (`canvasBg` + `spiralColor`). Only one skin is active at a time. Skins are **free** — no token cost. They unlock at specific `state.highestAbsN` thresholds. The default **Classic** skin is always available and preserves the current look exactly.

### Catalog (7 skins)

| id | name | unlock | feel |
|---|---|---|---|
| `classic` | Classic | F(0) | default — amber + navy |
| `nautilus` | Nautilus | F(8) | warm cream + brown |
| `sunflower` | Sunflower | F(13) | saturated yellow |
| `galaxy` | Galaxy | F(21) | violet + magenta |
| `hurricane` | Hurricane | F(34) | slate + ice |
| `fern` | Fern | F(55) | chlorophyll green |
| `cosmic` | Cosmic | F(89) | pure black + neon |

### Implementation notes (`index.html`)

- **State additions:**
  ```js
  activeSkin:       'classic',
  _canvasBg:        '#0a0e1a',   // consumed by drawSpiral
  _spiralStrokeCol: '#f1f5f9',   // consumed by drawSpiral (positive-n arc stroke)
  ```
- **`applySkin(id)`** — writes CSS variable overrides on `document.documentElement.style` (`--amber`, `--amber-l`, `--orange`, `--red`, `--teal`, `--bg`, `--bg2`) and the two canvas fields. Triggers `requestDrawSpiral()` + `requestDrawNumberLine()`.
- **Canvas hook** — `drawSpiral` reads `state._canvasBg` for the background fill and `state._spiralStrokeCol` for the positive-n spiral arc stroke. The negative-n red is read live via `getComputedStyle(document.documentElement).getPropertyValue('--red')` so it honors the active skin. Colored squares (`col(i)`) are intentionally NOT skinned — they're semantic per-level indicators, not theme colors.
- **Picker UI** — `#skinsList` grid rendered inside the Settings overlay's new "Skin" section. Cards show the preview emoji + name; locked cards are dimmed and non-clickable with a 🔒 prefix. The active card has an amber border + subtle tint.
- **Unlock toasts** — when `commitN` crosses a skin's `unlock` threshold (`state.highestAbsN === s.unlock`), `showSkinUnlockToast(skin)` fires — same visual as achievement toasts. Clicking opens Settings and scrolls to that skin card.

### Why canvas hooks are narrow

Only the canvas bg and the positive-n arc stroke are overridden. The colored squares and numeric labels use the semantic `COLORS` palette / CSS `--txt` variable, which are stable across skins to preserve legibility. This keeps the skin system purely cosmetic without risking the Fibonacci math or tile semantics.

---

# Tier 3 — v3.0 Overview

Tier 1 fixed pacing. Tier 2 gave the player an identity. Tier 3 gives the game a **pulse** — the small moments that make someone say "oh wait I got one!" and the larger rhythms that pull a player back next Monday. Four layered systems, all additive on top of Tier 1 & 2:

7. **Weekly Class Challenge** — a second leaderboard tab whose challenge rotates every ISO week (Highest Peak → Deepest Dive → Most Clicks → Flower Hunter → Token Magnate). Top-3 players at week-end earn a permanent medal (🥇🥈🥉) displayed in their Account card.
8. **"Found in Nature" Gallery** — a museum of 10 real-world Fibonacci phenomena (Wikimedia Commons images). New image every 3 levels: F(3), F(6), F(9) … F(30). Each entry ships a "Did you know?" prose fact.
9. **Combo System** — clicking within 1s of your last click builds a combo. Tiers at 5 (×1.5), 10 (×2), 21 (×3), 55 (×5). Engine ticks intentionally do NOT build combo.
10. **Golden Moment** — Cookie-Clicker-style randomly-appearing golden spiral (every 2–5 min of active play, 8-second window). Gives one of: +F(n) ticks, 5–34 🪙 tokens, or **Frenzy** — a 30-second ×7 multiplier that stacks with combo and also applies to engine ticks.

**Multiplier stacking order** (important — this is the feel of the game):

```
ticks = clickMultiplier  ×  comboMultTier  ×  (frenzyActive ? 7 : 1)
       + (fingersBonus if 5th click)
       + (touchBonus  if 13th click)
```

The version header is updated to:

```html
<!-- v3.0 — Tier 3: Combo + Golden Moment + Gallery + Weekly Challenge (atop v2.5 Tier 2) -->
```

### New Firestore collection

Tier 3 adds **one new collection** — the main `scores/{uid}` doc grows by a few fields; the new weekly leaderboard lives at a separate path:

```
weeklyScores/{weekId}/entries/{uid} → { uid, displayName, photoURL, metricKey, metric, updatedAt }
```

`weekId` is the ISO week string (e.g., `2026-W17`), and the metric is the numeric value being ranked (F(n) level, click count, flower count, or token total depending on the week's challenge).

### ⚠️ Required Firestore security-rules update

The new collection needs a rule allowing authenticated users to write their own entries. Update the Firestore console to:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /scores/{uid} {
      allow read:  if true;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /weeklyScores/{weekId}/entries/{uid} {
      allow read:  if true;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Without this update, weekly-score writes will fail silently — the client catches the error (`console.error('❌ Weekly score write error…')`) but the weekly leaderboard stays empty. **Deploy the rule change before or alongside this release.**

---

## Feature 7 — Weekly Class Challenge

### Problem

The all-time leaderboard is a staircase: whoever has played longest dominates. A **weekly challenge** resets the field every Monday and gives every player a real shot at the top. It also hands teachers a ready-made classroom activity ("let's see who can win the Flower Hunter challenge this week"). And it rotates the *type* of challenge, so a player who is weak at one gets another chance the next week.

### Design

- A "week" is the **ISO week** (Monday 00:00 to Sunday 23:59 local).
- All players compete on the same challenge. Type rotates automatically by ISO week number (`weekNum % 5`).
- The `weeklyScores/{weekId}/entries/{uid}` collection stores per-player progress for that week only.
- A new **Weekly tab** appears on the Leaderboard card alongside **All-time**.
- At week transition, the client detects its own top-3 finish from last week and writes a **champion badge** (`{ weekId, rank, challenge, ts }`) into `state.weekly.championBadges`. Medals appear in the Account card.

#### Challenge rotation (`WEEKLY_CHALLENGES`)

| `weekNum % 5` | id | Title | Metric | Teaches |
|---|---|---|---|---|
| 0 | `highest` | Highest Peak | `highestAbsNThisWeek` | Exponential growth |
| 1 | `lowest`  | Deepest Dive | `|lowestNThisWeek|`  | Negative indices |
| 2 | `clicks`  | Most Clicks  | `clickCountThisWeek` | Persistence |
| 3 | `flowers` | Flower Hunter| `flowersThisWeek`   | Attention + reflex |
| 4 | `tokens`  | Token Magnate| `tokensThisWeek`    | Economic strategy |

### Implementation notes (`index.html`)

- **State addition:**
  ```js
  weekly: {
    currentWeekId:        '',   // e.g., "2026-W17"
    clickCountThisWeek:   0,
    flowersThisWeek:      0,
    tokensThisWeek:       0,
    highestAbsNThisWeek:  0,
    lowestNThisWeek:      1,
    championBadges:       [],
  },
  ```
- **`evaluateWeekly()`** — called from `onSignIn`. If `currentWeekId !== isoWeekStr()`, counters reset (anchoring `highestAbsNThisWeek` and `lowestNThisWeek` to the user's current progress) and `checkLastWeekChampion(oldWeek)` fires to detect top-3 finishes.
- **`maybeUpdateWeeklyScore()`** — 2-second debounce wrapping the Firestore write to `weeklyScores/{weekId}/entries/{uid}`. Called from `tickInput` (every 10 clicks), `commitN` (on new peak or new depth), `collectFlower`, `awardBoostTokens`, and the Golden-Moment token reward.
- **`checkLastWeekChampion(lastWeekId)`** — one-shot `get()` against `weeklyScores/{lastWeekId}/entries` ordered by `metric desc limit 3`. If the user is in the results, push a badge and fire a toast (🥇🥈🥉 based on rank).
- **Leaderboard tabs (`activeLbTab`)** — clicking the All-time / Weekly buttons re-runs `restartLeaderboardListener()`, which either calls the existing `startLeaderboardListener()` (all-time) or the new `startWeeklyLeaderboardListener()` (weekly). The weekly listener orders by `metric desc limit 10` scoped to the current week.
- **`renderChallengeHeader()`** — paints the amber-accented "This Week: {title}" header above the weekly leaderboard, with a live `formatTimeUntilMonday()` countdown.
- **Champion badges UI** — `renderChampionBadges()` appends a `<div class="champion-badges">` under the user's "Best:" label in both desktop sidebar and mobile sheet, showing the last 5 medals.

---

## Feature 8 — "Found in Nature" Gallery

### Problem

The Mona Lisa easter egg at F(12) hinted at something beautiful: real images tied to real Fibonacci phenomena. Systematize it into a museum the player proudly shows to a skeptical friend.

### Design

- Unlocks start at F(3). A new image every 3 levels: F(3), F(6), F(9), F(12) … up to F(30) — 10 entries.
- Image sources are free/CC-licensed **Wikimedia Commons** URLs. No hosting needed on our side; they load lazily on demand and fall back to the emblem placeholder via an inline `onerror` handler if a URL 404s or a school network blocks the CDN.
- A **🖼️ Gallery** button sits in the top-bar next to the achievements 🏆. Opens a grid of 10 cards — unlocked ones show the real image, locked ones show the emblem silhouette.
- Clicking an unlocked card opens a full-view modal with the image, title, prose fact, and unlock line.
- A **NEW dot** (amber pulse) marks gallery items unlocked but not yet viewed. `state.galleryViewed[atN] = true` clears it.

### Catalog (10 entries)

| Level | Title | Why |
|---|---|---|
| F(3)  | Nautilus Shell      | logarithmic growth |
| F(6)  | Sunflower Seed Head | 21/34/55 spirals |
| F(9)  | Hurricane Isabel    | logarithmic limit shape |
| F(12) | Mona Lisa           | Leonardo + φ |
| F(15) | Messier 74 Galaxy   | grand-design spiral |
| F(18) | Romanesco Broccoli  | natural fractal |
| F(21) | Pinecone Spirals    | 8/13 spirals |
| F(24) | Pineapple           | 5/8/13 spirals |
| F(27) | Snail Shell         | φ growth |
| F(30) | DNA Double Helix    | 21 Å / 34 Å |

### Implementation notes (`index.html`)

- **State addition:**
  ```js
  galleryViewed: {},   // { [atN]: true }
  ```
- **`renderGalleryGrid()`** — reads `state.highestAbsN` to decide locked state, `state.galleryViewed` for NEW dots. Locked cards render the emblem placeholder; unlocked cards render `<img src="…" loading="lazy" onerror="…">`.
- **`openGalleryItem(atN)`** — populates the single-item viewer, marks `galleryViewed[atN] = true`, and debounced-saves.
- **`showGalleryUnlockToast(item)`** — called from `commitN` whenever `state.highestAbsN === g.at`. Clicking the toast opens the gallery and jumps to the item.

---

## Feature 9 — Combo System

### Problem

Active clicking in the mid-game (F(13)–F(21)) becomes rote. A **combo** rewards rhythm and attention, and it gives players who bought the Engine a reason to still click occasionally.

### Design

- **Combo window:** 1 second between clicks.
- **Combo tiers:** at 5 (×1.5), 10 (×2), 21 (×3), 55 (×5). Capped — no runaway past ×5.
- **Decay:** >1s gap → combo resets. The display fades with a 100 ms grace window.
- **Engine ticks do NOT build combo.** The engine loop calls `applyTicks` directly (not `tickInput`), so combo is naturally excluded. This keeps combos meaningful — you still have to *click*.
- Two achievements unlock at 21 and 55: **Streaking** and **Unstoppable**.

### Implementation notes (`index.html`)

- **State addition (session-only, not persisted):**
  ```js
  combo: { count: 0, lastClickAt: 0, multTier: 1, fadeTimer: null },
  ```
- **`tickInput`** computes `ticksThisClick = clickMultiplier() * state.combo.multTier` and multiplies by 7 if Frenzy is active before adding the Tier 1 periodic bonuses.
- **`comboMultiplier(count)` / `updateComboDisplay()` / `scheduleComboFade()`** — pure helpers that drive the floating #comboDisplay badge in the top-center of the canvas. A CSS `.pulse` class fires on milestone crossings (5/10/21/55).

---

## Feature 10 — Golden Moment

### Problem

Nothing in the current game is *surprising*. Every reward is predictable. A random reward — something that might appear at any moment — activates variable-ratio reinforcement, the most engaging pattern known to gaming.

### Design

- Every **2–5 minutes** of active play (`setTimeout` with random delay), a small **golden spiral** appears at a random position in the `#flowerLayer` for **8 seconds**.
- Clicking gives a weighted random reward:
  - **50%** — `+F(highestAbsN)` instant ticks
  - **35%** — 5 / 8 / 13 / 21 / 34 🪙 Boost Tokens (Fibonacci-valued)
  - **15%** — **Frenzy**: a 30-second ×7 multiplier on all clicks **and** engine ticks
- Visibility-aware (`document.addEventListener('visibilitychange', …)`): pauses the spawn timer when the tab is hidden, resumes on show.
- Does not spawn during celebration animations or below F(5). Boots via `initGoldenMoment()` after the user first reaches F(5) (hook in both `commitN` and `onSignIn`).
- First catch unlocks the **Seized the Moment** achievement.

### Implementation notes (`index.html`)

- **State addition (session-only):**
  ```js
  goldenMoment: { activeEl: null, frenzyUntil: 0 },
  ```
  plus module-scope `goldenTimer` for the pending spawn.
- **Frenzy hooks:**
  - `tickInput`: `if (performance.now() < state.goldenMoment.frenzyUntil) ticksThisClick *= 7;`
  - Engine loop: `const effective = frenzyActive ? whole * 7 : whole;` — Combo is excluded from the engine, but Frenzy is shared since it's a "session buff" not a rhythm reward.
- **`showFrenzyBanner()`** — rAF-driven countdown painting the `#frenzyTimer` span until `frenzyUntil`. Banner is a shimmering amber bar across the top of the canvas.

---

# Tier 4 — v4.0 Overview

Tier 1 fixed pacing. Tier 2 gave the player an identity. Tier 3 added surprise, rhythm, and community. Tier 4 is the **educational layer** — the features that turn Fibonacci Zoom from a game into a teaching tool Scott can use in his classroom and recommend to other teachers.

Two cooperating features ship in v4.0, both additive and respectful of prior tiers:

11. **Level Pop-ups ("Why Does This Matter?")** — a small slide-in card on each new-high Fibonacci level that delivers a one-sentence fact about where that number lives in nature, mathematics, or culture. Optional "Learn more →" link jumps to the Tier 3 Gallery entry for that level when one exists. Auto-dismiss at 7 s; suppressible via a toggle in the Display section of Settings. Each fact shows once per `state.factsShown[n]`.
12. **Classroom Challenge Mode** — admin-only short-lived event (5 / 10 / 15 / 30 / 60 min). Admin creates a challenge with a 4-character join code (from an I/O/0/1-free alphabet); students enter the code via a **🏫 Join Challenge** button on the Account card. A banner across the top of the app shows the target F(n), countdown, and the student's current rank. Reaching the target fires a celebration modal; when the timer ends (or the admin ends early) everyone sees a final-results modal. Users who close the tab mid-challenge auto-resume on their next sign-in.

Version header updated to:

```html
<!-- v4.0 — Tier 4: Level Facts + Classroom Challenge (atop v3.0 Tier 3) -->
```

### ⚠️ Required Firestore security-rules update

Classroom Challenge Mode requires a new collection and its subcollection. Update the Firestore rules before or alongside this release:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /scores/{uid} {
      allow read:  if true;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /weeklyScores/{weekId}/entries/{uid} {
      allow read:  if true;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /challenges/{code} {
      allow read:   if true;
      allow create: if request.auth != null;
      allow update: if request.auth != null && request.auth.uid == resource.data.creatorUid;
      allow delete: if false;

      match /participants/{uid} {
        allow read:  if true;
        allow write: if request.auth != null && request.auth.uid == uid;
      }
    }
  }
}
```

Without these rules, create/join/progress writes fail silently (caught in `console.error`); Feature 11 continues to work and all earlier tiers are unaffected.

### ⚠️ Required Firestore composite index

The auto-resume-on-sign-in flow uses `fbDb.collectionGroup('participants').where('uid', '==', currentUser.uid)`. Firebase will surface a one-click link in the console error the first time this query runs. Create the index with:

- **Collection ID:** `participants`
- **Query scope:** Collection group
- **Fields:** `uid` (ascending)

Until the index is built, the resume query logs `⚠️  Resume-challenge lookup skipped: <reason>` and the user can still re-join manually via the code.

---

## Feature 11 — Level Pop-ups ("Why Does This Matter?")

### Problem

The game already rewards reaching a Fibonacci level — confetti, tokens, skin unlocks, achievements. What's missing is the **single sentence of context** that plants the math in the player's mind at the exact moment dopamine is firing. The Tier 3 Gallery has rich facts, but they only appear when the user opens the gallery. Level-up time is the best possible teaching window.

### Design

- On every **new high** that has an entry in `LEVEL_FACTS`, a small card slides in from the bottom-right (or bottom-full-width on mobile).
- The card contains: the Fibonacci number + value, a one-sentence fact, an optional "Learn more →" link that opens the Tier 3 Gallery to the matching entry when one exists at this level.
- The card auto-dismisses after ~7 s (the `factSlide` animation completes), or the ✕ dismisses early.
- **User preference**: toggle in the Settings Display section (`state.suppressFacts`) silences every future card.
- Each fact shows exactly once per account (`state.factsShown[n]`). After an admin Reset, the user will see them again on re-progression since Reset only clears position state, not Tier 4 history.

### Catalog (`LEVEL_FACTS`)

One fact per Fibonacci milestone from F(3) to F(21), plus sparser entries at F(34), F(55), F(89), F(144). Sample:

- **F(5) = 5.** "Apple cores have five seed pockets in a star. Starfish have five arms. Most flowers have five petals. This isn't coincidence."
- **F(8) = 21.** "Sunflowers have 21 seed spirals in one direction (and 34 in the other — next level)."
- **F(13) = 233.** "The Fibonacci sequence appears in Pascal's triangle: the shallow diagonals sum to Fibonacci numbers. Try it."

See `LEVEL_FACTS` in `index.html` for the full 25-entry table.

### Implementation notes (`index.html`)

- **State additions:**
  ```js
  factsShown:    {},      // { [n]: true } — fact already displayed for this n
  suppressFacts: false,   // user preference (Display-section toggle)
  ```
- **`showLevelFact(n)`** — pure UI helper; no-ops if suppressed, already shown, or no entry for `n`. Updates `state.factsShown[n]`, triggers `debouncedSaveProgress`, restarts the animation by briefly clearing `display`/`animation` with a forced reflow. Wires "Learn more →" to `openGalleryModal()` + `openGalleryItem(n)` when `GALLERY.some(g => g.at === n)`.
- **`commitN(newN)` hook**: after `maybeSaveScore(newN)`, if `isNewHigh` call `showLevelFact(Math.abs(newN))`. Placement is deliberate — achievement toasts fire from the top-right, the fact card from the bottom-right, so they do not overlap visually.
- **Toggle** — the existing `.toggle-item[data-key="suppressFacts"]` in the Display section is picked up by the generic settings toggle handler; no bespoke wiring needed.

---

## Feature 12 — Classroom Challenge Mode

### Problem

Scott teaches CTE Process Technology. A teacher with a classroom-worthy tool wants to run a **timed event**: *"Class, let's see who reaches F(21) first. 30 minutes. Go."* The Tier 3 Weekly Challenge is automatic and community-wide; the Classroom Challenge is **teacher-created, short-lived, and scoped to a class**.

### Design

- Admin-only creation (gated by the existing `isAdmin` email-whitelist flag).
- Admin opens Settings → **Classroom Challenge** (ADMIN-badged section), picks a target (F(8) / F(13) / F(21) / F(34)) and a duration (5/10/15/30/60 min), optional name, and clicks **Create Challenge**.
- A 4-character join code is generated from `CHALLENGE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'` (no `0`/`O`/`1`/`I` — legibility-first). The admin auto-joins as the creator.
- Students open Fibonacci Zoom, click **🏫 Join Challenge** on the Account card, enter the code. They appear as participants.
- While active, a banner across the top of the app shows `{name} · Target F(n) · mm:ss left · Code: CODE · You: F(x) · rank/total` with an admin-only **End** button and a leave ✕ for everyone.
- Reaching the target writes `reachedTargetTs` and fires a ×3 confetti burst + a "You reached F(n)!" modal. The challenge continues until the timer expires or the admin ends early.
- When the challenge ends (timer or admin-end), the `onSnapshot` listener sees `status === 'ended'` and opens a final-results modal on everyone's screen showing the top 10 + the user's rank.
- Users who close the tab mid-challenge are auto-resumed on their next sign-in via a `collectionGroup('participants').where('uid', '==', uid)` query.

### Firestore schema (new)

```
challenges/{code} = {
  code, name, creatorUid, creatorName,
  targetN, startTs, endTs, endedEarly, status  // 'active' | 'ended'
}

challenges/{code}/participants/{uid} = {
  uid, displayName, photoURL,
  currentN, reachedTargetTs, joinedTs, updatedAt
}
```

### Implementation notes (`index.html`)

- **State addition (session-only apart from auto-resume on sign-in):**
  ```js
  challenge: {
    activeCode: null, isCreator: false, doc: null,
    unsubDoc: null, unsubList: null, startingN: 1,
  },
  _challengeTargetReached: false,
  ```
- **`createChallenge()`** — admin-only. Writes `challenges/{code}` with `status: 'active'`, auto-joins as creator, calls `renderAdminChallengePanel()` to flip the admin section to the "share this code" view with an **End Challenge Now** button.
- **`submitJoinChallenge()`** — reads the 4-char code, validates (exists, `status === 'active'`, `endTs > now`), closes the join modal, calls `joinChallenge(code)`.
- **`joinChallenge(code, asCreator)`** — writes the participants doc with the user's current `n`, starts the subscriptions.
- **`subscribeToChallenge(code)`** — two `onSnapshot` listeners: the doc (for countdown + status, which also triggers the results modal when status flips to `ended`) and the participants subcollection ordered by `currentN desc limit 20` (for live rank/leaderboard).
- **`reportChallengeProgress(n)`** — debounced 500 ms. Writes `currentN` and sets `reachedTargetTs` the first time `|n| >= targetN`, then fires `showChallengeCompleteBanner()`.
- **`handleChallengeEnd()`** — admin-only writes `status: 'ended'` once (idempotent via the `status === 'active'` guard). The results modal fires from everyone's `onSnapshot` listener via `_resultsShownForCode` dedupe.
- **`endChallengeSession()`** — tears down listeners, clears state, hides the banner, clears `_resultsShownForCode`, and restores the admin create form via `renderAdminChallengePanel()`.
- **`resumeActiveChallenge()`** (called from `onSignIn`) — `collectionGroup('participants').where('uid', '==', uid).get()`. For each match, fetches the parent challenge doc; if `status === 'active'` and `endTs > now`, re-subscribes. Requires the composite index noted above; catches with a `⚠️` console warning if the index isn't yet built.

### Admin vs student experience

- Admin sees the Classroom Challenge section in Settings; non-admin doesn't (handled by the existing `applyAdminVisibility()` on `data-admin="true"`).
- Admin's banner shows the extra **End** button; it's hidden for non-creators.
- Admin's Settings panel flips between "create form" and "active panel with code + End Now button" based on `state.challenge.activeCode && state.challenge.isCreator`.

---

## State + Firestore schema reference

### New `state` fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `boostTokens` | number | 0 | Spendable balance (can be fractional when Compound Interest is owned; display is floored) |
| `boostTokensLifetime` | number | 0 | Total ever earned, reserved for future achievements |
| `boostUpgrades` | object | `{}` | `{ [id: string]: true }` for owned upgrades |
| `clickCounter` | integer | 0 | Increments on every `tickInput` call; drives periodic bonuses |
| `engine.owned` | boolean | false | One-time purchase flag |
| `engine.upgrades` | object | `{}` | `{ [id: string]: true }` for owned engine upgrades |
| `engine.accumulator` | number | 0 | Fractional ticks pending (ephemeral, not saved) |
| `engine.lastTick` | number | 0 | `performance.now()` anchor (ephemeral, not saved) |
| `engine.enabled` | boolean | true | User-toggleable on/off |
| `streak.count` | integer | 0 | Consecutive daily claims (Tier 2) |
| `streak.longestCount` | integer | 0 | Personal best streak length |
| `streak.lastDateStr` | string | `''` | Local YYYY-MM-DD of last reward claim |
| `streak.freezesLeft` | integer | 1 | Available freezes, capped at 1 |
| `streak.lastFreezeRestoreWk` | string | `''` | ISO week of last weekly freeze restore |
| `streak.todayClaimed` | boolean | false | Transient per-session flag (not saved) |
| `achievements` | object | `{}` | `{ [id: string]: unlockedAtMillis }` |
| `lowestN` | integer | 1 | Furthest-negative n ever reached |
| `_dragExploredNs` | `Set<number>` | `null` | Transient explorer tracker (not saved) |
| `activeSkin` | string | `'classic'` | Currently-applied skin id |
| `_canvasBg` | string | `'#0a0e1a'` | Current canvas bg (skin-driven) |
| `_spiralStrokeCol` | string | `'#f1f5f9'` | Current spiral arc color (skin-driven) |
| `combo.count` | integer | 0 | Consecutive-click count (Tier 3, session-only) |
| `combo.lastClickAt` | number | 0 | `performance.now()` of last human click (session-only) |
| `combo.multTier` | number | 1 | Cached multiplier for current combo count |
| `combo.fadeTimer` | id | `null` | `setTimeout` id for combo fade-out |
| `goldenMoment.activeEl` | Element | `null` | Current on-screen golden-spiral DOM node |
| `goldenMoment.frenzyUntil` | number | 0 | `performance.now()` end of Frenzy buff (session-only) |
| `weekly.currentWeekId` | string | `''` | Active ISO week (e.g., `2026-W17`) |
| `weekly.clickCountThisWeek` | integer | 0 | Human clicks this week |
| `weekly.flowersThisWeek` | integer | 0 | Flowers collected this week |
| `weekly.tokensThisWeek` | integer | 0 | Tokens earned this week |
| `weekly.highestAbsNThisWeek` | integer | 0 | Peak |n| this week |
| `weekly.lowestNThisWeek` | integer | 1 | Deepest negative n this week |
| `weekly.championBadges` | array | `[]` | Past top-3 finishes `{weekId, rank, challenge, ts}` |
| `galleryViewed` | object | `{}` | `{ [atN]: true }` clears NEW dots |
| `factsShown` | object | `{}` | Tier 4 — `{ [n]: true }`; fact already displayed for this n |
| `suppressFacts` | boolean | `false` | Tier 4 — Display-section toggle to silence "Did you know?" cards |
| `challenge.activeCode` | string \| null | `null` | Tier 4 — session-only current challenge code |
| `challenge.isCreator` | boolean | `false` | Tier 4 — true when the user created the active challenge |
| `challenge.doc` | object \| null | `null` | Tier 4 — cached challenge doc from `onSnapshot` (session-only) |
| `challenge.unsubDoc` / `challenge.unsubList` | function \| null | `null` | Tier 4 — `onSnapshot` unsub handles (session-only) |
| `challenge.startingN` | integer | 1 | Tier 4 — user's n at join time |
| `_challengeTargetReached` | boolean | `false` | Tier 4 — transient flag to ensure target celebration fires once |

### New Firestore fields (all under `scores/{uid}` unless noted)

| Field | Type | Written by | Read by |
|---|---|---|---|
| `boostTokens` | number | `saveProgress`, `maybeSaveScore`, `buyBoost` (direct) | `onSignIn` |
| `boostTokensLifetime` | number | `saveProgress`, `maybeSaveScore`, `buyBoost` | `onSignIn` |
| `boostUpgrades` | map | `saveProgress`, `maybeSaveScore`, `buyBoost` | `onSignIn` |
| `engine` | map | `saveProgress`, `maybeSaveScore` | `onSignIn` |
| `offlineRateSnapshot` | number | `saveProgress` (on every flush) | `onSignIn` (offline tick calc) |
| `offlineSinceTs` | serverTimestamp | `saveProgress` | `onSignIn` |
| `streak` | map | `saveProgress`, `maybeSaveScore` | `onSignIn` (before `evaluateStreak`) |
| `achievements` | map | `saveProgress`, `maybeSaveScore` | `onSignIn` |
| `lowestN` | number | `saveProgress`, `maybeSaveScore` | `onSignIn` |
| `activeSkin` | string | `saveProgress`, `maybeSaveScore` | `onSignIn` (then `applySkin`) |
| `weekly` | map | `saveProgress`, `maybeSaveScore` | `onSignIn` (then `evaluateWeekly`) |
| `galleryViewed` | map | `saveProgress`, `maybeSaveScore`, `openGalleryItem` | `onSignIn` |
| `factsShown` | map | `saveProgress`, `maybeSaveScore`, `showLevelFact` | `onSignIn` |
| `suppressFacts` | boolean | `saveProgress`, `maybeSaveScore`, Settings toggle | `onSignIn` |

**New Firestore collection** `weeklyScores/{weekId}/entries/{uid}`:

| Field | Type | Written by | Read by |
|---|---|---|---|
| `uid` | string | `maybeUpdateWeeklyScore` | — |
| `displayName` | string | `maybeUpdateWeeklyScore` | `renderWeeklyLeaderboard` |
| `photoURL` | string | `maybeUpdateWeeklyScore` | `renderWeeklyLeaderboard` |
| `metricKey` | string | `maybeUpdateWeeklyScore` | `renderWeeklyLeaderboard` |
| `metric` | number | `maybeUpdateWeeklyScore` (2 s debounce) | `renderWeeklyLeaderboard`, `checkLastWeekChampion` |
| `updatedAt` | serverTimestamp | `maybeUpdateWeeklyScore` | — |

All writes use `{ merge: true }` to preserve the pre-existing `generatedName`, `displayName`, `photoURL`, and score fields.

**New Firestore collection (Tier 4)** `challenges/{code}`:

| Field | Type | Written by | Read by |
|---|---|---|---|
| `code` | string | `createChallenge` | `renderChallengeBanner`, `renderAdminChallengePanel` |
| `name` | string | `createChallenge` | `renderChallengeBanner`, `showChallengeResultsModal` |
| `creatorUid` | string | `createChallenge` | `resumeActiveChallenge`, security rule |
| `creatorName` | string | `createChallenge` | — |
| `targetN` | integer | `createChallenge` | `reportChallengeProgress`, `showChallengeCompleteBanner` |
| `startTs` | serverTimestamp | `createChallenge` | — |
| `endTs` | Timestamp | `createChallenge` | `renderChallengeBanner` countdown, `submitJoinChallenge`, `resumeActiveChallenge` |
| `endedEarly` | boolean | `handleChallengeEnd` (admin End-Now) | — |
| `status` | `'active' \| 'ended'` | `createChallenge`, `handleChallengeEnd` | `subscribeToChallenge` (fires results modal on end), `submitJoinChallenge`, `resumeActiveChallenge` |

**Subcollection** `challenges/{code}/participants/{uid}`:

| Field | Type | Written by | Read by |
|---|---|---|---|
| `uid` | string | `joinChallenge` | `resumeActiveChallenge` (via `collectionGroup`) |
| `displayName` | string | `joinChallenge` | `renderChallengeLeaderboard`, `showChallengeResultsModal` |
| `photoURL` | string | `joinChallenge` | — |
| `currentN` | integer | `joinChallenge`, `reportChallengeProgress` (500 ms debounce) | `renderChallengeLeaderboard` ordering, results modal |
| `reachedTargetTs` | serverTimestamp \| null | `reportChallengeProgress` on first target reach | — |
| `joinedTs` | serverTimestamp | `joinChallenge` | — |
| `updatedAt` | serverTimestamp | all writes | — |

### Key new functions

| Function | Purpose |
|---|---|
| `clickMultiplier()` | Pure reader — returns the product of owned non-periodic boost `tickMult` values |
| `applyTicks(amount)` | **Canonical** mass tick applier; crosses level boundaries, safety-capped at 1000 commits/call |
| `awardBoostTokens(absN)` | Called from `commitN` on new high; computes base + milestone bonus |
| `updateTokenDisplay()` | Updates balance span, re-renders boosts + engine cards |
| `renderBoosts()` / `boostsHtml()` | Desktop + mobile render of the boost catalog |
| `buyBoost(id)` | Purchase + persist a boost upgrade |
| `computeEngineRate()` | Pure reader — returns ticks/sec based on milestones + upgrades |
| `engineUpgradeCost(up)` | Applies Spiral Servos 50% discount where applicable |
| `renderEngine()` / `engineUpgradesHtml()` | Desktop + mobile render of engine status + upgrade catalog |
| `buyEngine()` | One-time engine unlock for `ENGINE_COST` |
| `buyEngineUpgrade(id)` | Purchase + persist an engine upgrade |
| `startEngineLoop()` | rAF loop that accumulates and applies engine ticks |
| `showOfflineWelcomeModal(ticks, cappedSec, wasCapped)` | Displays offline reward modal and wires the Collect button |
| `localDateStr(d?)` / `isoWeekStr(d?)` / `daysBetween(a, b)` | Tier 2 date helpers for streak evaluation |
| `streakReward(dayNum)` | Returns `Number(fibPos(min(dayNum, 14)))` |
| `evaluateStreak()` | Tier 2 — single decision point for streak advancement; chooses claim / freeze / reset |
| `showStreakClaimModal(freezeUsed?, wasReset?)` | Opens `#streakModal` with claim button wired |
| `showStreakInfoModal()` | Read-only variant invoked when the streak badge is clicked |
| `playStreak13Celebration()` | 5× confetti bursts + grants `phi_disciple` achievement |
| `updateStreakBadge()` | Syncs top-bar 🔥 badge with current count |
| `checkAchievements()` | Tier 2 — evaluates all 16 conditions; fires toasts for newly unlocked |
| `showAchievementToast(id)` / `openAchievementsModal(scrollToId?)` / `renderAchievementsGrid()` / `showAchievementFact(id)` | Achievement UI pipeline |
| `applySkin(id)` / `renderSkins()` / `showSkinUnlockToast(skin)` | Skin system |
| `comboMultiplier(count)` / `updateComboDisplay()` / `scheduleComboFade()` | Tier 3 — combo helpers |
| `initGoldenMoment()` / `scheduleNextGolden()` / `spawnGolden()` / `collectGolden(e)` | Tier 3 — random-reward pipeline |
| `showFrenzyBanner()` | Tier 3 — rAF countdown for ×7 Frenzy buff |
| `openGalleryModal()` / `renderGalleryGrid()` / `openGalleryItem(atN)` / `showGalleryUnlockToast(item)` | Tier 3 — gallery UI |
| `currentChallengeType(weekId?)` / `currentChallengeMeta(weekId?)` / `currentWeeklyMetric()` | Tier 3 — weekly meta readers |
| `evaluateWeekly()` | Tier 3 — week rollover + `checkLastWeekChampion` |
| `maybeUpdateWeeklyScore()` | Tier 3 — debounced write to `weeklyScores/{weekId}/entries/{uid}` |
| `checkLastWeekChampion(lastWeekId)` | Tier 3 — detects top-3 and pushes a badge |
| `showChampionToast(badge)` / `renderChampionBadges()` | Tier 3 — champion UI |
| `renderChallengeHeader()` / `formatTimeUntilMonday()` / `formatWeeklyMetric(key, value)` | Tier 3 — weekly LB header + formatting |
| `startWeeklyLeaderboardListener()` / `renderWeeklyLeaderboard(rows)` / `restartLeaderboardListener()` | Tier 3 — tab-switched LB wiring |
| `showLevelFact(n)` | Tier 4 — slide-in fact card for a Fibonacci level milestone |
| `generateChallengeCode()` | Tier 4 — 4-char code from the legible alphabet |
| `createChallenge()` | Tier 4 — admin-only, writes `challenges/{code}` and auto-joins creator |
| `submitJoinChallenge()` / `joinChallenge(code, asCreator)` | Tier 4 — validate + write participants doc |
| `subscribeToChallenge(code)` | Tier 4 — onSnapshot on doc + participants |
| `reportChallengeProgress(n)` | Tier 4 — debounced write of current n + target reach |
| `renderChallengeBanner()` / `renderChallengeLeaderboard(participants)` | Tier 4 — banner countdown + live rank |
| `showChallengeCompleteBanner()` | Tier 4 — target-reached celebration modal |
| `handleChallengeEnd()` / `showChallengeResultsModal()` / `endChallengeSession()` | Tier 4 — end-of-event flow |
| `renderAdminChallengePanel()` | Tier 4 — admin Settings flip between create form and active panel |
| `resumeActiveChallenge()` | Tier 4 — on sign-in, re-enters an active challenge via `collectionGroup('participants')` |

---

## Testing checklist

### Feature 1 — Boost Tokens + multipliers

- [ ] Start fresh, confirm 0 tokens displayed and "Reach F(3) to earn tokens" message shown
- [ ] Reach F(3), confirm `+N 🪙` popup and balance update
- [ ] Reach F(8), confirm milestone bonus (+5) applied on top of base award
- [ ] Buy ×2 Click, confirm subsequent clicks count as 2 ticks
- [ ] Buy ×2 + ×3, confirm clicks count as 3 ticks (2 × 1.5 = 3)
- [ ] Buy Fibonacci Fingers at F(8), click 5 times, confirm +F(5) popup on 5th click
- [ ] Buy Golden Touch at F(13), confirm +F(13) popup on 13th click
- [ ] Confirm locked boosts cannot be purchased (🔒 prefix, not clickable)
- [ ] Confirm unaffordable boosts show red cost
- [ ] Sign out and back in, confirm tokens + owned upgrades restored
- [ ] Confirm `applyTicks` advances multiple levels in one click if multipliers are high enough

### Feature 2 — Golden Ratio Engine

- [ ] Engine card hidden below F(13)
- [ ] Card appears at F(13) with "Unlock the Engine · 1000 🪙" button
- [ ] Buy deducts 1000 tokens; readout changes to `X.XX ticks/sec` + toggle
- [ ] Rate increases at milestone crossings (F(14), F(15), F(21), F(34))
- [ ] Toggle off halts auto-ticks (no `lastTick` drift on re-enable)
- [ ] Golden Gears: +1 flat tick/sec
- [ ] Spiral Servos: subsequent engine upgrades cost 50% less
- [ ] Compound Interest: engine ticks slowly grow the token balance
- [ ] Resonance Chamber: rate grows noticeably faster past F(34)
- [ ] Celebration zoom pauses the engine cleanly (no accumulator leak)

### Feature 3 — Offline Progress

- [ ] No engine owned → no offline modal on sign-in
- [ ] Engine owned, close tab, wait 1 min, reopen → modal shows with small tick count
- [ ] Simulate 9-hour absence (manually adjust `offlineSinceTs` in Firestore console) → modal shows "capped at 8h"
- [ ] Collect button applies ticks and closes modal
- [ ] Modal does not appear on quick page refresh (below meaningful threshold)
- [ ] Signing out and back in quickly does not double-award

### Feature 4 — Daily Streak

- [ ] New user signs in — day-1 claim modal shows with +1 token (F(1))
- [ ] Claim grants +1 token, badge updates to 🔥 1
- [ ] Close and reopen same day — no new modal (gap === 0 path)
- [ ] In devtools, set `state.streak.lastDateStr` back 1 day and call `evaluateStreak()` — day-2 modal shows (+1 token, F(2))
- [ ] Set back 2 days with `freezesLeft = 1` — modal shows "❄️ Freeze used", streak continues, `freezesLeft` decrements
- [ ] Set back 3 days with `freezesLeft = 0` — modal shows "Your streak reset", count = 1
- [ ] Click the streak badge after claim — info modal opens with no Claim button
- [ ] Reach streak day 13 — 5 confetti bursts fire, `phi_disciple` achievement unlocks
- [ ] Streak day 15 capped at F(14) = 377 tokens
- [ ] Freeze restoration: on a new ISO week, `freezesLeft` goes back up to 1 (never above)

### Feature 5 — Achievements

- [ ] Reach F(3) first time → Sprout toast + unlock
- [ ] Click the toast → achievements overlay opens, scrolled to Sprout
- [ ] Click Sprout card → fact overlay shows the branching-tree fact + unlock date
- [ ] Locked achievements render grayscale with "???" title and unlock hint
- [ ] Reach F(89) → Transcendent fires
- [ ] Buy any boost upgrade → First Boost fires
- [ ] Purchase the Engine → Autonomous fires
- [ ] Reach F(-5) → Through the Mirror fires; F(-13) → Antimatter fires
- [ ] Reach n=0 → The Zero Point fires
- [ ] Drag the number line across five distinct n values → Free Explorer fires
- [ ] Unlock all 15 other achievements → Completionist fires
- [ ] Count header reads "N / 16" and updates in real time
- [ ] Sign out / sign in → all unlocked achievements persist

### Feature 6 — Skins

- [ ] Fresh load → Classic skin active, others locked in settings grid
- [ ] Reach F(8) → Nautilus skin-unlock toast appears; card unlocks
- [ ] Click Nautilus in Settings → colors change across UI and canvas, redraw is immediate
- [ ] Reload → Nautilus remains active
- [ ] Reach F(13), F(21), F(34), F(55), F(89) → each unlocks the corresponding skin
- [ ] Negative spiral (e.g., F(-5)) renders in the active skin's `--red`, not hardcoded
- [ ] Boost / Engine / Account cards remain readable on every skin
- [ ] Switch skins mid-session → canvas redraws without flicker
- [ ] Click a skin-unlock toast → Settings opens and scrolls to the card

### Feature 7 — Weekly Class Challenge

- [ ] Weekly tab appears on the Leaderboard card
- [ ] Challenge header shows "This Week: {title}" + description + countdown
- [ ] `weekId` computed correctly (`YYYY-Wxx`)
- [ ] Clicking racks up `weekly.clickCountThisWeek`; every 10 clicks writes to Firestore
- [ ] Reaching a new peak writes the new `highest` metric on the "Highest Peak" week
- [ ] Reaching a new depth writes the new `lowest` metric on the "Deepest Dive" week
- [ ] Collecting flowers increments `weekly.flowersThisWeek`
- [ ] Earning boost tokens increments `weekly.tokensThisWeek`
- [ ] Two accounts on the same week see each other in real time (different browsers)
- [ ] Manually setting `state.weekly.currentWeekId = ''` and reloading → `evaluateWeekly()` resets counters
- [ ] User finishes in top 3 of last week → champion toast + medal shown under Account card

### Feature 8 — Gallery

- [ ] Gallery 🖼️ button visible next to Achievements 🏆
- [ ] Grid shows 10 entries; locked ones render as grayscale emblems with F(n) captions
- [ ] Reach F(3) — Nautilus unlocks, toast fires, image viewable
- [ ] NEW dot disappears after first view of the item
- [ ] Image load failure falls back to emblem placeholder (simulate by blocking Wikimedia)
- [ ] Full-view modal shows image + title + fact + unlock line
- [ ] Click backdrop closes modal

### Feature 9 — Combo

- [ ] Click 4 times rapidly — combo display hidden (< 2 threshold for first render)
- [ ] Click 5 times within 1s each → ×1.5 visible, tick output reflects it
- [ ] Click 10 times → ×2
- [ ] Click 21 times → ×3 and `combo_21` achievement unlocks
- [ ] Click 55 times → ×5 and `combo_55` achievement unlocks
- [ ] Pause 2 seconds → combo display fades out, combo resets
- [ ] Engine running autonomously → combo does NOT build from engine ticks
- [ ] Reload — combo state does not persist (intentional)

### Feature 10 — Golden Moment

- [ ] Reach F(5), play for 2–5 minutes — golden spiral appears at random position
- [ ] Click the spiral — one of 3 rewards fires; `golden_touch` achievement unlocks on first catch
- [ ] Drawing the "Frenzy" outcome → amber banner shows, countdown updates, ×7 applies to both clicks and engine ticks
- [ ] Frenzy banner counts down to 0 and disappears cleanly
- [ ] Tab away during a spawn, come back → scheduler resumes (no orphan spawns)
- [ ] Does not spawn during celebration zoom
- [ ] Does not spawn below F(5)
- [ ] Multiple catches over a session — rewards feel varied (rough 50/35/15 split)

### Feature 11 — Level Pop-ups

- [ ] Reach F(3) for first time → fact card slides in from bottom-right with F(3)=2 fact
- [ ] Auto-dismiss after ~7 s
- [ ] ✕ dismisses early
- [ ] "Learn more →" opens Tier 3 Gallery to the matching entry (F(3) → Nautilus, F(6) → Sunflower, …)
- [ ] Level with no gallery entry (e.g., F(4)) — "Learn more" hidden
- [ ] Toggle "Hide Did You Know? cards" in Display settings — no cards on new levels
- [ ] Fact only shows once per `n` per account (re-reaching F(3) does not re-show)
- [ ] After an admin Reset + re-progress, cards do NOT reappear (factsShown persists across sessions; clear manually via Firestore console if needed)
- [ ] On mobile (<640px): fact card spans full width at the bottom

### Feature 12 — Classroom Challenge

Admin flow:
- [ ] Admin user sees the "Classroom Challenge" ADMIN-badged section in Settings
- [ ] Non-admin user does NOT see the section
- [ ] Create challenge with target + duration → 4-char code generated, Firestore `challenges/{code}` written, admin auto-joins as creator, Settings panel flips to the "share this code" view
- [ ] Banner appears with countdown + the admin-only **End** button
- [ ] Clicking **End Challenge Now** (confirm dialog) flips the doc to `status: 'ended'`; results modal fires for admin + all participants

Student flow:
- [ ] **🏫 Join Challenge** button visible in desktop + mobile Account card after sign-in
- [ ] Invalid code → "No challenge with that code"
- [ ] Expired code → "This challenge has expired"
- [ ] Ended code → "This challenge has ended"
- [ ] Valid active code → banner appears with countdown + current rank
- [ ] Commit advances write `currentN` (debounced 500 ms) — ranking updates in real time across browsers
- [ ] Reaching target → confetti ×3 bursts + "You reached F(n)!" modal; `reachedTargetTs` written exactly once
- [ ] Leave ✕ in banner → confirm → local challenge session ends (but participant doc remains for ranking)
- [ ] Challenge timer expires → results modal shows for everyone, not just admin

Persistence / resume:
- [ ] Close tab mid-challenge, reopen → banner re-appears, subscriptions re-attach via `collectionGroup('participants')` query
- [ ] First run of the query in a new Firebase project prompts to create the `participants` composite index; create it, re-test
- [ ] Once the challenge ends while tab is closed, next sign-in does NOT auto-resume (`status === 'ended'` skipped)

---

## Maintenance notes

- **Do not add** extra synchronous Firestore writes inside `tickInput` or the engine loop. All persistence goes through `debouncedSaveProgress()` (2s cadence) or the visibility-change flush.
- **`applyTicks` is the canonical mass-tick entry point.** `tickInput`, `bulkTick`, the engine loop, and the offline-collect button all funnel through it. Do not re-introduce the old "single subStep++ per call" pattern.
- **Power-ups bypass click multipliers** — flower (+5) and smiley (+55, +1..+34) pass raw Fibonacci counts to `bulkTick`. Do not multiply these; the reward is already the design-time Fibonacci value.
- **Periodic bonuses are client-side only.** `clickCounter` resets on page reload (it's not persisted); this is intentional — the bonus cadence is 5 and 13 clicks, short enough that session resets are unnoticeable.
- **Admin Reset (⚙️ → Reset)** resets `state.n`, `state.subStep`, `state.rotation`, and `state.highestAbsN` back to 1 but deliberately does **not** clear `boostTokens` or `boostUpgrades`. This preserves progression investment across test resets. If a fully-clean reset is ever wanted, add explicit clears in the reset handler.
- **Single-file discipline preserved.** Everything still lives in `fibonacci-zoom/index.html`. No new files were added to the runtime bundle.
- **Unchanged and must stay unchanged:** `buildSquares`, `arcParams`, the transform order, `fibPos`, `fib`, `stepsForN`. These are unit-verified Fibonacci math.

### Tier 2 maintenance notes

- **`checkAchievements()` is deliberately not debounced.** It runs a short (~16) flag check and shows toasts immediately on state changes. The number-line drag handlers already guard by size (`>= 5`) so the function only fires on pixel-motion when the Explorer threshold is hit.
- **Streak sequencing must not show two modals at once.** If the offline modal fires on sign-in, its Collect handler calls `evaluateStreak()` at the end. Otherwise `onSignIn` calls `evaluateStreak()` directly. Never call both paths in the same frame.
- **Day rollover uses local calendar date, not UTC or 24-hour rolling.** `localDateStr(d)` returns `YYYY-MM-DD` in the user's locale. A user in Tokyo and a user in LA can both see their streak advance at their own local midnight.
- **Freezes cap at 1.** Weekly restore uses `Math.max(state.streak.freezesLeft, 1)` — accumulation is intentionally disallowed.
- **Skins override CSS variables + two canvas fields only.** The `col(i)` per-level palette and semantic `--txt` (label color) are intentionally not skinned. Do not add more canvas-color overrides without updating this document and the testing checklist.
- **Transient-only state fields** (`_dragExploredNs`, `streak.todayClaimed`, `_canvasBg`, `_spiralStrokeCol`) must not be written to Firestore — that would force clients to re-derive them on read. `_canvasBg` and `_spiralStrokeCol` are derived on sign-in from `applySkin(activeSkin)`.
- **Achievement `id` strings are part of the storage contract.** Renaming one would orphan existing users' data. If renaming is ever needed, add a migration that copies old → new inside `onSignIn`.

### Tier 3 maintenance notes

- **Firestore security rule is required** for the `weeklyScores/{weekId}/entries/{uid}` collection — without it, weekly writes fail silently (caught in `console.error`). Deploy the rule from this document alongside any v3.0 release.
- **Multiplier stacking order is load-bearing feel.** `tickInput` computes `clickMultiplier() × combo.multTier × (frenzy ? 7 : 1)` and then adds the Tier 1 periodic bonuses (Fingers / Touch). Do not reorder — the stacking multiplication is what makes a 55-combo during Frenzy feel dramatic without exponential runaway.
- **Engine bypasses combo, shares Frenzy.** The engine loop calls `applyTicks` directly and therefore never contributes to or reads `state.combo`. It does honor Frenzy because Frenzy is a session-wide buff, not a rhythm reward.
- **Golden Moment timing never walks forward.** Each cycle schedules **exactly one** `setTimeout` via `scheduleNextGolden()`. The `clearGoldenTimer()` call at the start of `scheduleNextGolden()` prevents drift or duplicate spawns if `initGoldenMoment()` is called twice (e.g., at boot and again when crossing F(5)).
- **Weekly counters reset on ISO-week rollover only.** `evaluateWeekly()` is idempotent — calling it twice in the same week is a no-op. Don't call it on every commit; `onSignIn` (and the eventual post-midnight re-fire if we add a timer later) is enough.
- **`galleryViewed` is content-keyed by `atN`, not gallery index.** If the `GALLERY` array is reordered, users' NEW dots still track correctly because they're indexed by the Fibonacci level, not the array position.
- **Gallery image URLs are Wikimedia Commons direct links.** If one 404s in the future, replace the `src` and leave everything else alone. The `onerror` fallback to the emblem placeholder means a dead URL degrades gracefully, but the caption will still say the title — not ideal for a broken link.
- **Champion badges live on the client.** `checkLastWeekChampion()` runs a `get()` at week rollover and writes to the user's own `scores/{uid}` doc. This is intentionally client-side (no Cloud Functions needed). Drift across clients is acceptable — a user who never signed in last week won't get the badge retroactively, which is the right behavior.
- **Session-only state does not persist.** `combo`, `goldenMoment.activeEl`, `goldenMoment.frenzyUntil` all reset on reload. `state.achievements.combo_21`, `combo_55`, and `golden_touch` persist — the achievements are permanent even though the mechanical state isn't.

### Tier 4 maintenance notes

- **Firestore security rule is required** before Feature 12 works. Deploy the updated rule (snippet under "Required Firestore security-rules update" above). Without it, `create` / `join` / progress writes fail silently and the teacher sees an empty challenge.
- **Composite index is required** before auto-resume works. Firebase prompts with a one-click link the first time `resumeActiveChallenge` runs; create it. Until then, `⚠️  Resume-challenge lookup skipped` prints and the student must re-enter their code.
- **No Cloud Functions.** Challenge end + results detection is purely client-driven via `onSnapshot` on `challenges/{code}`. The admin commits `status: 'ended'`; every other client's listener sees it and fires the results modal. `_resultsShownForCode` dedupes against re-fires if the status listener fires multiple times.
- **Timer countdown is a `setInterval(1 s)`** scheduled inside `renderChallengeBanner`. On each snapshot update, the old interval is cleared; on session end, `endChallengeSession()` clears it too. Do not move the `setInterval` outside the snapshot callback — re-triggering on every render resets correctly only because the old interval is cleared first.
- **Reporting progress is debounced 500 ms.** One student clicking rapidly does not spam Firestore. The target-reached flag (`_challengeTargetReached`) is session-only and ensures the celebration modal fires exactly once even with late retries.
- **`LEVEL_FACTS` keys are absolute `n`** (always positive integers). `showLevelFact` is called with `Math.abs(newN)` — this is intentional since the facts describe Fibonacci values and F(-n) shares the magnitude of F(n).
- **Facts persist across account resets.** `state.factsShown` is saved to Firestore so a user who reaches F(3) once never sees the card twice. If a teacher wants students to re-experience the facts, they can clear the field manually in the Firestore console or the student can toggle the setting off and back on (currently the toggle suppresses but does not re-enable; adding a per-level "mark unseen" button is a future task).
- **Single active challenge per user.** Joining a second challenge implicitly ends the first locally by overwriting `state.challenge.activeCode` (the old listeners are torn down by `subscribeToChallenge` which calls `unsub()` before re-subscribing). The user's old participant doc remains in Firestore for the old challenge's ranking.

---

## Changelog

### v2.0 — Tier 1 (Boosts + Engine + Offline)

- **Added** Boost Tokens currency, earned on every new `|n|` high with Fibonacci milestone bonuses.
- **Added** 7-entry boost-upgrade catalog with unlocks from F(3) to F(55); multipliers stack multiplicatively; two entries (`fingers`, `touch`) are periodic Fibonacci bonuses rather than flat multipliers.
- **Added** Golden Ratio Engine — one-time unlock at F(13), auto-ticks at `φ^levelsCrossed` scaling with 4 upgrades (Golden Gears, Spiral Servos, Compound Interest, Resonance Chamber).
- **Added** Offline progress — capped at 8 hours, gated on engine ownership, surfaced via a "Nautilus Sleeps" welcome modal.
- **Refactored** `tickInput`, `bulkTick`, and the new engine loop to funnel through `applyTicks(amount)`, which crosses level boundaries in a single click when multipliers are high enough.
- **Added** `visibilitychange` → `saveProgress()` flush so the offline anchor stays fresh on tab close.
- **Firestore** — new fields `boostTokens`, `boostTokensLifetime`, `boostUpgrades`, `engine`, `offlineRateSnapshot`, `offlineSinceTs`. All writes merged; existing users pick up zero defaults with no migration.
- **CSS** — new `.boost-row` family and `.engine-status`. No changes to existing selectors.
- **HTML** — new `#boostsCard`, `#engineCard` in the desktop right sidebar; mirrored `#mobileBoostsCard`, `#mobileEngineCard` in the mobile bottom sheet; new `#offlineModal` overlay.

### v2.5 — Tier 2 (Streak + Achievements + Skins)

- **Added** Daily Streak system with Fibonacci rewards (F(1)..F(14) capped), weekly freeze restore, and a day-13 confetti + badge celebration.
- **Added** Achievements system — 16 collectible trophies spanning progression, negative exploration, engagement, and oddities. Each ships a prose fact about the Fibonacci number's real-world appearance. Completionist rewards unlocking the other 15.
- **Added** Themed Skins — 7 cosmetic palettes (Classic, Nautilus, Sunflower, Galaxy, Hurricane, Fern, Cosmic). Unlocks at F(0), F(8), F(13), F(21), F(34), F(55), F(89). One active at a time; no token cost.
- **Added** top-bar streak badge (🔥) and achievements gallery button (🏆); both work on desktop and mobile.
- **Added** HTML: `#streakModal`, `#streakBadge`, `#achievementsBtn`, `#achievementsOverlay`, `#achievementToasts` container, skins section in Settings overlay.
- **Added** CSS: `.streak-badge`, `.achievement-toast`, `.ach-grid`, `.ach-card`, `.ach-fact-overlay`, `.ach-fact-card`, `.skins-grid`, `.skin-card`.
- **Refactored** `drawSpiral` to read `state._canvasBg` for the canvas fill and `state._spiralStrokeCol` for the positive-n arc stroke; negative-n red is read live from the active skin's `--red` CSS variable.
- **Firestore** — new fields `streak`, `achievements`, `lowestN`, `activeSkin`. Merged writes only; existing users pick up defaults (`?? 0 / ?? {} / ?? 'classic'`).
- **Hooks wired in:** `commitN` tracks `lowestN` + calls `checkAchievements()` + fires skin-unlock toasts; `buyBoost` / `buyEngine` call `checkAchievements()`; number-line drag handlers populate `_dragExploredNs`; `onSignIn` restores all Tier 2 state, applies the skin, and sequences the streak modal after the offline modal.

### v3.0 — Tier 3 (Combo + Golden Moment + Gallery + Weekly Challenge)

- **Added** Weekly Class Challenge with 5-way rotation (Highest Peak, Deepest Dive, Most Clicks, Flower Hunter, Token Magnate), Leaderboard tabs (All-time / Weekly), per-week challenge header + countdown, and champion-medal detection on week rollover.
- **Added** "Found in Nature" Gallery with 10 Wikimedia Commons image entries unlocking every 3 levels (F(3) → F(30)). Each entry ships a prose fact; images fall back to an emblem placeholder on load failure. NEW dot marks unviewed unlocks.
- **Added** Combo System — 1-second click window, 5/10/21/55 tiers giving ×1.5/×2/×3/×5 multipliers, floating #comboDisplay badge, with `combo_21` (Streaking) and `combo_55` (Unstoppable) achievements.
- **Added** Golden Moment — Cookie-Clicker-style random spawn every 2–5 min for 8 s. Weighted rewards: 50% `+F(n)` ticks, 35% 5–34 🪙, 15% 30-second Frenzy buff (×7 on clicks and engine ticks). `golden_touch` (Seized the Moment) achievement on first catch.
- **Refactored** `tickInput` — Combo and Frenzy multipliers now stack on top of `clickMultiplier()` (order: ClickMult × Combo × Frenzy, then Tier 1 periodic bonuses added).
- **Refactored** engine loop — honors Frenzy (×7) but intentionally bypasses Combo.
- **New Firestore collection** `weeklyScores/{weekId}/entries/{uid}`. Requires a security-rule update in the Firebase console (documented in this file under "Required Firestore security-rules update").
- **Added** Firestore fields on `scores/{uid}`: `weekly`, `galleryViewed`. New achievements persist within existing `achievements` map.
- **HTML:** top-bar gallery button (🖼️), gallery grid + item overlays, #comboDisplay + #frenzyBanner inside the canvas-box, lb-tabs + challenge-header on the Leaderboard card, champion-badges row in Account cards.
- **CSS:** `.lb-tabs`, `.lb-challenge-header`, `.champion-badges`, `#comboDisplay` + `.combo-count` + `.combo-mult` + `@keyframes comboPulse`, `.golden-moment` + `@keyframes goldenPulse`, `#frenzyBanner` + `.frenzy-bar` + `@keyframes frenzyShimmer`, `.gallery-grid` + `.gallery-card` + `.new-dot`.

### v3.1 — UX polish (post-Tier-3)

Classroom-test feedback pass on Tier 1/2/3 feel. No new systems; everything is presentation.

- **Gallery images** — swapped pinned Wikimedia thumb URLs for Wikipedia `Special:FilePath` redirects. This follows file renames automatically and survives a broader set of Wikimedia cache edge cases. Each entry gains a `wiki` slug and the gallery-item modal now shows a **Read more on Wikipedia →** link next to the unlock line.
- **Gallery item modal** — if the thumb fails to load, the `<img>` hides instead of rendering as a broken icon (the fact + Wikipedia link still carry the value).
- **Gallery tiles** — min column width bumped from 120 px to 180 px; tiles now use a 4:3 image area with a dedicated `.img-wrap` + readable Cormorant caption (13 px serif) below. Locked tiles show a larger, more visible placeholder emblem.
- **Achievement / skin / gallery unlock toasts** — dwell time raised from 5 s to **12 s** so readers have time to finish the fact. Toasts now carry the full "Did you know?" fact inline (`.ach-fact`), pause on hover, and ship a ✕ close button. Click-body still jumps to the achievement card.
- **Always-visible desktop panels** — Achievements and Found-in-Nature are no longer hidden behind icon buttons. The left sidebar now hosts two compact panels (Achievements grid of 16 emblems, Gallery grid of 10 thumbnails). Clicking any unlocked cell opens the same fact card / gallery-item modal as before. Top-bar 🏆 and 🖼️ icon buttons are hidden on desktop (≥900 px) since the content is always on screen.
- **Boosts card prominence** — larger title (`⚡ Boosts · N 🪙` 16–18 px), 14 px boost names, 13 px cost pills with tinted backgrounds. When any owned-but-affordable upgrade is waiting, the card border pulses amber (`.boosts-ready`) so players notice they can spend.
- **Mobile bottom sheet** — now mirrors the desktop sidebars. Account, Boosts, Engine, **Achievements, Found-in-Nature**, and Leaderboard are all in the sheet. On mobile the 🏆 and 🖼️ icon buttons stay (quick access into the fact modals) while the bottom sheet carries the browse-grid affordance. Same render pipeline feeds both desktop (`#sidebar*Grid`) and mobile (`#mobile*Grid`) targets.
- **CSS additions** — `.card-hint`, `.card-title-count`, `.sidebar-ach-grid`/`.sidebar-ach-emblem`, `.sidebar-gallery-grid`/`.sidebar-gallery-tile`, `.gallery-card .img-wrap`, `.toast-close`, `.boosts-ready`.
- **JS additions** — `renderSidebarAchievements()` and `renderSidebarGallery()` render the same content into both desktop and mobile IDs. Hooked into `checkAchievements`, `commitN` (after gallery unlock), `openGalleryItem` (to clear NEW dots), boot, and both `onSignIn` success branches.

### v4.0 — Tier 4 (Level Facts + Classroom Challenge)

- **Added** "Why Does This Matter?" level-up fact card (`#factCard`) with 25-entry `LEVEL_FACTS` catalog covering F(3)–F(21) plus F(34), F(55), F(89), F(144). "Learn more" link opens the Tier 3 Gallery to the matching entry when available.
- **Added** Display-section Settings toggle to suppress fact cards (`state.suppressFacts`). Fact visibility tracked per-level in `state.factsShown`.
- **Added** Classroom Challenge Mode — admin-only 5/10/15/30/60-minute classroom events with 4-character join codes from an I/O/0/1-free alphabet, live countdown banner + rank, confetti celebration on reaching target, final results modal for everyone on challenge end, and admin "End Challenge Now" shortcut.
- **Added** auto-resume of in-progress challenges on sign-in via `collectionGroup('participants').where('uid', '==', uid)` — surviving closed tabs and browser restarts.
- **New Firestore collection** `challenges/{code}` + subcollection `participants/{uid}`. Requires a security-rule update (documented in this file) and a composite index on `participants` collection group by `uid` (Firebase prompts to create it).
- **Hooks wired in:** `commitN` → `showLevelFact(Math.abs(newN))` on new high; `commitN` → `reportChallengeProgress(newN)` when `state.challenge.activeCode`; `onSignIn` → `resumeActiveChallenge()` in both the data-exists and first-time-sign-in branches.
- **UI:** top-bar challenge banner, desktop + mobile 🏫 Join Challenge buttons in the Account card, admin-badged Classroom Challenge section in Settings with `data-admin="true"` gating.
- **CSS:** `.fact-card` + `@keyframes factSlide` + `.fact-link`/`.fact-level`/`.fact-text` + mobile-bottom-full-width variant; `.challenge-banner` + `.ch-banner-main`/`.ch-banner-title`/`.ch-banner-code`/`.ch-banner-rank`/`.ch-banner-end`/`.ch-banner-leave` + mobile sizing.

### v4.1 — Memory + crash-fix pass (Chromebook stability)

Classroom-report: the tab was crashing on low-RAM Chromebooks after a few minutes of active play. This pass is Pass A (instrument) + minimal Pass B (mechanical fixes with the biggest expected relief) from the crash-fix plan. No gameplay changes — purely memory / GC / rAF hygiene.

- **DPR clamp on low-memory devices.** Detects `navigator.deviceMemory ≤ 4` or `navigator.hardwareConcurrency ≤ 4` (typical classroom Chromebook) via a new `LOW_MEM_DEVICE` flag and caps `DPR` at **1.0** instead of 1.5. Across our three canvases this roughly halves the GPU backing-store footprint — the single biggest expected win.
- **Skin-red stroke cached.** `applySkin()` now sets `state._negStrokeCol` once per skin apply. `drawSpiral` used to call `getComputedStyle(document.documentElement).getPropertyValue('--red')` every frame during celebration / smooth zoom (60×/s during a 5 s celebration at high n). The computed-style object is now bypassed entirely in the hot path.
- **Orphan Mona Lisa `<img>` removed.** Tier 3 shipped the gallery entry for F(12) but left behind the pre-Tier-3 hidden `<img id="monaLisa">` at the top of `<body>` plus the `drawSpiral` block that drew it. That's gone now: one fewer external image fetch on boot, one fewer `getElementById` + alpha swap per paint at n ≥ 12.
- **Toast overflow cap.** `TOAST_MAX = 3`; a new `appendCappedToast(container, toast)` helper drops the oldest live toast if a 4th fires. Before: reaching F(13) could stack 5–6 toasts (achievement + skin + gallery + level-fact + streak + boost) for 12 s each; that DOM balloon is gone.
- **Confetti global cap + per-frame compaction.** `CONFETTI_GLOBAL_CAP = 300`; `launchConfetti` honors remaining headroom, and `animateConfetti` compacts dead particles out of the array every frame (they used to sit until ALL particles faded, so rapid n=9 clicks caused `confettiParticles` to grow without bound during active play).
- **Engine rAF tear-down.** New `stopEngineLoop()`. The single `visibilitychange` listener now cancels the engine rAF on tab-hide and restarts it on show (plus still flushes `saveProgress`). A backgrounded tab no longer holds a throttled-but-alive rAF chain running the engine loop's early-returns forever.
- **Memory diagnostic panel (admin only)** — new "Memory" section in the Settings overlay. Live readouts at 2 s cadence **only while the panel is open** (zero cost otherwise):
  - `performance.memory.usedJSHeapSize` / `jsHeapSizeLimit` (Chrome-only)
  - Total DOM node count
  - Canvas backing-store bytes + DPR (shows `(low-mem)` when the clamp kicked in)
  - Live `confettiParticles.length` / cap
  - Live `#flowerLayer` children (flowers + smileys + golden moments)
  - Live `#achievementToasts` children / `TOAST_MAX`
  - Active rAF loops (`engine`, `celebration`, `nlDrag`, `frenzy`, `challenge`)
  - Current `n` / `highestAbsN` / token balance
- **Stress-test button** — fires 300 synthetic `tickInput(+1)` calls over ~3 s, then reports a before/after `Δ heap` below the live readouts. Use this to verify the clamp + caps are holding and to catch regressions in future PRs.

No state shape changes; fully backward-compatible. No Firestore schema changes.

### v4.2 — Login-harden pass

Classroom report after the move from the prior repo to `coolstemgames.com`: Google sign-in not working. Root cause was two-fold and both pieces are addressed in this release.

**Root cause A (operator): Firebase Authorized Domains.** When a Firebase-backed app moves to a new host, the new hostnames must be added to the Firebase Auth "Authorized Domains" list before OAuth popups/redirects are accepted. Without this, the popup/redirect silently fails with `auth/unauthorized-domain`. **Operator checklist — do this once per environment:** Firebase Console → Authentication → Settings → Authorized domains → add `coolstemgames.com`, `www.coolstemgames.com`, and `coolstemgames.pages.dev`. Keep the default `localhost` and `fibonacci-zoom.firebaseapp.com` on the list. No redeploy required.

**Root cause B (code): `signInWithPopup` silently fails on school Chromebooks.** Chrome's increasingly strict third-party cookie policy — combined with Google Workspace for Education's popup-blocker enterprise policies — means the popup opens, the user picks an account, the popup closes, and the `Promise` returned by `signInWithPopup` never resolves. To the classroom user it looks like "Sign in with Google does nothing." The pre-v4.2 code routed Android and iOS to `signInWithRedirect` but kept popup for everything else, which meant Chromebooks (our primary audience) got the broken path.

**Fix: `signInWithRedirect`-first on every browser.**

- `doSignIn()` now calls `currentUser.linkWithRedirect(provider)` (for anonymous users upgrading to Google) or `fbAuth.signInWithRedirect(provider)` (for sign-out-then-sign-in) unconditionally. The UA sniff (`isMobile`) is gone.
- `getRedirectResult()` at init already existed; it now also routes `auth/credential-already-in-use` errors through the existing `handleLinkError` helper so the "this Google account is already attached to a different UID" case still transparently falls back to `fbAuth.signInWithCredential(cred)`. Pre-v4.2 that error arrived synchronously via `linkWithPopup`'s `.catch`; with redirect it arrives on the return visit via `getRedirectResult`.
- Nothing else changes: `onAuthStateChanged`, `doSignOut`, `ADMIN_EMAILS`, the `FIREBASE_CONFIG.authDomain = 'fibonacci-zoom.firebaseapp.com'` value, and the `_headers` file are all unchanged.

**What we verified and did NOT change.** `_headers` was audited for a `Content-Security-Policy` — there is none, so CSP is not blocking Firebase. `FIREBASE_CONFIG.authDomain` must stay as `fibonacci-zoom.firebaseapp.com`; that is the OAuth handler host, not the app host, and swapping it to `coolstemgames.com` would break the flow rather than fix it.

**UX note.** Redirect-first replaces the popup with a full-page nav to Google and back. Mobile users (iOS/Android) already had this behavior; it is new for desktop. In exchange, the flow completes reliably on every classroom device.

### Future tiers (not in this release)

The Tier 4 source plan (`fibonacci-zoom/docs/Fibonacci Zoom Revision Tier 4.md`) closes out the planned four-tier revision arc. Tiers 1/2/3/4 together deliver:

- **Pacing (Tier 1)** — Boost Tokens, Golden Ratio Engine, Offline Progress.
- **Identity (Tier 2)** — Daily Streak, 16+ Achievements, Themed Skins.
- **Surprise + Community (Tier 3)** — Weekly Class Challenge, "Found in Nature" Gallery, Combo System, Golden Moment.
- **Classroom (Tier 4)** — Level Pop-up Facts, Classroom Challenge Mode.

Further work is out of scope for this revision document; any Tier 5+ features should ship under a new revision document (`FibonacciZoomRev3documentation.md`) to keep this file focused on the v2.0–v4.0 arc.

