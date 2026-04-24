# Fibonacci Zoom — Revision 2 Documentation

**Version:** v2.0 — Tier 1 (Boosts + Engine + Offline)
**Shipped:** 2026-04
**Author:** Scott Sandvik
**Source plan:** `fibonacci-zoom/docs/Fibonacci Zoom Revision Tier 1.md`

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

1. [Feature 1 — Boost Tokens + Click Multipliers](#feature-1--boost-tokens--click-multipliers)
2. [Feature 2 — Golden Ratio Engine](#feature-2--golden-ratio-engine)
3. [Feature 3 — Offline Progress](#feature-3--offline-progress)
4. [State + Firestore schema reference](#state--firestore-schema-reference)
5. [Testing checklist](#testing-checklist)
6. [Maintenance notes](#maintenance-notes)
7. [Changelog](#changelog)

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

### New Firestore fields (all under `scores/{uid}`)

| Field | Type | Written by | Read by |
|---|---|---|---|
| `boostTokens` | number | `saveProgress`, `maybeSaveScore`, `buyBoost` (direct) | `onSignIn` |
| `boostTokensLifetime` | number | `saveProgress`, `maybeSaveScore`, `buyBoost` | `onSignIn` |
| `boostUpgrades` | map | `saveProgress`, `maybeSaveScore`, `buyBoost` | `onSignIn` |
| `engine` | map | `saveProgress`, `maybeSaveScore` | `onSignIn` |
| `offlineRateSnapshot` | number | `saveProgress` (on every flush) | `onSignIn` (offline tick calc) |
| `offlineSinceTs` | serverTimestamp | `saveProgress` | `onSignIn` |

All writes use `{ merge: true }` to preserve the pre-existing `generatedName`, `displayName`, `photoURL`, and score fields.

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

---

## Maintenance notes

- **Do not add** extra synchronous Firestore writes inside `tickInput` or the engine loop. All persistence goes through `debouncedSaveProgress()` (2s cadence) or the visibility-change flush.
- **`applyTicks` is the canonical mass-tick entry point.** `tickInput`, `bulkTick`, the engine loop, and the offline-collect button all funnel through it. Do not re-introduce the old "single subStep++ per call" pattern.
- **Power-ups bypass click multipliers** — flower (+5) and smiley (+55, +1..+34) pass raw Fibonacci counts to `bulkTick`. Do not multiply these; the reward is already the design-time Fibonacci value.
- **Periodic bonuses are client-side only.** `clickCounter` resets on page reload (it's not persisted); this is intentional — the bonus cadence is 5 and 13 clicks, short enough that session resets are unnoticeable.
- **Admin Reset (⚙️ → Reset)** resets `state.n`, `state.subStep`, `state.rotation`, and `state.highestAbsN` back to 1 but deliberately does **not** clear `boostTokens` or `boostUpgrades`. This preserves progression investment across test resets. If a fully-clean reset is ever wanted, add explicit clears in the reset handler.
- **Single-file discipline preserved.** Everything still lives in `fibonacci-zoom/index.html`. No new files were added to the runtime bundle.
- **Unchanged and must stay unchanged:** `buildSquares`, `arcParams`, the transform order, `fibPos`, `fib`, `stepsForN`. These are unit-verified Fibonacci math.

---

## Changelog

### v2.0.1 — Tier 1 follow-up: Chromebook memory fixes

Audit reason: classroom Chromebooks (2–4 GB RAM) were reported to "hang on to memory and crash" during long play sessions. Targeted three accumulators/lifecycles on the Tier 1 codebase:

- **Capped** `_memo` (BigInt Fibonacci cache) and `_fibNumMemo` (Number cache) at `MEMO_MAX = 512` entries each. On overflow, the map is cleared and reseeded with the `[0, 1]` identity pair — O(1) amortized, and the cost of recomputing the iterative loop is negligible compared to unbounded growth of multi-KB BigInts per `k` visited.
- **Added** `stopEngineLoop()` and extended the `visibilitychange` listener to call it on tab hide. Chrome pauses `requestAnimationFrame` for hidden tabs, so without the pause the first post-unhide callback received a `dt` equal to the full hidden duration (possibly minutes) and flooded `commitN` with thousands of ticks in a single frame — a real crash vector on weak Chromebook GPUs. On resume we reset `state.engine.lastTick` to `performance.now()` before restarting, eliminating the dt spike.
- **Unsubscribed** the leaderboard `onSnapshot` on tab hide; re-subscribe via `startLeaderboardListener()` on show. Prevents Firestore callbacks from firing into DOM that has been paged out by the OS.
- `saveProgress()` on hide is preserved (offline anchor stays fresh).

**Do not** re-introduce unbounded `.set`/`.push` in session-lifetime caches, and **always** pair an `onSnapshot`/engine-rAF start with a matching teardown in the `visibilitychange: hidden` path.

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

### Future tiers (not in this release)

See `fibonacci-zoom/docs/Fibonacci Zoom Revision Tier 2.md` and beyond for the next-up features. Tier 1 is intentionally the load-bearing retention loop; subsequent tiers layer on top without refactoring the systems introduced here.

