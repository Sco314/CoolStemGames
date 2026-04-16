# CLAUDE.md — Fibonacci Zoom project context

This file is for Claude Code. Read it at the start of every session before touching any code.

---

## Project overview

Single-file web app (`fibonacciZoom.html`). No bundler, no npm, no build step. Everything — HTML, CSS, JS, Firebase SDK script tags — lives in one file. Do not introduce a build system or split into multiple files unless explicitly asked.

**Owner:** Scott Sandvik (scottsandvik@gmail.com / ssandvik@gmail.com)  
**Firebase project:** fibonacci-zoom (ID: fibonacci-zoom)  
**License:** GPL-3.0  

---

## Architecture

### Single file layout order
1. `<head>` — Google Fonts (Cormorant Garamond + JetBrains Mono), `<style>` block
2. `<body>` — `.shell` layout div
3. Top bar (centered title + ⚙️ settings button + mobile account button)
4. Settings overlay (unified — both user settings and admin controls in one panel with ADMIN badges)
5. `.main-row` flex container:
   - `.sidebar` (left, 240px) — scroll hint card (hidden on mobile/tablet)
   - `.right-col` (flex:1) — number line canvas + spiral canvas stacked
   - `.sidebar-right` (right, 200px) — Account card + Leaderboard card (hidden <900px)
6. Mobile bottom sheet (`#mobileSheet`) — duplicated Account + Leaderboard for <640px
7. First `<script>` block — all game logic + mobile sheet wiring
8. Firebase CDN `<script>` tags (compat v10)
9. Second `<script>` block — Firebase init, auth, leaderboard, mobile sync

### Layout CSS variables
```css
--bg, --bg2, --card, --border
--amber (#f5a623), --amber-l (#fbbf24), --orange (#f97316)
--red (#e05c5c), --teal (#a8e6cf)
--txt, --txt2, --txt3
```

### Two canvases
- `#spiralCanvas` — Fibonacci rectangle tiling + spiral arcs. Uses `devicePixelRatio` scaling.
- `#nlCanvas` — horizontal number line. Same DPR scaling.
- Both resized via `ResizeObserver` on their parent containers.

---

## Mathematics — critical, do not change without understanding

### Fibonacci (BigInt)
```js
// Extended to negative indices: F(-n) = (-1)^(n+1) * F(n)
// Uses BigInt throughout to handle arbitrarily large values exactly
// Memoized in _memo Map
fibPos(n)   // positive n only, iterative
fib(n)      // all integers, calls fibPos for |n|, applies sign rule for negatives
fmt(v)      // BigInt → comma-separated string
```

### buildSquares(n, scale) — verified tiling
Direction cycle for k ≥ 3: `dir = (k-3) % 4`
- dir 0 → UP:    `y = minY - sz`
- dir 1 → LEFT:  `x = minX - sz`
- dir 2 → DOWN:  `y = maxY`
- dir 3 → RIGHT: `x = maxX`

k=1 placed at (0,0). k=2 placed to the RIGHT of k=1.

**Do not change this sequence.** It was derived and unit-tested. The arc chain depends on it exactly.

### arcParams(sq, i) — verified pivot table
This lookup table was derived and unit-tested: every arc's endpoint equals the next arc's start point exactly. The Fibonacci spiral is geometrically correct.

```
i=0: pivot=(x+size, y),      sa=π/2
i=1: pivot=(x,      y),      sa=0
i≥2, d=(i-1)%4:
  d=1: pivot=(x,      y+size), sa=−π/2
  d=2: pivot=(x+size, y+size), sa=π
  d=3: pivot=(x+size, y),      sa=π/2
  d=0: pivot=(x,      y),      sa=0
```

### Spiral eye
`eyeX = sq0.x + sq0.size`, `eyeY = sq0.y + sq0.size` (bottom-right corner of the first square). This is the fixed convergence point. The canvas transform keeps it pinned to `(W/2, H/2)`.

### Canvas transform (drawSpiral)
```js
ctx.translate(W/2, H/2);             // canvas centre
ctx.rotate(rotAngle);                 // accumulated rotation
ctx.translate(-eyeX + panX, -eyeY + panY);  // eye → origin + pan
```
The rotation pivot is always canvas centre. `state.rotation` accumulates `±π/2` per commit. This is correct. Do not add extra translate calls.

### Smooth zoom (fib-steps mode)
In fib-steps mode, `baseScale` is interpolated between the current level's scale and the next level's scale using eased progress:
```js
const eased = progress < 0.5 ? 2*progress*progress : -1+(4-2*progress)*progress;
baseScale = snapScale + (nextScale - snapScale) * eased;
```
This parallels the smooth rotation via `inProgressRot`. Eye coordinates follow naturally since they are derived from `buildSquares(n, baseScale)`.

### Golden spiral — REMOVED intentionally
The golden spiral was removed because it cannot be correctly anchored without solving for the true irrational convergence point of the Fibonacci tiling (approximately (0.5964·scale, 0.228·scale), derived from solving `|P_k - C| / |P_{k+1} - C| = φ`). A misaligned golden spiral misleads rather than illustrates. Do not re-add it unless the math is properly derived.

---

## State object — full reference
```js
state = {
  n:             1,        // current Fibonacci index (integer, can be negative); new users start at 1
  mode:          'fib-steps', // 'standard' | 'fib-steps'
  subStep:       0,        // ticks accumulated toward next n in fib-steps mode
  stepDir:       1,        // +1 or -1, direction of current accumulation

  showSquares:   true,     // admin
  showNumbers:   true,     // admin
  showFibSpiral: true,     // admin
  showNegative:  true,     // settings — red coloring for negative n

  nlFreeScroll:  false,    // admin — bypasses highestAbsN drag boundary
  highestAbsN:   1,        // high-water mark, only updated by commitN()

  panX: 0, panY: 0,        // spiral canvas pan offset (world coords)
  rotation: 0,             // accumulated rotation in radians (±π/2 per commit)

  // Spiral canvas mouse/touch state
  scDown, dragMoved, lastMx, lastMy,
  touchStartX, touchStartY, touchStartTime, touchMoved,

  // Number line
  nlWorldX,    // pixel position of n=0's left edge
  nlDragging, nlLastX, nlVel, nlAF,
  nlIndSign, nlIndAlpha,  // +/- bubble indicator

  // Canvas dimensions (set by resizeCanvases)
  _sw, _sh,    // spiral canvas logical px
  _nlw, _nlh,  // number line canvas logical px
}
```

---

## Key functions

| Function | Purpose |
|---|---|
| `tickInput(dir)` | **Single entry point for all input** (scroll, click, touch, keyboard). Routes to commitN or subStep accumulation |
| `commitN(newN)` | Advances state.n, adds ±π/2 to rotation, updates highestAbsN, saves score |
| `stepsForN(targetN)` | Returns `max(1, F(|targetN|))` — cost in fib-steps mode |
| `handleScroll(deltaY)` | 1 wheel event = 1 tick always |
| `buildSquares(n, scale)` | Returns array of {x,y,size,k,fibVal} for the tiling |
| `arcParams(sq, i)` | Returns {ax,ay,sa} — pivot and start angle for arc i |
| `drawSpiral()` | Clears and redraws everything on spiral canvas |
| `drawNumberLine()` | Clears and redraws number line; self-schedules via rAF for indicator decay |
| `updateModeInfo()` | Updates modeInfo text in settings overlay |
| `updateFooter()` | Updates zoomLbl span in canvas footer |
| `playCelebration(targetN)` | Zoom-through animation from n=1 to targetN on new high score (3s, cubic ease) |
| `maybeSaveScore(n)` | Firebase write — only if |n| > userBestAbsN, no-op if not signed in |
| `updateUserBestDisplay(n)` | Updates Account card "Best:" label with truncated F(n) value |
| `fibDisplayStr(n)` | Returns truncated comma-formatted F(n) string for leaderboard/UI |
| `applyAdminVisibility()` | Toggles `admin-hidden` class on settings panel based on `isAdmin` flag |

---

## Input handling — important details

### One tick = one physical input
In both modes, one scroll notch = one click = one tick. No accumulator throttling.

### Left click = +1, right click = −1
Detected on `mouseup` only if `!state.dragMoved`. `contextmenu` is suppressed.

### Touch on spiral canvas
- Short tap (<300ms, <move threshold) → +1
- Directional swipe (<500ms, >25px) → direction from dx/dy
- Long touch + move → pan

### Number line drag boundary
When `state.nlFreeScroll === false` (default), drag is clamped to `[-highestAbsN, highestAbsN]`. Clamping applied in: mousemove, touchmove, nlMomentum. This prevents cheating the leaderboard.

---

## Firebase — structure and behaviour

### SDKs
Firebase compat v10 loaded via CDN (not npm). Global `firebase` object available.

### Collections
```
scores/{uid}  →  { n, absN, fibDisplay, currentN, currentSubStep, currentStepDir, generatedName, displayName, photoURL, uid, updatedAt }
```
`fibDisplay` is the truncated F(n) string for leaderboard display.
`absN` is used for leaderboard ordering. `n` is the best value (can be negative). Only one document per user — upserted on each new best.
`currentN`, `currentSubStep`, `currentStepDir` track live progress (saved every 2s via debounced writes, merged into the same document). On sign-in, these are restored so users don't lose partial click progress.
`generatedName` is the permanent AnimalNoun# pseudonym (e.g., "SwiftFalcon42"), assigned once on first anonymous sign-in. Never overwritten.
`displayName` is the user-facing name: starts as "GuestSwiftFalcon42" for anonymous, becomes "SwiftFalcon42" on Google upgrade, or custom if user edits it.

### Auth flow
1. `initFirebase()` called at boot
2. `fbAuth.onAuthStateChanged` drives all UI state
3. If no user session: auto `signInAnonymously()` — user gets a persistent UID, default name "Guest" + AnimalNoun#
4. Anonymous users can type a custom name, save progress, appear on leaderboard
5. "Sign in with Google" links anonymous account via `linkWithPopup/Redirect` — preserves UID + data, strips "Guest" prefix from name
6. On sign-out (Google users only): reset to n=1, auto-create new anonymous session
7. Anonymous users cannot sign out (no sign-out button shown)

### Score save trigger
`commitN()` calls `maybeSaveScore(newN)`. Writes only if `Math.abs(newN) > userBestAbsN`. Rate of writes is naturally low.

### Leaderboard
`onSnapshot` listener on `scores` ordered by `absN desc limit 10`. Updates in real time. Started immediately on init (public read, no auth required to view).

---

## Settings panel — access levels

One settings overlay (`#settingsOverlay`), opened by ⚙️ button. Controls are visually separated by section headers. Admin sections have a red **ADMIN** badge on the section header and are **only visible to admin users**.

### Admin authentication

Admin controls are gated by a hardcoded email whitelist (UI-level only — not server-enforced):

```js
const ADMIN_EMAILS = ['scottsandvik@gmail.com', 'ssandvik@hisd.com'];
```

On sign-in, `isAdmin` is set by checking `currentUser.email` against this list. The `.overlay-panel` element gets class `admin-hidden` toggled via `applyAdminVisibility()`. CSS rule `.admin-hidden [data-admin="true"] { display: none !important; }` hides admin sections.

On sign-out, `isAdmin` is reset to `false` and admin sections are hidden.

### Settings sections

| Section | Access | Controls |
|---|---|---|
| Display | All users | Negative n coloring |
| Visualization | Admin only (`data-admin="true"`) | Show Squares, Show Numbers, Fibonacci Spiral |
| Mode | Admin only (`data-admin="true"`) | Standard / Fib Steps buttons |
| Number Line | Admin only (`data-admin="true"`) | Free drag toggle |

### Security note
This is UI-level only — the admin whitelist is visible in the HTML source. Acceptable for this use case (teacher tool). Firestore security rules already prevent score manipulation. No server-side admin enforcement is needed.

---

## Known issues and incomplete items

- **Rotation not working** — `state.rotation` accumulates correctly and `rotAngle = state.rotation + inProgressRot` is computed, but the visual rotation may not be perceptible. Investigation needed. The transform order is: translate(W/2,H/2) → rotate(rotAngle) → translate(-eye+pan). Verify that `state.rotation` is actually non-zero after several commits by checking the footer readout.

- **Smooth zoom interpolation** — In fib-steps mode, `baseScale` is now interpolated between the current n's scale and the next n's scale using an ease-in-out curve tied to sub-step progress. This eliminates the hard zoom jump at each level transition. The interpolation parallels the existing smooth rotation (`inProgressRot`).

- **Ghost arc direction** — The ghost arc (partial quarter-circle during sub-steps) grows from the existing spiral tip outward, using `ctx.arc(ax, ay, r, sa + π/2*(1-progress), sa + π/2)`. At progress=0 it's zero-length at the connection point; at progress=1 it's the full arc ready to commit.

- **Negative n tiling** — For negative n, `buildSquares` uses `fibPos(k)` (absolute sizes) and labels squares with `fib(-k)`, giving correct values with sign. The visual geometry is identical to positive n (same square sizes) with only color difference. This is a known simplification — a true "negative" tiling would spiral the other direction geometrically.

- **LOOKAHEAD constant** — set to 13. Increasing this fills more canvas with ghost squares but adds draw cost. At large n (>50) the lookahead squares are tiny and barely visible anyway.

---

## Level progression — feature unlocks

Level 8 · F(8) = 21 · Guest Account
  On first reaching n=8, anonymous Firebase auth is created.
  User gets a GuestAnimalNoun# pseudonym.
  Score saved to Firestore, appears on leaderboard.
  Progress (including sub-steps) persists across reloads.

Level 9 · F(9) = 34 · Confetti
  Every click spawns F(n) confetti particles (capped at 150).
  Confetti appears at the click/tap position, or screen center for keyboard.
  Canvas-based particle system with gravity, rotation, and alpha fade.

Level 10 · F(10) = 55 · Celebration Zoom
  On each new high n (n >= 10), a smooth zoom-in/zoom-out animation plays.
  Two phases: unwind rotation to center, then rewind back.
  Duration scales logarithmically from 2.5s to 5s.

Level 11 · F(11) = 89 · Flower Power-ups
  5-petal flowers spawn every 2-3 seconds on the canvas.
  Each flower lasts 5 seconds if not clicked.
  Click/tap a flower: +5 ticks, confetti burst, +5 floating animation.
  Flowers stop spawning below n=11.

Level 12 · F(12) = 144 · Smiley Face Power-ups
  Smiley faces appear as confetti at sub-step click counts 3, 5, 8, 13, 21.
  All smiley confetti disappear except one, which lands at a random spot.
  Clicking while airborne: +55 ticks.
  After landing, value decays every 500ms following Fibonacci sequence:
    +34, +21, +13, +8, +5, +3, +2, +1, +1, +0
  Landed smiley stays visible for 5 seconds, then fades.
  Shows a +## floating animation on collection.

**IMPORTANT**: Levels 9, 10, 11 features are EXACT — they only activate at that specific n value, not as a range. When the user advances past that n, the feature stops. Level 8 celebration zoom IS a range (n >= 8, plays on every new high).

Celebration zoom duration: 8s at n=8, +1s per level, caps at 21s. Formula: `Math.min(21000, 8000 + (targetN - 8) * 1000)`

---

## Style conventions

- 2-space indent throughout
- Console messages prefixed: `✅` success, `❌` error, `⚠️` warning
- All colors via CSS variables or the `col(i, alpha)` function
- No inline styles except `display:none/block` for show/hide toggling
- Canvas drawing functions are pure (read state, write to canvas, no side effects on state except `drawNumberLine` which self-schedules rAF for indicator decay)

---

## What NOT to do

- Do not split the single HTML file into multiple files unless explicitly asked
- Do not introduce npm, webpack, Vite, or any bundler
- Do not change `buildSquares` direction sequence or `arcParams` lookup table without re-running the chain verification test
- Do not re-add the golden spiral without solving the convergence point math
- Do not add `console.log` without the ✅/❌/⚠️ prefix convention
- Do not reset `state.panX/panY` inside `commitN` (was removed intentionally — it caused visual jumps)
- Do not use `localStorage` — Firebase Firestore is the persistence layer
