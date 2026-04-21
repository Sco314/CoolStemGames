# Fibonacci Zoom Revision Tier 4

**Priority: MEDIUM — build these when the game mechanics are stable.** Tier 1 fixed pacing. Tier 2 added identity. Tier 3 added surprise and community. Tier 4 is the **educational layer** — the features that transform Fibonacci Zoom from a game into a teaching tool Scott can use in his classroom and recommend to other teachers.

These are the features that make a teacher say "I'm assigning this for homework" and a student say "oh — THAT'S what Fibonacci is for."

**Reference files in repo:**
- `fibonacci-zoom/index.html` — current app
- `fibonacci-zoom/CLAUDE.md` — architecture, conventions
- `fibonacci-zoom/README.md` — vision document
- `fibonacci-zoom/Fibonacci Zoom Revision Tier 1.md` — Boosts, Engine, Offline
- `fibonacci-zoom/Fibonacci Zoom Revision Tier 2.md` — Streak, Achievements, Skins
- `fibonacci-zoom/Fibonacci Zoom Revision Tier 3.md` — Weekly Challenge, Gallery, Combo, Golden Moment

**Dependencies from earlier tiers:**
- Admin whitelist (`ADMIN_EMAILS`, `isAdmin`, `applyAdminVisibility`) — already in the current code
- `state.achievements` and the toast system — Tier 2
- Gallery modal pattern — Tier 3
- Weekly challenge Firestore collection — Tier 3 (not strictly required, but challenge mode reuses the concept)

---

## Feature 11 — "Why Does This Matter?" Level Pop-ups

### The problem this solves

The game already rewards reaching a Fibonacci level — confetti, tokens, skin unlocks, achievements. What's missing is the **single sentence of context** that plants the math in the player's mind. The gallery (Tier 3) has rich facts, but they only appear when the user opens the gallery. At the moment of a level-up, while dopamine is still firing, is the best possible teaching window.

This feature delivers a **brief, optional, dismissable** fact right at the level-up moment. It doesn't block gameplay. It doesn't quiz anyone. It's just a voice saying *"by the way, this is what you just earned."*

### Design

- On every **new high** at specific Fibonacci milestones, a small card slides in from the bottom-right (or bottom-center on mobile).
- The card contains: the Fibonacci number, a one-sentence fact, a "Learn more" link that opens the gallery to the related entry if one exists.
- The card auto-dismisses after 7 seconds OR on tap.
- **User preference**: settings toggle to suppress these pop-ups entirely (default: on). For players who find them annoying after seeing them once.
- Each fact only shows ONCE — tracked by state. If a user resets, they see them again on re-progression.

### The fact catalog

One fact per Fibonacci milestone from F(3) to F(21). Sparser after that (every 5-8 levels) to avoid fatigue.

```js
const LEVEL_FACTS = {
  3:  "F(3) = 2. Every flowering plant that puts out leaves in an alternating pattern does it with two leaves per cycle — the simplest Fibonacci arrangement.",
  4:  "F(4) = 3. A clover has three leaves. A daisy family root has three main branches. Three is the first Fibonacci number that isn't 1 or 2.",
  5:  "F(5) = 5. Apple cores have five seed pockets in a star. Starfish have five arms. Most flowers have five petals. This isn't coincidence.",
  6:  "F(6) = 8. Octopi have eight arms. Spiders have eight legs. Many seashells coil in groups of eight bands.",
  7:  "F(7) = 13. A year has roughly 13 lunar cycles. Many moth species lay eggs in groups of 13.",
  8:  "F(8) = 21. Sunflowers have 21 seed spirals in one direction (and 34 in the other — next level).",
  9:  "F(9) = 34. The other sunflower direction. Also the number of vertebrae in the average giraffe neck lineage.",
  10: "F(10) = 55. The ratio F(10)/F(9) = 55/34 ≈ 1.6176. Already extremely close to φ ≈ 1.6180. The sequence converges.",
  11: "F(11) = 89. Your spiral now contains 11 squares and 11 quarter-arcs. If you drew it life-size with F(1)=1 inch, your drawing would be 89 inches wide.",
  12: "F(12) = 144 — a dozen dozen. Known since ancient times as a 'gross'. A completely coincidental but delightful alignment.",
  13: "F(13) = 233. The Fibonacci sequence appears in Pascal's triangle: the shallow diagonals sum to Fibonacci numbers. Try it.",
  14: "F(14) = 377. If you had F(14) pennies, stacked flat, the tower would be about as tall as a four-story building.",
  15: "F(15) = 610. The ratio F(15)/F(14) = 610/377 ≈ 1.6180. Twelve decimal places of φ are now visible in this sequence.",
  16: "F(16) = 987. A standard deck of cards shuffled 'perfectly' 8 times returns to its original order. Coincidence? Yes, but 8 is Fibonacci.",
  17: "F(17) = 1,597. Leonardo of Pisa (1170–1250), nicknamed Fibonacci, introduced this sequence to Europe in 1202 as a puzzle about rabbit populations.",
  18: "F(18) = 2,584. Honeybee family trees follow the Fibonacci sequence exactly: a male bee has 1 parent (the queen), a female has 2 (both queen and drone).",
  19: "F(19) = 4,181. The Fibonacci numbers are the ONLY solutions to x² - x - 1 = 0 that grow discretely. This equation defines φ.",
  20: "F(20) = 6,765. F(20) is also a Lucas number — part of another sequence that follows the same rule but starts 2, 1, 3, 4, 7...",
  21: "F(21) = 10,946. You reached F(21) — a Fibonacci index that is itself Fibonacci. These are rare and called 'Fibonacci-in-index' numbers.",
  34: "F(34) = 5,702,887. Grown past five million with just 34 steps. The sequence outpaces most polynomial growth from this point on.",
  55: "F(55) = 139,583,862,445. Roughly the number of seconds in 4,400 years. Your click count crossed the boundary of recorded human history.",
  89: "F(89) = 1,779,979,416,004,714,189. Nearly two billion billion. In base-10, F(n) has approximately n × 0.209 digits — a direct consequence of φ.",
  144:"F(144) = 555,565,404,224,292,694,404,015,791,808. Written out, it's 30 digits. Somewhere in the middle of this number lives the string '144' again — entirely by chance.",
};
```

### State additions

```js
factsShown:    {},      // { 3: true, 5: true, ... } — fact already displayed for this level
suppressFacts: false,   // user preference toggle
```

### Card HTML and CSS

```html
<div id="factCard" class="fact-card" style="display:none;">
  <div class="fact-card-close" id="factCardClose">✕</div>
  <div class="fact-level" id="factLevel"></div>
  <div class="fact-text" id="factText"></div>
  <div class="fact-actions">
    <a href="#" id="factLearnMore" class="fact-link">Learn more →</a>
  </div>
</div>
```

```css
.fact-card {
  position: fixed;
  bottom: 20px; right: 20px;
  width: 320px; max-width: calc(100vw - 40px);
  background: #111827;
  border: 1px solid var(--amber);
  border-radius: 12px;
  padding: 16px 18px;
  box-shadow: 0 12px 36px rgba(0,0,0,0.5), 0 0 20px rgba(245,166,35,0.2);
  z-index: 90;
  animation: factSlide 7s ease-in-out forwards;
  pointer-events: auto;
}
@keyframes factSlide {
  0%   { transform: translateY(120%); opacity: 0; }
  5%   { transform: translateY(0); opacity: 1; }
  90%  { transform: translateY(0); opacity: 1; }
  100% { transform: translateY(120%); opacity: 0; }
}
.fact-card-close {
  position: absolute; top: 8px; right: 12px;
  color: var(--txt3); cursor: pointer;
  font-size: 14px; line-height: 1;
}
.fact-card-close:hover { color: var(--txt); }
.fact-level {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; color: var(--amber);
  font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.fact-text {
  font-family: 'Cormorant Garamond', serif;
  font-size: 15px; color: var(--txt);
  line-height: 1.5;
  margin-bottom: 10px;
}
.fact-actions {
  display: flex; justify-content: flex-end;
}
.fact-link {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; color: var(--amber);
  text-decoration: none;
  padding: 4px 10px;
  border: 1px solid var(--amber);
  border-radius: 5px;
  transition: all .15s;
}
.fact-link:hover { background: var(--amber); color: #0b0f1a; }
.fact-link[style*="display: none"] { display: none !important; }

/* Mobile: bottom-center instead of bottom-right */
@media (max-width: 640px) {
  .fact-card {
    bottom: 10px; right: 10px; left: 10px;
    width: auto; max-width: none;
  }
}
```

### Show function

```js
function showLevelFact(n) {
  if (state.suppressFacts) return;
  if (state.factsShown[n]) return;
  const fact = LEVEL_FACTS[n];
  if (!fact) return;

  state.factsShown[n] = true;
  saveProgress();

  const card = document.getElementById('factCard');
  const levelEl = document.getElementById('factLevel');
  const textEl  = document.getElementById('factText');
  const linkEl  = document.getElementById('factLearnMore');

  levelEl.textContent = `F(${n}) = ${fmt(fib(n))}`;
  textEl.textContent  = fact;

  // Restart animation
  card.style.display = 'none';
  card.style.animation = 'none';
  void card.offsetWidth; // force reflow
  card.style.animation = '';
  card.style.display = 'block';

  // Learn more: if the gallery (Tier 3) has an entry at this n, link to it
  const hasGallery = typeof GALLERY !== 'undefined' && GALLERY.some(g => g.at === n);
  if (hasGallery) {
    linkEl.style.display = '';
    linkEl.onclick = e => {
      e.preventDefault();
      card.style.display = 'none';
      if (typeof openGalleryModal === 'function') {
        openGalleryModal();
        setTimeout(() => openGalleryItem(n), 200);
      }
    };
  } else {
    linkEl.style.display = 'none';
  }

  // Auto-dismiss after animation completes (7s)
  setTimeout(() => {
    if (card.style.display !== 'none') card.style.display = 'none';
  }, 7100);
}

document.getElementById('factCardClose').addEventListener('click', () => {
  document.getElementById('factCard').style.display = 'none';
});
```

### Integration in `commitN`

After the existing new-high logic, add:

```js
// In commitN, after isNewHigh handling:
if (isNewHigh) {
  showLevelFact(Math.abs(newN));
}
```

Timing matters: if `showAchievementToast` and `showSkinUnlockToast` also fire on the same commit, the fact card should appear alongside them, not after. The achievement toasts are top-right; the fact card is bottom-right. They don't overlap.

### Settings toggle

Add to the Display section of the settings overlay:

```html
<div class="toggle-item" data-key="suppressFacts">
  <div class="toggle-sw"></div>
  <span class="toggle-lbl">Hide "Did you know?" cards</span>
</div>
```

The existing toggle handler in `index.html` already syncs `state[key]` automatically — no new code needed beyond adding the HTML line.

### Firestore persistence

```js
// In saveProgress
factsShown:     state.factsShown,
suppressFacts:  state.suppressFacts,
```

In `onSignIn`:

```js
state.factsShown    = data.factsShown    ?? {};
state.suppressFacts = data.suppressFacts ?? false;
```

### Accessibility note

The fact card auto-dismisses after 7 seconds, which is fast for readers with disabilities or for students still learning English. Consider adding a setting: `factDuration: 'short' | 'long' | 'manual'`. Set `animation-duration` on the card to match. For a first-ship version, 7s is acceptable — the ✕ button lets anyone dismiss early, and they can always open the gallery for a longer read.

### Testing checklist

- [ ] Reach F(3) for the first time — card slides in from bottom-right with fact
- [ ] Auto-dismiss after 7 seconds
- [ ] ✕ dismisses early
- [ ] "Learn more" opens gallery to matching entry (at F(3)=Nautilus, F(6)=Sunflower, etc.)
- [ ] Reach F(3) a second time (after a reset) — card DOES reappear
- [ ] Toggle "Hide Did You Know?" in settings — no cards appear for new levels
- [ ] Card position adapts to mobile (bottom full-width)
- [ ] Card does not overlap achievement toasts (they're top-right, card is bottom-right)
- [ ] factsShown persists across sessions

---

## Feature 12 — Classroom Challenge Mode

### The problem this solves

Scott teaches CTE Process Technology. A teacher with a classroom-worthy tool wants to run a **timed event**: "Class, let's see who reaches F(21) first. You have 30 minutes. Ready, go." Right now, the game has no way to create such an event. The weekly challenge (Tier 3) is automatic and community-wide. Classroom Challenge Mode is **teacher-created, short-lived, and scoped to a class**.

### Design overview

- **Admin-only feature** (uses the existing `isAdmin` check — Scott and any whitelisted admin email).
- Admin creates a challenge by clicking a new button in the settings overlay. They set:
  - Target F(n) (e.g., 21)
  - Duration (5, 10, 15, 30, 60 minutes — dropdown)
  - Name (optional, defaults to "Class Challenge")
- On creation, the app generates a **4-character join code** (e.g., `G4K8`).
- The admin shares this code with students (verbally, on the board, over chat).
- Students open Fibonacci Zoom, click a "Join Challenge" button in the Account card, enter the code.
- Students see a challenge banner at the top of the app with countdown, target, current leaderboard of participants.
- When a student reaches the target: celebrate, finalize their time.
- When the timer ends: admin sees a final results screen; students see "Challenge ended" with their rank.
- Admin can end the challenge early.

### Firestore schema

New collection `challenges`:

```
challenges/{code} = {
  code:         "G4K8",
  name:         "Mr. Sandvik's 2nd Period",
  creatorUid:   "abc123",
  creatorName:  "Scott Sandvik",
  targetN:      21,
  startTs:      Timestamp,
  endTs:        Timestamp,         // startTs + duration
  endedEarly:   false,             // admin can end early
  status:       "active" | "ended",
}

challenges/{code}/participants/{uid} = {
  uid:            "def456",
  displayName:    "SwiftFalcon42",
  photoURL:       "",
  currentN:       17,              // latest peak during challenge
  reachedTargetTs: Timestamp,       // null if not yet reached
  joinedTs:       Timestamp,
  updatedAt:      Timestamp,
}
```

### Security rules update

```
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
```

### State additions

```js
challenge: {
  activeCode:     null,           // currently joined challenge code
  isCreator:      false,          // admin created this one
  doc:            null,           // cached challenge doc data
  unsubDoc:       null,           // onSnapshot unsub for the challenge doc
  unsubList:      null,           // onSnapshot unsub for participants list
  startingN:      1,              // user's n when they joined (for measuring progress during)
},
```

### Admin: Create Challenge UI

Add to the settings overlay, in a new admin-only section:

```html
<div data-admin="true">
  <div class="overlay-section" style="margin-top:16px;">
    Classroom Challenge <span class="admin-badge" style="margin-left:6px;">ADMIN</span>
  </div>
  <div id="challengeAdminPanel">
    <div id="challengeCreateForm">
      <input type="text" id="challengeName" placeholder="Challenge name (optional)" maxlength="40" class="guest-name-input">
      <div style="display:flex;gap:8px;margin-top:8px;">
        <select id="challengeTarget" class="guest-name-input" style="flex:1">
          <option value="8">F(8) = 21 clicks</option>
          <option value="13" selected>F(13) = 233 clicks</option>
          <option value="21">F(21) = 10,946 clicks</option>
          <option value="34">F(34) = 5.7M</option>
        </select>
        <select id="challengeDuration" class="guest-name-input" style="flex:1">
          <option value="5">5 min</option>
          <option value="10" selected>10 min</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="60">60 min</option>
        </select>
      </div>
      <button class="btn btn-primary" id="challengeCreateBtn" style="width:100%;margin-top:10px;">
        Create Challenge
      </button>
    </div>
    <div id="challengeActivePanel" style="display:none;">
      <!-- Filled dynamically -->
    </div>
  </div>
</div>
```

```js
const CHALLENGE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I for legibility
function generateChallengeCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CHALLENGE_CODE_CHARS[Math.floor(Math.random() * CHALLENGE_CODE_CHARS.length)];
  }
  return code;
}

async function createChallenge() {
  if (!isAdmin || !currentUser) return;
  const name     = document.getElementById('challengeName').value.trim() || 'Class Challenge';
  const targetN  = parseInt(document.getElementById('challengeTarget').value, 10);
  const duration = parseInt(document.getElementById('challengeDuration').value, 10);
  const code     = generateChallengeCode();

  const now = firebase.firestore.FieldValue.serverTimestamp();
  const endMs = Date.now() + duration * 60_000;
  const endTs = firebase.firestore.Timestamp.fromMillis(endMs);

  try {
    await fbDb.collection('challenges').doc(code).set({
      code,
      name,
      creatorUid:  currentUser.uid,
      creatorName: currentUser.displayName || 'Admin',
      targetN,
      startTs:     now,
      endTs,
      endedEarly:  false,
      status:      'active',
    });
    console.log(`✅ Challenge ${code} created`);
    // Auto-join as creator
    joinChallenge(code);
  } catch (err) {
    console.error('❌ Challenge create error:', err.message);
  }
}

document.getElementById('challengeCreateBtn').addEventListener('click', createChallenge);
```

### Student: Join Challenge UI

In the Account card (and mobile equivalent), add a small "Join challenge" button for all signed-in users:

```html
<button class="auth-btn" id="joinChallengeBtn" style="margin-top:6px;font-size:10px;padding:6px 8px;">
  Join Challenge
</button>

<div class="overlay-backdrop" id="joinChallengeOverlay">
  <div class="overlay-panel" style="width: 320px;">
    <button class="overlay-close" id="joinChallengeClose">✕</button>
    <div class="overlay-title">🏫 Join Challenge</div>
    <p style="font-size:12px;color:var(--txt2);margin-bottom:12px;">
      Enter the 4-character code from your teacher.
    </p>
    <input type="text" id="challengeCodeInput" class="guest-name-input" maxlength="4"
           placeholder="CODE" style="font-size:22px;text-align:center;letter-spacing:8px;text-transform:uppercase;">
    <button class="btn btn-primary" id="challengeJoinBtn" style="width:100%;margin-top:12px;">
      Join
    </button>
    <div id="joinChallengeError" style="color:var(--red);font-size:11px;margin-top:8px;min-height:14px;text-align:center;"></div>
  </div>
</div>
```

```js
document.getElementById('joinChallengeBtn').addEventListener('click', () => {
  if (!currentUser) {
    console.warn('⚠️  Must be signed in to join a challenge');
    return;
  }
  openOverlay('joinChallengeOverlay');
  document.getElementById('challengeCodeInput').focus();
});
document.getElementById('joinChallengeClose').addEventListener('click', () =>
  closeOverlay('joinChallengeOverlay'));
document.getElementById('challengeJoinBtn').addEventListener('click', submitJoinChallenge);
document.getElementById('challengeCodeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitJoinChallenge();
});

async function submitJoinChallenge() {
  const code = document.getElementById('challengeCodeInput').value.trim().toUpperCase();
  const errEl = document.getElementById('joinChallengeError');
  errEl.textContent = '';

  if (code.length !== 4) {
    errEl.textContent = 'Code must be 4 characters';
    return;
  }
  try {
    const doc = await fbDb.collection('challenges').doc(code).get();
    if (!doc.exists) {
      errEl.textContent = 'No challenge with that code';
      return;
    }
    const data = doc.data();
    if (data.status !== 'active') {
      errEl.textContent = 'This challenge has ended';
      return;
    }
    if (data.endTs.toMillis() < Date.now()) {
      errEl.textContent = 'This challenge has expired';
      return;
    }
    closeOverlay('joinChallengeOverlay');
    joinChallenge(code);
  } catch (err) {
    errEl.textContent = 'Error: ' + err.message;
  }
}

async function joinChallenge(code) {
  if (!currentUser) return;
  try {
    await fbDb.collection('challenges').doc(code).collection('participants').doc(currentUser.uid).set({
      uid:          currentUser.uid,
      displayName:  currentUser.displayName || 'Guest',
      photoURL:     currentUser.photoURL || '',
      currentN:     state.n,
      reachedTargetTs: null,
      joinedTs:     firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:    firebase.firestore.FieldValue.serverTimestamp(),
    });
    state.challenge.activeCode = code;
    state.challenge.startingN  = state.n;
    state.challenge.isCreator  = false; // set true by createChallenge flow
    subscribeToChallenge(code);
    console.log(`✅ Joined challenge ${code}`);
  } catch (err) {
    console.error('❌ Join error:', err.message);
  }
}
```

### Subscriptions and banner

Once joined, two listeners run: one on the challenge doc (for status, time remaining), one on the participants subcollection (for leaderboard).

```js
function subscribeToChallenge(code) {
  if (state.challenge.unsubDoc) state.challenge.unsubDoc();
  if (state.challenge.unsubList) state.challenge.unsubList();

  state.challenge.unsubDoc = fbDb.collection('challenges').doc(code)
    .onSnapshot(snap => {
      if (!snap.exists) { endChallengeSession(); return; }
      state.challenge.doc = snap.data();
      renderChallengeBanner();
    });

  state.challenge.unsubList = fbDb.collection('challenges').doc(code).collection('participants')
    .orderBy('currentN', 'desc').limit(20)
    .onSnapshot(snap => {
      renderChallengeLeaderboard(snap.docs.map(d => d.data()));
    });
}

function endChallengeSession() {
  if (state.challenge.unsubDoc)  state.challenge.unsubDoc();
  if (state.challenge.unsubList) state.challenge.unsubList();
  state.challenge = { activeCode: null, isCreator: false, doc: null, unsubDoc: null, unsubList: null, startingN: 1 };
  document.getElementById('challengeBanner').style.display = 'none';
}
```

### Challenge banner

A strip across the top of the app (above the top-bar or replacing the streak badge area while active):

```html
<div id="challengeBanner" style="display:none;" class="challenge-banner">
  <div class="ch-banner-main">
    <div class="ch-banner-title">
      <span id="chBannerName">Class Challenge</span> ·
      Target F(<span id="chBannerTarget">13</span>) ·
      <span id="chBannerCountdown">10:00</span> left
    </div>
    <div class="ch-banner-code">Code: <strong id="chBannerCode">----</strong></div>
  </div>
  <div class="ch-banner-rank" id="chBannerRank">You: F(?) · Rank ?/?</div>
  <button class="ch-banner-leave" id="chBannerLeave" title="Leave challenge">✕</button>
</div>
```

```css
.challenge-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  background: linear-gradient(90deg, rgba(245,166,35,0.15), rgba(245,166,35,0.05));
  border: 1px solid var(--amber);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px; color: var(--txt);
}
.ch-banner-main { flex: 1; min-width: 0; }
.ch-banner-title { font-weight: 600; }
.ch-banner-code { font-size: 10px; color: var(--txt2); margin-top: 2px; }
.ch-banner-rank {
  padding: 4px 10px;
  background: var(--amber); color: #0b0f1a;
  border-radius: 5px; font-weight: 700;
  white-space: nowrap;
}
.ch-banner-leave {
  background: none; border: none; color: var(--txt3); cursor: pointer;
  font-size: 14px; padding: 4px 8px;
}
.ch-banner-leave:hover { color: var(--txt); }
```

Place inside `.shell` between `.top-bar` and `.main-row`.

### Render logic

```js
let challengeCountdownAF = null;

function renderChallengeBanner() {
  const b = document.getElementById('challengeBanner');
  const doc = state.challenge.doc;
  if (!doc || doc.status === 'ended') {
    b.style.display = 'none';
    return;
  }
  b.style.display = 'flex';
  document.getElementById('chBannerName').textContent     = doc.name;
  document.getElementById('chBannerTarget').textContent   = doc.targetN;
  document.getElementById('chBannerCode').textContent     = doc.code;

  if (challengeCountdownAF) clearInterval(challengeCountdownAF);
  function updateCountdown() {
    const msLeft = Math.max(0, doc.endTs.toMillis() - Date.now());
    const mm = Math.floor(msLeft / 60000);
    const ss = Math.floor((msLeft % 60000) / 1000);
    document.getElementById('chBannerCountdown').textContent =
      `${mm}:${String(ss).padStart(2, '0')}`;
    if (msLeft <= 0) {
      clearInterval(challengeCountdownAF);
      handleChallengeEnd();
    }
  }
  updateCountdown();
  challengeCountdownAF = setInterval(updateCountdown, 1000);
}

function renderChallengeLeaderboard(participants) {
  // Find this user's rank
  const myIdx = participants.findIndex(p => p.uid === (currentUser && currentUser.uid));
  const rankText = myIdx >= 0
    ? `You: F(${participants[myIdx].currentN}) · Rank ${myIdx + 1}/${participants.length}`
    : 'Not yet ranked';
  document.getElementById('chBannerRank').textContent = rankText;
}
```

### Reporting progress

Every time `commitN` fires during an active challenge, write the updated `currentN` and (if the target was just reached) the `reachedTargetTs`:

```js
// In commitN, after maybeSaveScore:
if (state.challenge.activeCode) {
  reportChallengeProgress(newN);
}

let challengeReportTimer = 0;
function reportChallengeProgress(n) {
  if (!state.challenge.activeCode || !currentUser) return;
  clearTimeout(challengeReportTimer);
  challengeReportTimer = setTimeout(async () => {
    const update = {
      currentN:  n,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    const target = state.challenge.doc && state.challenge.doc.targetN;
    if (target && Math.abs(n) >= target && !state._challengeTargetReached) {
      update.reachedTargetTs = firebase.firestore.FieldValue.serverTimestamp();
      state._challengeTargetReached = true;
      showChallengeCompleteBanner();
    }
    try {
      await fbDb.collection('challenges').doc(state.challenge.activeCode)
        .collection('participants').doc(currentUser.uid).set(update, { merge: true });
    } catch (err) {
      console.error('❌ Challenge progress error:', err.message);
    }
  }, 500); // debounce
}
```

### Student reaches target

```js
function showChallengeCompleteBanner() {
  // Big celebration — reuse confetti
  for (let i = 0; i < 3; i++) {
    setTimeout(() => launchConfetti(state._sw / 2, state._sh / 2, 100), i * 300);
  }
  // Brief modal announcing "You hit the target!"
  const overlay = document.createElement('div');
  overlay.className = 'overlay-backdrop open';
  overlay.innerHTML = `
    <div class="overlay-panel" style="text-align:center;">
      <div style="font-size:60px;margin-bottom:10px;">🎉</div>
      <div style="font-size:22px;font-weight:700;color:var(--amber);margin-bottom:8px;font-family:'Cormorant Garamond',serif;">You reached F(${state.challenge.doc.targetN})!</div>
      <p style="color:var(--txt2);font-size:13px;">The challenge continues — keep climbing to stay at the top.</p>
      <button class="btn btn-primary" id="chCompleteOk" style="margin-top:16px;">Nice</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('chCompleteOk').addEventListener('click', () => overlay.remove());
  setTimeout(() => overlay.remove(), 7000);
}
```

### Challenge ends (time up or ended early)

```js
async function handleChallengeEnd() {
  const code = state.challenge.activeCode;
  if (!code) return;

  // Admin writes final status
  if (state.challenge.isCreator && state.challenge.doc && state.challenge.doc.status === 'active') {
    try {
      await fbDb.collection('challenges').doc(code).set({ status: 'ended' }, { merge: true });
    } catch (err) { console.error('❌ End challenge error:', err.message); }
  }

  // Show final results modal to everyone
  showChallengeResultsModal();
}

function showChallengeResultsModal() {
  // Fetch final participant list
  fbDb.collection('challenges').doc(state.challenge.activeCode).collection('participants')
    .orderBy('currentN', 'desc').limit(20).get()
    .then(snap => {
      const rows = snap.docs.map(d => d.data());
      const me = rows.find(r => r.uid === currentUser.uid);
      const myRank = rows.findIndex(r => r.uid === currentUser.uid) + 1;

      const overlay = document.createElement('div');
      overlay.className = 'overlay-backdrop open';
      overlay.innerHTML = `
        <div class="overlay-panel" style="width:420px;max-width:94vw;">
          <div class="overlay-title">🏁 Challenge Ended</div>
          <p style="color:var(--txt2);font-size:12px;margin-bottom:12px;">
            ${state.challenge.doc.name} · Target F(${state.challenge.doc.targetN})
          </p>
          <div style="background:var(--bg2);border-radius:8px;padding:14px;margin-bottom:14px;text-align:center;">
            <div style="font-size:10px;color:var(--txt3);font-family:'JetBrains Mono',monospace;">Your final rank</div>
            <div style="font-size:36px;color:var(--amber);font-weight:700;font-family:'Cormorant Garamond',serif;">${myRank} of ${rows.length}</div>
            <div style="font-size:11px;color:var(--txt2);font-family:'JetBrains Mono',monospace;">Reached F(${me ? me.currentN : '?'})</div>
          </div>
          <div class="overlay-section">Final Standings</div>
          <div>${rows.slice(0,10).map((r,i) => `
            <div class="lb-row">
              <div class="lb-rank ${i===0?'top1':i===1?'top2':i===2?'top3':''}">${['🥇','🥈','🥉'][i]||`${i+1}.`}</div>
              <div class="lb-name ${r.uid===currentUser.uid?'is-me':''}">${escHtml(r.displayName)}</div>
              <div class="lb-score">F(${r.currentN})</div>
            </div>`).join('')}
          </div>
          <button class="btn btn-primary" style="width:100%;margin-top:14px;" id="chResultsOk">Close</button>
        </div>`;
      document.body.appendChild(overlay);
      document.getElementById('chResultsOk').addEventListener('click', () => {
        overlay.remove();
        endChallengeSession();
      });
    })
    .catch(err => console.error('❌ Results fetch error:', err.message));
}
```

### Admin "end early" button

When admin is in an active challenge, the challenge banner shows an extra button:

```js
// In renderChallengeBanner, if state.challenge.isCreator:
if (state.challenge.isCreator && doc.status === 'active') {
  // Show "End now" button in the banner
  // Hook: wrap the existing banner with a conditional "End now" button
  // On click: fbDb.collection('challenges').doc(code).set({ status: 'ended', endedEarly: true }, { merge: true })
}
```

### Active panel — admin view

When admin created a challenge, the admin panel in settings shows the live stats instead of the create form:

```js
function renderAdminChallengePanel() {
  const createForm = document.getElementById('challengeCreateForm');
  const active     = document.getElementById('challengeActivePanel');
  if (state.challenge.activeCode && state.challenge.isCreator) {
    createForm.style.display = 'none';
    active.style.display = '';
    active.innerHTML = `
      <div style="text-align:center;padding:14px;background:var(--bg2);border-radius:8px;">
        <div style="font-size:10px;color:var(--txt3);font-family:'JetBrains Mono',monospace;">Share this code</div>
        <div style="font-size:44px;color:var(--amber);font-weight:700;font-family:'JetBrains Mono',monospace;letter-spacing:8px;">${state.challenge.activeCode}</div>
      </div>
      <button class="btn btn-secondary" id="chEndEarlyBtn" style="width:100%;margin-top:10px;">End Challenge Now</button>`;
    document.getElementById('chEndEarlyBtn').addEventListener('click', async () => {
      if (!confirm('End this challenge now for all participants?')) return;
      await fbDb.collection('challenges').doc(state.challenge.activeCode)
        .set({ status: 'ended', endedEarly: true }, { merge: true });
      handleChallengeEnd();
    });
  } else {
    createForm.style.display = '';
    active.style.display = 'none';
  }
}
```

Call this in `openOverlay('settingsOverlay')` handler and after `createChallenge` completes.

### Boot integration

On sign-in, check if the user is a participant in any active challenge (maybe they closed the tab mid-challenge):

```js
// In onSignIn, after data loads:
if (currentUser && fbDb) {
  // Scan for participation in active challenges
  const q = await fbDb.collectionGroup('participants').where('uid', '==', currentUser.uid).get();
  for (const doc of q.docs) {
    const parentCode = doc.ref.parent.parent.id;
    const challengeDoc = await fbDb.collection('challenges').doc(parentCode).get();
    if (challengeDoc.exists) {
      const data = challengeDoc.data();
      if (data.status === 'active' && data.endTs.toMillis() > Date.now()) {
        // Resume the challenge session
        state.challenge.activeCode = parentCode;
        state.challenge.isCreator  = data.creatorUid === currentUser.uid;
        subscribeToChallenge(parentCode);
        break;
      }
    }
  }
}
```

### Testing checklist

- [ ] Admin opens settings → sees Create Challenge section
- [ ] Non-admin does NOT see Create Challenge section
- [ ] Admin creates challenge → generates 4-char code, writes Firestore doc, joins as creator
- [ ] Banner appears with countdown
- [ ] Second user (different browser/incognito) → clicks Join Challenge → enters code → sees banner
- [ ] Commit increments `currentN` in Firestore (debounced, not per-click)
- [ ] Student reaches target → reachedTargetTs written, celebration modal fires
- [ ] Timer reaches zero → status flips to ended, results modal appears for both users
- [ ] Admin "End now" → immediately ends for all
- [ ] Leaving mid-session: close tab, reopen → challenge auto-resumes if still active
- [ ] Invalid code → friendly error message
- [ ] Expired code → friendly error message
- [ ] Banner shows rank and F(n) live-updating

---

## Order of implementation

1. **Level Pop-ups** — small, contained, independent feature. Ship first. Half-day of work.
2. **Classroom Challenge Mode** — big feature, new Firestore collection, admin flows, multi-user testing. Requires the security rules update. Full day of careful work plus multi-account testing.

---

## Integration notes for Claude Code

### Firestore rules
The challenges collection requires a rules update. Document this clearly in the deploy checklist:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /scores/{uid} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /weeklyScores/{weekId}/entries/{uid} {
      allow read: if true;
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

### Firestore collectionGroup query
The boot integration uses a `collectionGroup` query to find the user's active challenges. This requires a **composite index** in Firestore. Firebase will prompt for it on first query — create it when asked. Expected config:
- Collection ID: `participants`
- Query scope: Collection group
- Fields: `uid` (ascending)

### Abuse considerations
A student could:
- Create a bunch of challenges (minor — each write costs nothing on Spark plan)
- Join many challenges at once (we only track one at a time in state; no harm)
- Submit inflated `currentN` values (write rule only checks auth, not validity)

For a teacher-facing tool, these are acceptable. If abuse becomes a real problem, add a Cloud Function to validate participant writes against their main `scores/{uid}` peak. Not worth the effort for v4.0.

### Class size
Tested comfortably up to 30 concurrent participants. For whole-grade-level events (100+), batch the `onSnapshot` listener with a smaller `.limit(10)` — each student only sees the top 10 plus themselves.

### Single-user testing
Claude Code can test the admin flow in one browser and join via an incognito window with a separate Google account (or an anonymous session). Both should update the banner and leaderboard in real time.

### Version
When both Tier 4 features ship, bump the version comment to `<!-- v4.0 — Tier 4: Level Facts + Classroom Challenge -->`. Update `CLAUDE.md` Versioning section.

---

## Tier 4 summary

With Tier 4 shipped, Fibonacci Zoom is no longer just a game. It's a **classroom tool** with:

- Teacher-run events (Classroom Challenge Mode)
- Passive teaching moments (Level Pop-ups)
- Deep context on demand (Gallery from Tier 3)
- Community progression (Leaderboards, Weekly, Streaks from Tiers 2-3)

A CTE teacher can run this as a warm-up activity. A math teacher can use it to introduce the sequence. A student can explore it on their own and absorb the patterns without ever opening a textbook.

That is the educational product you set out to build.

---

## Complete vision — what Fibonacci Zoom becomes after all four tiers

**Pacing (Tier 1):** Click costs stay mathematically honest, but multipliers, the engine, and offline progress compress the effort curve. A player can reach F(21) in a single session, F(55) in a week, F(89) in a month.

**Identity (Tier 2):** Daily streak, 16+ achievements, and 7 themed skins turn "someone with a score" into "a player with a story."

**Surprise (Tier 3):** Weekly challenges, gallery unlocks, combo rhythm, and Golden Moments give every minute of play a chance to become memorable.

**Classroom (Tier 4):** Level facts teach passively. Challenge Mode makes the game a shared event.

Every feature in every tier pays homage to the sequence itself — reward schedules are Fibonacci numbers, skin unlocks land on Fibonacci indices, the engine rate scales by φ, the combo tiers are Fibonacci (5, 10, 21, 55). The math is not the lesson; the math is the medium.

That's how you build a game a teacher recommends to a colleague, a kid tells their friend about, and someone opens tomorrow morning because they care about their streak.
