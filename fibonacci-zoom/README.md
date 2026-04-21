# Fibonacci Zoom

**An interactive, infinite Fibonacci sequence visualizer with a live leaderboard.**

Built for mathematics education — designed for high school and college students to explore the Fibonacci sequence, negative Fibonacci indices, and the relationship between the sequence and its geometric spiral.

© 2025 Scott Sandvik · Licensed under GPL-3.0

---

## What it does

- **Visualizes the Fibonacci rectangle tiling** — colored squares whose side lengths are consecutive Fibonacci numbers, tiling outward in a spiral pattern
- **Extends to negative indices** — F(−n) = (−1)^(n+1) · F(n), displayed in red with dashed borders
- **Infinite scrolling number line** — shows the integer index n and its Fibonacci value, centered on the current position
- **Two modes:**
  - **Standard** — one click advances one step
  - **Fib Steps** — advancing to index n requires exactly F(|n|) clicks, making the effort proportional to the number itself
- **Live leaderboard** — scores saved per user, top 10 displayed in real time with actual Fibonacci values. Guest users auto-save via anonymous auth; optional Google sign-in to sync across devices
- **Progress restored** — sign in and the app restores your exact position including partial click progress; new users start at F(1) = 1
- **Mobile friendly** — responsive layout with bottom sheet for account/leaderboard, compact number line, and `signInWithRedirect` for mobile Safari/Chrome
- **Level progression** — unlockable features at each level: guest account at F(21), confetti at F(34), celebration zoom at F(55), flower power-ups at F(89), smiley power-ups at F(144), Mona Lisa easter egg at F(233)

---

## How to use

| Action | Effect |
|---|---|
| Left click on canvas | Advance to next Fibonacci index (+1) |
| Right click on canvas | Go back (−1) |
| Scroll wheel up | Advance (+1) |
| Scroll wheel down | Go back (−1) |
| Tap (mobile) | Advance (+1) |
| Swipe up/right (mobile) | Advance (+1) |
| Swipe down/left (mobile) | Go back (−1) |
| Drag number line | Scroll to any previously reached index |
| Arrow keys | Step ±1 |

---

## File structure

This is intentionally a **single HTML file** — no build tools, no bundler, no `node_modules`. Everything is self-contained:

```
fibonacci-zoom/
├── fibonacciZoom.html   ← the entire app
├── README.md            ← this file
├── CLAUDE.md            ← context file for Claude Code sessions
└── LICENSE              ← GPL-3.0
```

Firebase SDKs are loaded from Google's CDN via `<script>` tags. No local dependencies.

---

## Firebase setup

The app uses Firebase for Google Sign-In and Firestore for score storage. The config is already embedded in the HTML. To deploy your own instance:

### 1. Firebase project
- Project: **Fibonacci Zoom** · ID: `fibonacci-zoom`
- Console: [console.firebase.google.com](https://console.firebase.google.com)

### 2. Enable Google Sign-In
Firebase Console → Authentication → Sign-in method → Google → Enable

### 3. Firestore database
Firebase Console → Firestore Database → Create database (production mode)

### 4. Security rules
In Firestore → Rules, paste:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /scores/{uid} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### 5. Authorized domains
Firebase Console → Authentication → Settings → Authorized domains → add your hosted domain

### Firestore data shape
One document per user in the `scores` collection, keyed by UID:
```js
scores/{uid} = {
  n:              62,                    // best index (can be negative)
  absN:           62,                    // |n|, used for leaderboard sort
  fibDisplay:     "4,052,739,537,881",   // F(n) truncated for display
  currentN:       62,                    // current position (may differ from best)
  currentSubStep: 377,                   // clicks accumulated toward next n
  currentStepDir: 1,                     // +1 or -1
  displayName:    "Scott Sandvik",
  photoURL:       "https://...",
  uid:            "abc123",
  updatedAt:      Timestamp
}
```

---

## Settings and admin controls

Access via the ⚙️ button (top right). Admin sections are only visible when signed in with an authorized admin email.

| Control | Level | Default |
|---|---|---|
| Negative n coloring | All users | On |
| Show Squares | Admin only | On |
| Show Numbers | Admin only | On |
| Fibonacci Spiral | Admin only | On |
| Mode (Standard / Fib Steps) | Admin only | Fib Steps |
| Free drag to any n (number line) | Admin only | Off |

Admin controls are gated by a hardcoded email whitelist checked at sign-in. Non-admin users only see the Display settings. This is UI-level gating (the whitelist is in the HTML source), not server-enforced — suitable for the current teacher/instructor use case.

---

## Hosting

The file is a plain HTML file. Host it anywhere:

- **GitHub Pages** — free, push to `main`, enable Pages in repo settings
- **Netlify** — drag and drop the HTML file
- **Any static host** — it's one file

After hosting, add your domain to Firebase Authorized Domains.

---

## License

GPL-3.0 — see `LICENSE` file.

You may view, use, and modify this code for non-commercial and educational purposes. Any distributed modifications must also be open-sourced under GPL-3.0. Commercial use by anyone other than the original author requires explicit written permission.

For licensing inquiries: scottsandvik@gmail.com




revision plan:
First: What Fibonacci Zoom already is (the good and the bad)
Core loop: Click → accumulate → sub-step threshold → advance to next Fibonacci index → see bigger number, bigger spiral, more rotation, more squares filled in.
The engagement mechanics already present:
Exponential scaling (the core hook of every successful incremental game)
Visual feedback (rotation, spiral growth, color coding)
Leaderboard + pseudonym identity
Level unlocks tied to meaningful math constants (F(21), F(34), F(55), F(89), F(144))
Power-ups (flowers, smileys) with Fibonacci-flavored rewards
Celebration zoom on new highs
Persistent progress across devices via Firebase
Where it breaks down (the real problem): You nailed it in your question. The click costs are true Fibonacci values, and that's mathematically beautiful but experientially brutal:
Level
Clicks to next
Real-world time @ 2 clicks/sec
F(9) → F(10)
55
~28 sec
F(10) → F(11)
89
~45 sec
F(11) → F(12)
144
~1.2 min
F(12) → F(13)
233
~2 min
F(13) → F(14)
377
~3 min
F(14) → F(15)
610
~5 min
F(15) → F(16)
987
~8 min
F(16) → F(17)
1,597
~13 min

Past F(13), pure clicking becomes a chore. Every successful clicker game solves this the same way: the player stops clicking and starts optimizing. They earn auto-clickers, upgrades, multipliers. Without that shift, they quit.

The central insight from the research
Three things make incremental games stick (from Grayson, Pecorella, the 2025 engagement study cited in Grokipedia, and observing what every top clicker actually ships):
The dopamine loop must compress, not expand. Early levels should feel fast, and later levels should feel faster still, because the player unlocks ways to click less per F(n). Right now yours does the opposite.
"Numbers go up" must feel earned AND inevitable. Players need to see bigger rewards coming before they arrive — peeking at F(233), F(610), F(2584) should feel thrilling, not punishing.
A reason to come back tomorrow. Offline progress, daily bonuses, limited-time events, streaks. Without a return hook, even a 5-star session is a one-shot.
For your specific context (teacher tool, classroom-friendly, math-educational), there's a fourth:
Learning must happen incidentally, not didactically. Kids shouldn't feel quizzed. They should absorb the Fibonacci sequence the way they absorbed "1, 2, 3, 4, 5" — through repeated exposure with positive association.

Twelve ideas, ranked by impact-per-effort
🏆 TIER 1 — These are the ones you build first
1. Fibonacci Boosters (the core progression fix)
Every time the player commits a new F(n), they earn Boost Tokens — a new currency. Boost Tokens spend on permanent click multipliers:
"×2 Click" — costs 10 tokens — every click counts as 2 ticks (halves clicks needed)
"×3 Click" — costs 50 tokens — every click counts as 3 ticks
"Fibonacci Fingers" — costs 100 tokens — every 5th click counts as F(5) = 5 ticks
"Golden Touch" — costs 500 tokens — every 13th click counts as F(13) = 233 ticks
"The Phi Multiplier" — costs 2000 tokens — all clicks ×φ (≈1.618)
This means F(15) = 610 clicks becomes 610 / (2 × 3 × whatever they've stacked) — maybe 50 real clicks. This single feature transforms the pacing of the entire game. Math stays honest; the effort shrinks with mastery.
2. Auto-Clicker ("The Golden Ratio Engine")
Unlocks at F(13) = 233. Once owned, the spiral clicks itself at a rate of 1 tick per second, accelerating by φ every level (so 1.618/sec at F(14), 2.618/sec at F(15), 4.236/sec at F(16)...). Buyable upgrades:
"Golden Gears" — +1 auto-tick/sec
"Spiral Servos" — auto-ticks cost half Boost Tokens to upgrade
"Compound Interest" — auto-ticks also earn Boost Tokens
This is what keeps them engaged past F(13) and gives them a reason to walk away from the screen and come back.
3. Offline Progress with a twist ("The Nautilus Sleeps")
When a signed-in user closes the tab and returns, they see: "The Nautilus grew while you were away. +F(n) ticks banked." Cap it at 8 hours of accumulation. Show a charming little animation of a nautilus shell filling with ticks they can "collect" on return.
Why this works: it's the single strongest retention mechanic in the entire genre. It makes coming back feel like opening a present. It's free dopamine.

🥈 TIER 2 — High-value features after the core loop is fixed
4. Daily Streak with Fibonacci rewards
Day 1: +1 Boost Token. Day 2: +1. Day 3: +2. Day 4: +3. Day 5: +5. Day 6: +8. Day 7: +13. Day 8: +21...
The streak reward IS the Fibonacci sequence. A student who plays 7 days in a row has felt the sequence in their gut. Missing a day resets to 1. (Forgiving: give them a 1-day "freeze" per week.)
5. Achievements (visible, collectible, shareable)
Not point-based — emblem-based. These are what players screenshot and show friends:
🌱 Sprout — reach F(3)
🌻 Sunflower — reach F(8) (real sunflower spirals have F(21) and F(34) seed spirals — teach this on unlock)
🐚 Nautilus — reach F(13)
🌀 Hurricane — reach F(21) (real hurricanes show logarithmic spiral arms)
🌌 Galaxy — reach F(34) (galactic spiral arms)
φ Phi Master — reach F(55)
∞ Transcendent — reach F(89)
Each achievement unlocks a one-line "Did you know?" fact about where that number shows up in nature. This is the incidental learning path.
6. Themed Skins (free, unlock by milestone)
At F(8) unlock Nautilus skin. At F(13) unlock Sunflower skin (yellow/brown palette, seed-head center). At F(21) unlock Galaxy skin (dark with glowing stars). At F(34) unlock Hurricane skin (blue-gray swirl with clouds). At F(55) unlock Fern skin (green fractal).
Skins are cosmetic only — no gameplay effect — but they let players customize and feel ownership. Every successful idle game has cosmetic rewards. They're cheap to build and huge for retention.

🥉 TIER 3 — Polish and community features
7. Weekly Class Challenge
"This week: first to reach F(21) wins 🏆" — leaderboard shows only that week. Teachers can use this in class. You already have Firebase; it's just a second leaderboard with a weekly reset.
8. "Found in Nature" unlockables
Every 3 levels, unlock a real photo: sunflower head, nautilus cross-section, galaxy M74, hurricane satellite image, pinecone spiral, Romanesco broccoli. Tiny gallery the student can browse. This is the Mona Lisa easter egg you already have, systematized.
9. Combo System
Click within 1 second of your last click and build a combo. 5-combo = ×1.5 tick. 10-combo = ×2 tick. 21-combo = ×3 tick. Missing a second breaks the combo. This rewards active play AND gives something for the auto-clicker to interact with (auto-clicks break combos, so active players can out-pace auto-clickers in short bursts).
10. Golden Cookie moment (stolen shamelessly from Cookie Clicker)
Every 2-5 minutes, a tiny golden spiral appears somewhere on screen for 8 seconds. Click it: +F(current n) instant ticks, or +5 Boost Tokens, or a 30-second ×7 multiplier (the classic "Frenzy" mechanic). This is the most addictive mechanic in Cookie Clicker and it would work beautifully here.

🎯 TIER 4 — Educational hooks (because you're a teacher)
11. "Why does this matter?" pop-ups at each level
Brief, optional, dismissable. At F(5): "Did you know your hand has 5 fingers, and your arm has 2 bones, your hand has 1 big wrist bone, and your fingers have 3 segments? Every number is Fibonacci." Click to learn more → opens a tiny modal with a real image. Keep it short, never blocking.
12. "Challenge Mode" — unlockable at F(21) for admin/teacher use
Teacher sets a target F(n), shares a classroom code, students race to reach it. Shows live rankings with student names. Could be a feature admin turns on for a specific classroom.

What I would ship first (if I were you)
In this order, because each unlocks value from the ones before:
Boost Tokens + permanent multipliers — this is the single biggest engagement fix, and it addresses your "233 clicks is too many" problem directly
Auto-clicker at F(13) — gives the endgame a reason to exist
Offline progress — one-time build, forever retention value
Daily streak with Fibonacci rewards — teaches the sequence AND brings them back
Achievements — cheap to build, huge for sharing
Everything else is additive after that. The first two fundamentally fix the game's pacing. The next three fundamentally fix its retention.

One big-picture idea I want to flag
Right now Fibonacci Zoom is a clicker game with Fibonacci as theme.
The version I'm describing above is a Fibonacci game with clicker as mechanism. The difference is that every upgrade, every reward, every unlock, every multiplier is itself a Fibonacci number. The player isn't just pressing buttons to see numbers — they're living inside the sequence. Every interaction teaches it. The game becomes the sequence.
That's the version kids will tell their friends about, that teachers will recommend to colleagues, and that you'll actually enjoy building.
