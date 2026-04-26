# Fibonacci Zoom — Tier 5 Proposal: forgotten cross-cutting features

**Status:** proposal, not approved.
**Audience:** Scott (owner) — pick what's worth building, defer the rest.
**Premise:** all four shipped tiers (Boosts/Engine, Streak/Achievements/Skins, Combo/Gallery/Weekly, Facts/Classroom) target progression and identity. Seven categories of feature were never planned and never shipped. This doc captures them with effort estimates so we can prioritise.

For each item:
- **What's missing** — the actual gap in the current app.
- **Why it matters** — who benefits, when.
- **Effort** — small (≤1 day) / medium (1–3 days) / large (≥1 week).
- **Decision needed** — yes / defer / skip, with rationale.

---

## 1. Audio cues and music

**What's missing.** The app is silent. No tick sound on click, no level-up chime, no Golden Moment alert, no Frenzy theme.

**Why it matters.** Audio reinforces reward loops more strongly than visual cues alone — well-known in mobile-game UX. For classroom use, however, audio is a footgun: 30 muted Chromebooks suddenly singing during a quiet study period is worse than silence. Any audio shipped MUST default to **off** with a Settings toggle; the flag should persist per-user.

**Effort.** Small — one Web Audio context, six short WAV/OGG files (tick, level-up, golden, frenzy-start, achievement, error), one settings toggle. Audio files served from `fibonacci-zoom/audio/` (no CDN dependency). Per-user `state.audioEnabled` flag, persisted to Firestore alongside `suppressFacts`.

**Decision needed.** Likely "yes, off by default." A single click-tick at low volume is a good first step; defer Golden/Frenzy themes until we see how teachers react. Recommend skipping looping music entirely.

---

## 2. Screenshot / share / export

**What's missing.** No way to save or share a snapshot of your spiral. The mobile experience has nothing tappable to brag about the result.

**Why it matters.** Sharing is the cheapest user-acquisition channel for a single-page web app. Students who screenshot a deep spiral and post it bring more students. Counter-argument: the existing leaderboard already provides social comparison.

**Effort.** Medium. Two paths:

- **Cheap:** "📷 Snapshot" button calls `canvas.toBlob()` on the spiral canvas, opens in a new tab as `image/png`. Two existing canvases are layered — must composite into an offscreen canvas first. ~80 lines of code, no Firebase work.
- **Better:** generate a styled share-card (spiral + level + name + caption) on a 1200×630 offscreen canvas at fixed DPI. Open-graph compatible. ~200 lines.

**Decision needed.** "Yes, cheap version" if v3.0 ships. The styled card can wait.

---

## 3. Tutorial / onboarding flow

**What's missing.** The app drops you on a near-empty canvas and assumes you'll figure out clicking. The "Click to find the next Fibonacci number" hint card in the left sidebar exists but is hidden on mobile/tablet — exactly the audience least likely to know what to do.

**Why it matters.** The Tier 4 doc explicitly punted on this ("classroom teachers will explain in person"). For self-directed play (parents, casual web visitors) it's the first-impression killer.

**Effort.** Medium. Three or four overlay tooltips firing in sequence on first run: (1) "tap here to advance", (2) on first commit "you found the 1st Fibonacci number", (3) at n=3 "you've earned tokens — open boosts", (4) at n=8 "your account just saved". State a `tutorialStep` int persisted to Firestore so it never re-fires. ~150 lines including styles.

**Decision needed.** Defer. Implementing well requires copy-writing time we haven't budgeted. If we ship audio, ship onboarding in the same release.

---

## 4. Accessibility

**What's missing.** Several known gaps:

- **No `prefers-reduced-motion` honoring.** Celebration zoom (5–8s) is jarring for vestibular-disorder users.
- **No high-contrast mode independent of skins.** Skins are stylistic; a true high-contrast option is missing.
- **Toast dwell time (12 s)** is too short for some readers; the Tier 4 doc acknowledged this without mitigation.
- **No keyboard-only walkthrough.** Spacebar/arrow input works for ticks, but the settings/account/leaderboard panels can't be reached without mouse.
- **Screen reader.** No `aria-live` regions on the leaderboard or score readout.

**Why it matters.** Schools have accessibility mandates. A single complaint can cause the app to be banned from a district network.

**Effort.** Medium overall, but split:

- **Reduced motion** (small, ~1 hour): one CSS media query plus a runtime check that skips the celebration zoom.
- **Toast extend** (small, ~30 min): add a toggle "longer reading times" to settings; bumps dwell to 30 s.
- **High-contrast mode** (small, ~2 hours): one new entry in `SKINS` named "High Contrast" with WCAG-AAA palette.
- **Keyboard nav** (medium, ~1 day): tab-order audit of every overlay; focus trap; visible focus rings.
- **`aria-live`** (small, ~2 hours): annotate `#userBestScore` and `#lbList` as `aria-live="polite"`.

**Decision needed.** Yes for reduced-motion + toast extend (low effort, high benefit). Defer keyboard nav + screen reader to a dedicated accessibility pass.

---

## 5. Progress charts / stats dashboard

**What's missing.** No "your spiral over time" view. The Account card shows Best and current Level; nothing else. No history of when you reached each level, no graph of token earnings.

**Why it matters.** For a long-tail player (weeks of daily play), a progress view is the single feature that makes "open the app today" feel rewarding. Without it, the app is purely instantaneous.

**Effort.** Large. Requires:
- A new Firestore subcollection `scores/{uid}/history/{ts}` with at minimum `{ts, n, tokens}`.
- Throttled writes (once per level milestone or daily, not per click).
- A new overlay with a small line chart. Could use raw Canvas (consistent with the rest of the app's no-dependency stance) or a lightweight CDN library.
- Schema migration / backfill from the existing `streak.lastDateStr`.

**Decision needed.** Defer. High value for engaged players, but we don't have data on how many those are. Ship history-write first (cheap, future-proof), graph view second.

---

## 6. Cosmetic features beyond skins

**What's missing.**

- **Custom cursors.** A "spiral cursor" mode would be charming.
- **Particle styles.** Confetti is hardcoded as colored rectangles; could be Fibonacci squares, golden petals, etc.
- **Spiral arc styles.** Solid line only; could be dashed, dotted, gradient, glow.

**Why it matters.** Adds personalisation depth past the 7 skins. Keeps the long-tail player's "what should I unlock next" loop alive past F(89) where skins run out.

**Effort.** Small per item, ~1 day total for all three.

**Decision needed.** Defer until skins demonstrably get boring. The four new achievements (v2.0.2) push the long-tail goal further; revisit cosmetic depth if engagement drops.

---

## 7. Permanent fact library + social features

**What's missing.**

- **Fact library:** `LEVEL_FACTS` are shown once in a 7-second toast and then lost. There's no "open a list of every fact you've seen". Tier 4 stored `factsShown[n]` for re-fire prevention, but never built the read-back UI.
- **Social proof of milestones:** No way to see other players' fact discoveries, badges earned, or favourite skins.
- **Class roster (beyond Challenge):** Teachers running the Classroom Challenge see live ranks during the event but no roster / per-student view afterward.

**Why it matters.** The fact library is the highest-leverage one — the educational content is *already written and stored*, just unsurfaced. A 50-line "Facts" overlay would unlock the whole back catalog.

**Effort.**

- **Facts overlay** (small, ~3 hours): new overlay grid like the Achievements/Gallery panels, listing every fact the user has unlocked, click to re-read. Reuse the `factsShown` Firestore field.
- **Per-class roster view** (medium): requires teacher-mode UI in Settings; not blocked but not cheap.
- **Public profile** (large): Firestore rules rewrite; out of scope for v3.0.

**Decision needed.** Yes for facts overlay (highest ROI in this whole doc). Defer the rest.

---

## Recommended Tier 5 scope (a single release)

Pick the small/cheap wins. Everything else moves to Tier 6+.

| Feature | Effort | Benefit |
|:--------|:-------|:--------|
| Audio toggle (off-by-default click tick + level-up chime) | Small | Reward feel |
| Snapshot button (canvas.toBlob → new tab) | Small | Sharing, virality |
| `prefers-reduced-motion` + longer-toast toggle | Small | Accessibility |
| High Contrast skin | Small | Accessibility |
| Facts library overlay | Small | Surfaces existing content |
| Frenzy Master + Streak Sage achievements | Small | Long-tail recognition |

Total: ≤2 days of work, all on `index.html` + `audio/`. Single PR.

**Defer to Tier 6:**

- Onboarding tutorial (medium, blocked on copy)
- Progress charts / history (large, schema work)
- Custom cursors / particle styles (defer)
- Keyboard nav + screen reader (medium, dedicated A11y pass)
- Public profile / class roster (large)
