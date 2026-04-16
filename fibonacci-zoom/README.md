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
