# Fibonacci Zoom Revision Tier 3

**Priority: MEDIUM-HIGH — build these after Tier 2 ships.** Tier 1 fixed pacing. Tier 2 added identity and retention. Tier 3 is about community, polish, and the moments that make players scream "oh wait I got one!" — the difference between a game someone plays and a game someone recommends.

**Reference files in repo:**
- `fibonacci-zoom/index.html` — current app
- `fibonacci-zoom/CLAUDE.md` — architecture, conventions
- `fibonacci-zoom/README.md` — vision document
- `fibonacci-zoom/Fibonacci Zoom Revision Tier 1.md` — Boost Tokens, Engine, Offline
- `fibonacci-zoom/Fibonacci Zoom Revision Tier 2.md` — Streak, Achievements, Skins

**Dependencies from Tier 1 & 2:**
- `state.boostTokens` and `applyTicks()` (Feature 10 grants tokens, Feature 9 uses ticks)
- `state.achievements` (Feature 8 gallery unlocks achievements)
- `state.engine` (Feature 10 can grant temporary engine rate multipliers)
- Firestore `scores/{uid}` schema includes streak, achievements, skins

---

## Feature 7 — Weekly Class Challenge

### The problem this solves

Leaderboards are great but static — someone always dominates and others feel locked out. A **weekly challenge** resets the playing field every Monday, gives everyone a shot at the top, and hands teachers a ready-made classroom activity. It also turns a solo game into a shared event.

### Design

- A **week** is the ISO week (Monday 00:00 to Sunday 23:59 local).
- All players compete on the same challenge. The challenge rotates automatically by week — different *type* each week.
- A new Firestore collection `weeklyScores/{weekId}/entries/{uid}` captures the week's per-player progress.
- A new Leaderboard tab on the sidebar: "Weekly" alongside "All-Time".
- Winner announcement: at week reset, the top 3 players get a permanent badge on their profile ("Week 47 Champion 🏆").

### Challenge types (auto-rotates by ISO week number)

Use `weekNum % N` to pick. Keep N=5 initially, expand later.

| Mod | Challenge | Metric | Teaches |
|---|---|---|---|
| 0 | **Highest Peak** — reach the highest F(n) | `highestAbsN` this week | Exponential growth |
| 1 | **Deepest Dive** — reach the most negative F(n) | `|lowestN|` this week | Negative indices |
| 2 | **Most Clicks** — rack up raw click count | `clickCountThisWeek` | Persistence |
| 3 | **Flower Hunter** — collect the most flowers | `flowersCollectedThisWeek` | Attention + quick reflexes |
| 4 | **Token Magnate** — earn the most Boost Tokens this week | `tokensEarnedThisWeek` | Economic strategy |

### State additions

```js
weekly: {
  currentWeekId:        '',     // e.g., "2026-W17" — locally computed
  clickCountThisWeek:   0,
  flowersThisWeek:      0,
  tokensThisWeek:       0,
  highestAbsNThisWeek:  0,
  lowestNThisWeek:      1,
  championBadges:       [],     // array of { weekId, rank, challenge } earned previously
},
```

### Reset logic

On every sign-in and every commit, check the current ISO week. If `state.weekly.currentWeekId !== isoWeekStr()`, reset the per-week counters (but keep `championBadges` forever).

```js
function evaluateWeekly() {
  const thisWeek = isoWeekStr();
  if (state.weekly.currentWeekId === thisWeek) return;

  // New week — reset per-week counters, preserve badges
  const oldWeek = state.weekly.currentWeekId;
  state.weekly.currentWeekId       = thisWeek;
  state.weekly.clickCountThisWeek  = 0;
  state.weekly.flowersThisWeek     = 0;
  state.weekly.tokensThisWeek      = 0;
  state.weekly.highestAbsNThisWeek = state.highestAbsN; // anchor at current level
  state.weekly.lowestNThisWeek     = state.lowestN ?? 1;

  // If we just finished a week, check if user earned a champion badge
  // (This would be detected by looking at last week's leaderboard — done on the server
  //  in a more mature version. For now: client checks leaderboard snapshot at transition.)
  if (oldWeek) checkLastWeekChampion(oldWeek);

  saveProgress();
}

function currentChallengeType(weekId = state.weekly.currentWeekId) {
  if (!weekId) return 0;
  const weekNum = parseInt(weekId.split('-W')[1], 10);
  return weekNum % 5;
}

function currentChallengeMeta() {
  const types = [
    { key: 'highest',  title: 'Highest Peak',   desc: 'Reach the highest F(n) this week',      unit: 'level' },
    { key: 'lowest',   title: 'Deepest Dive',   desc: 'Reach the most negative F(n)',          unit: 'depth' },
    { key: 'clicks',   title: 'Most Clicks',    desc: 'Rack up the most clicks',               unit: 'clicks' },
    { key: 'flowers',  title: 'Flower Hunter',  desc: 'Collect the most flowers',              unit: 'flowers' },
    { key: 'tokens',   title: 'Token Magnate',  desc: 'Earn the most Boost Tokens',            unit: 'tokens' },
  ];
  return types[currentChallengeType()];
}
```

### Tracking the metric

Hook into the right existing events:

**In `tickInput`:**
```js
state.weekly.clickCountThisWeek++;
// Light debounced save — don't hammer Firestore
if (state.weekly.clickCountThisWeek % 10 === 0) debouncedSaveProgress();
```

**In `commitN`, after updating `highestAbsN` and `lowestN`:**
```js
if (state.highestAbsN > state.weekly.highestAbsNThisWeek) {
  state.weekly.highestAbsNThisWeek = state.highestAbsN;
  maybeUpdateWeeklyScore();
}
if ((state.lowestN ?? 1) < state.weekly.lowestNThisWeek) {
  state.weekly.lowestNThisWeek = state.lowestN;
  maybeUpdateWeeklyScore();
}
```

**In flower collection (`collectFlower` handler):**
```js
state.weekly.flowersThisWeek++;
maybeUpdateWeeklyScore();
```

**In `awardBoostTokens` from Tier 1:**
```js
state.weekly.tokensThisWeek += total;
maybeUpdateWeeklyScore();
```

### Weekly Firestore write

A new collection with one doc per user per week:

```js
async function maybeUpdateWeeklyScore() {
  if (!currentUser || !fbDb) return;
  const weekId = state.weekly.currentWeekId;
  if (!weekId) return;

  const challengeType = currentChallengeType();
  const metricKey = ['highest','lowest','clicks','flowers','tokens'][challengeType];
  const metric = {
    highest: state.weekly.highestAbsNThisWeek,
    lowest:  Math.abs(state.weekly.lowestNThisWeek),
    clicks:  state.weekly.clickCountThisWeek,
    flowers: state.weekly.flowersThisWeek,
    tokens:  state.weekly.tokensThisWeek,
  }[metricKey];

  try {
    await fbDb.collection('weeklyScores').doc(weekId).collection('entries').doc(currentUser.uid).set({
      uid:         currentUser.uid,
      displayName: currentUser.displayName || 'Guest',
      photoURL:    currentUser.photoURL || '',
      metricKey,
      metric,
      updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error('❌ Weekly score write error:', err.message);
  }
}
```

**Debounce this** — use the same 2-second debounce pattern as `saveProgress` to avoid flooding Firestore.

### Firestore security rules update

Add to the existing rules in Firebase console:

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
  }
}
```

### Weekly leaderboard UI

Add tabs to the existing leaderboard card:

```html
<div class="card">
  <div class="card-title">
    🏆 Leaderboard
    <div class="lb-tabs" style="margin-left:auto;">
      <button class="lb-tab active" data-tab="alltime">All-time</button>
      <button class="lb-tab" data-tab="weekly">Weekly</button>
    </div>
  </div>
  <div id="lbChallengeHeader" style="display:none;"></div>
  <div id="lbList"><div class="lb-empty">Loading…</div></div>
  <div class="lb-status" id="lbStatus"></div>
</div>
```

```css
.lb-tabs { display: flex; gap: 4px; }
.lb-tab {
  padding: 3px 8px; font-size: 10px;
  background: transparent; border: 1px solid var(--border);
  border-radius: 5px; color: var(--txt2);
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer; transition: all .15s;
}
.lb-tab:hover { border-color: var(--amber); color: var(--amber); }
.lb-tab.active {
  background: var(--amber); color: #0b0f1a; border-color: var(--amber);
}
#lbChallengeHeader {
  padding: 8px; margin-bottom: 8px;
  background: rgba(245,166,35,0.08);
  border-left: 3px solid var(--amber);
  border-radius: 4px;
  font-size: 11px; color: var(--txt2);
}
#lbChallengeHeader .ch-title {
  font-weight: 700; color: var(--amber); font-size: 12px;
  margin-bottom: 3px;
}
#lbChallengeHeader .ch-countdown {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; color: var(--txt3);
  margin-top: 4px;
}
```

```js
let activeLbTab = 'alltime';

document.querySelectorAll('.lb-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    activeLbTab = btn.dataset.tab;
    document.querySelectorAll('.lb-tab').forEach(b => b.classList.toggle('active', b === btn));
    restartLeaderboardListener();
  });
});

function restartLeaderboardListener() {
  if (lbUnsub) lbUnsub();
  if (activeLbTab === 'alltime') {
    startLeaderboardListener(); // existing function
    document.getElementById('lbChallengeHeader').style.display = 'none';
  } else {
    startWeeklyLeaderboardListener();
    renderChallengeHeader();
    document.getElementById('lbChallengeHeader').style.display = '';
  }
}

function renderChallengeHeader() {
  const ch = currentChallengeMeta();
  const weekId = state.weekly.currentWeekId;
  const countdown = formatTimeUntilMonday();
  document.getElementById('lbChallengeHeader').innerHTML = `
    <div class="ch-title">This Week: ${ch.title}</div>
    <div>${ch.desc}</div>
    <div class="ch-countdown">${weekId} · resets in ${countdown}</div>`;
}

function formatTimeUntilMonday() {
  const now = new Date();
  const nextMonday = new Date(now);
  const dayNr = (now.getDay() + 6) % 7; // 0 = Monday
  nextMonday.setDate(now.getDate() + (7 - dayNr));
  nextMonday.setHours(0, 0, 0, 0);
  const ms = nextMonday - now;
  const days = Math.floor(ms / 86400000);
  const hrs  = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `${days}d ${hrs}h` : `${hrs}h`;
}

function startWeeklyLeaderboardListener() {
  const weekId = state.weekly.currentWeekId;
  if (!fbDb || !weekId) return;
  lbUnsub = fbDb.collection('weeklyScores').doc(weekId).collection('entries')
    .orderBy('metric', 'desc')
    .limit(10)
    .onSnapshot(snap => {
      renderWeeklyLeaderboard(snap.docs.map(d => d.data()));
    }, err => {
      console.error('❌ Weekly LB error:', err.message);
    });
}

function renderWeeklyLeaderboard(rows) {
  const ch = currentChallengeMeta();
  const list = document.getElementById('lbList');
  if (!rows.length) {
    list.innerHTML = '<div class="lb-empty">No entries yet — be first!</div>';
    syncMobileLeaderboard(list.innerHTML, '');
    return;
  }
  const rankClass = i => i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
  const medal     = i => ['🥇','🥈','🥉'][i] ?? `${i+1}.`;
  const isMe      = row => currentUser && row.uid === currentUser.uid;

  list.innerHTML = rows.map((row, i) => `
    <div class="lb-row">
      <div class="lb-rank ${rankClass(i)}">${medal(i)}</div>
      ${row.photoURL
        ? `<img class="lb-avatar" src="${row.photoURL}" alt="" referrerpolicy="no-referrer">`
        : `<div class="lb-avatar"></div>`}
      <div class="lb-name ${isMe(row) ? 'is-me' : ''}">${escHtml(row.displayName || 'Anonymous')}</div>
      <div class="lb-score">${formatMetric(ch.key, row.metric)}</div>
    </div>`).join('');

  document.getElementById('lbStatus').textContent = `${rows.length} player${rows.length!==1?'s':''}`;
}

function formatMetric(key, value) {
  if (key === 'highest' || key === 'lowest') return `F(${value})`;
  return fmt(BigInt(Math.round(value)));
}
```

### Champion badge

When the week ends and the user is in the top 3, grant a permanent badge. Client-side detection at the moment of week transition:

```js
async function checkLastWeekChampion(lastWeekId) {
  if (!currentUser || !fbDb) return;
  try {
    const snap = await fbDb.collection('weeklyScores').doc(lastWeekId).collection('entries')
      .orderBy('metric', 'desc').limit(3).get();
    const rows = snap.docs.map(d => d.data());
    const myIdx = rows.findIndex(r => r.uid === currentUser.uid);
    if (myIdx === -1) return;
    const rank = myIdx + 1;
    const challenge = currentChallengeType(lastWeekId);
    const badge = { weekId: lastWeekId, rank, challenge, ts: Date.now() };
    state.weekly.championBadges.push(badge);
    saveProgress();
    showChampionToast(badge);
  } catch (err) {
    console.error('❌ Champion check error:', err.message);
  }
}

function showChampionToast(badge) {
  const medals = ['🥇','🥈','🥉'];
  const container = document.getElementById('achievementToasts');
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `
    <div class="emblem">${medals[badge.rank-1]}</div>
    <div>
      <div class="ach-label">Weekly Champion</div>
      <div class="ach-title">${badge.weekId} · Rank ${badge.rank}</div>
    </div>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}
```

### Account card — display champion badges

Under the user's name in the Account card:

```js
function renderChampionBadges() {
  const badges = state.weekly.championBadges || [];
  if (!badges.length) return '';
  const medals = ['🥇','🥈','🥉'];
  const recent = badges.slice(-5);
  return `<div style="margin-top:6px;font-size:14px;">${recent.map(b => medals[b.rank-1]).join(' ')}</div>`;
}
// Update user info section after sign-in to include this
```

### Testing checklist

- [ ] On first load in a new week, currentWeekId initializes correctly
- [ ] Click counter increments during play
- [ ] Reach a new peak — weeklyScore write to correct week doc
- [ ] Weekly tab shows current challenge header and countdown
- [ ] Another user's weekly score visible in real time (test with two accounts)
- [ ] Manually change `state.weekly.currentWeekId` to last week → evaluateWeekly resets counters
- [ ] Rank in top 3 last week → champion toast fires + badge stored
- [ ] Badge visible in Account card after reload

---

## Feature 8 — "Found in Nature" Gallery

### The problem this solves

The Mona Lisa easter egg at F(12) hinted at something beautiful: real images tied to real Fibonacci phenomena. Systematize it. Every 3 levels unlocks a new image-fact pair. Over time the gallery becomes a little museum of the sequence's presence in the world — something the player proudly shows to a skeptical friend.

### Design

- Unlocks start at F(3). A new image every 3 levels: F(3), F(6), F(9), F(12), ... up to F(30).
- Image sources: use free/CC-licensed Wikimedia Commons images via their permanent URLs. No image hosting required on our side.
- A "Gallery" button in top-bar (after the achievements trophy). Opens a modal grid of image cards — unlocked ones are clickable, locked ones are silhouettes with unlock hint.
- Clicking an unlocked card opens a full-view modal with the image, caption, and the Fibonacci context.

### The catalog

```js
const GALLERY = [
  { at: 3,  emblem: '🐚',
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/NautilusCutawayLogarithmicSpiral.jpg/480px-NautilusCutawayLogarithmicSpiral.jpg',
    title: 'Nautilus Shell',
    fact: 'The chambered nautilus grows each new section about φ times larger than the last. Cutting the shell in half reveals this perfect logarithmic spiral.' },
  { at: 6,  emblem: '🌻',
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Helianthus_whorl.jpg/480px-Helianthus_whorl.jpg',
    title: 'Sunflower Seed Head',
    fact: 'Sunflower florets pack into two opposing spirals — typically 21 clockwise and 34 counter-clockwise, or 34/55, or 55/89. Always consecutive Fibonacci numbers.' },
  { at: 9,  emblem: '🌀',
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Hurricane_Isabel_from_ISS.jpg/480px-Hurricane_Isabel_from_ISS.jpg',
    title: 'Hurricane Isabel',
    fact: 'Seen from the International Space Station, hurricane arms trace a near-perfect logarithmic spiral — the limiting shape of the Fibonacci spiral.' },
  { at: 12, emblem: '🖼️',
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg/480px-Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg',
    title: 'Mona Lisa',
    fact: 'Leonardo da Vinci studied φ obsessively. The Mona Lisa\'s composition contains multiple golden-ratio rectangles — her face, the horizon line, the spiral of her hair.' },
  { at: 15, emblem: '🌌',
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Messier_74_by_HST.jpg/480px-Messier_74_by_HST.jpg',
    title: 'Messier 74 Galaxy',
    fact: 'M74, a "grand design" spiral galaxy, displays two prominent arms that follow a logarithmic curve — the same mathematics that shapes your spiral right now.' },
  { at: 18, emblem: '🌿',
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Fractal_Broccoli.jpg/480px-Fractal_Broccoli.jpg',
    title: 'Romanesco Broccoli',
    fact: 'Each bud on a Romanesco is itself composed of smaller buds in the same pattern — a natural fractal. Its spirals follow Fibonacci counts.' },
  { at: 21, emblem: '🌲',
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Pineconespiral.jpg/480px-Pineconespiral.jpg',
    title: 'Pinecone Spirals',
    fact: 'Pinecones have two families of spirals: typically 8 going one way and 13 going the other. Sometimes 5/8 on smaller cones. Always Fibonacci.' },
  { at: 24, emblem: '🍍',
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Pineapple_%284006%29.JPG/480px-Pineapple_%284006%29.JPG',
    title: 'Pineapple',
    fact: 'The hexagonal "eyes" of a pineapple form three spirals: 5, 8, and 13. Count them next time you eat one.' },
  { at: 27, emblem: '🐌',
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Helix_aspersa_shell.jpg/480px-Helix_aspersa_shell.jpg',
    title: 'Snail Shell',
    fact: 'Land snails grow by adding new chambers that are φ times larger. The shell is a record of the snail\'s entire life — each turn representing a growth phase.' },
  { at: 30, emblem: '🧬',
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/DNA_orbit_animated.gif/240px-DNA_orbit_animated.gif',
    title: 'DNA Double Helix',
    fact: 'The B-form DNA molecule is 21 Å wide and 34 Å per complete turn — F(8) and F(9). The ratio is φ. Life itself is Fibonacci.' },
];
```

Note on image sources: these are illustrative URLs — Scott (or Claude Code) should verify each loads at fetch-time. If a Wikimedia URL returns 404 in the future, swap to another free source. All listed images are CC-licensed or public domain.

### State

```js
galleryViewed: {},   // { 3: true, 6: true, ... } — marks which entries the user has opened (for "NEW" dots)
```

### UI — top bar button and modal

Add next to the achievements trophy:

```html
<button class="icon-btn" id="galleryBtn" title="Gallery">🖼️</button>

<div class="overlay-backdrop" id="galleryOverlay">
  <div class="overlay-panel" style="width: 580px; max-width: 94vw; max-height: 85vh; overflow-y: auto;">
    <button class="overlay-close" id="galleryClose">✕</button>
    <div class="overlay-title">🖼️ Found in Nature · <span id="galleryCount">0</span> / ${GALLERY.length}</div>
    <p style="font-size:12px;color:var(--txt2);line-height:1.5;margin-bottom:16px;">
      The Fibonacci sequence appears throughout the natural world. Reach new levels to unlock more.
    </p>
    <div id="galleryGrid"></div>
  </div>
</div>

<div class="overlay-backdrop" id="galleryItemOverlay">
  <div class="overlay-panel" style="width: 600px; max-width: 94vw; padding: 0; overflow: hidden;">
    <button class="overlay-close" id="galleryItemClose" style="background: rgba(0,0,0,0.5); border-radius: 50%; width: 30px; height: 30px;">✕</button>
    <img id="galleryItemImg" style="width:100%;display:block;max-height:60vh;object-fit:cover;" alt="">
    <div style="padding:20px;">
      <div id="galleryItemTitle" style="font-size:20px;font-weight:700;color:var(--amber);margin-bottom:10px;font-family:'Cormorant Garamond',serif;"></div>
      <div id="galleryItemFact" style="font-size:14px;color:var(--txt);line-height:1.6;font-family:'Cormorant Garamond',serif;"></div>
      <div id="galleryItemUnlock" style="font-size:10px;color:var(--txt3);margin-top:14px;font-family:'JetBrains Mono',monospace;"></div>
    </div>
  </div>
</div>
```

```css
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}
.gallery-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all .2s;
  aspect-ratio: 1;
  position: relative;
}
.gallery-card:hover:not(.gallery-locked) {
  border-color: var(--amber);
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0,0,0,0.4);
}
.gallery-card img {
  width: 100%; height: 70%;
  object-fit: cover;
  display: block;
}
.gallery-card .caption {
  padding: 6px 8px;
  font-size: 11px; color: var(--txt);
  font-weight: 600; text-align: center;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.gallery-card.gallery-locked { cursor: default; }
.gallery-card.gallery-locked .img-placeholder {
  width: 100%; height: 70%;
  background: var(--bg); display: flex;
  align-items: center; justify-content: center;
  font-size: 38px; opacity: 0.2; filter: grayscale(1);
}
.gallery-card.gallery-locked .caption {
  color: var(--txt3);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
}
.gallery-card .new-dot {
  position: absolute; top: 6px; right: 6px;
  width: 10px; height: 10px; background: var(--amber);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--amber);
}
```

```js
function openGalleryModal() {
  renderGalleryGrid();
  document.getElementById('galleryOverlay').classList.add('open');
}

function renderGalleryGrid() {
  const grid = document.getElementById('galleryGrid');
  const count = document.getElementById('galleryCount');
  const unlocked = GALLERY.filter(g => state.highestAbsN >= g.at).length;
  count.textContent = unlocked;

  grid.innerHTML = '<div class="gallery-grid">' + GALLERY.map(g => {
    const locked = state.highestAbsN < g.at;
    const isNew = !locked && !state.galleryViewed[g.at];
    let cls = 'gallery-card';
    if (locked) cls += ' gallery-locked';
    if (isNew) cls += ' gallery-new';
    return `
      <div class="${cls}" data-at="${g.at}">
        ${isNew ? '<div class="new-dot"></div>' : ''}
        ${locked
          ? `<div class="img-placeholder">${g.emblem}</div>`
          : `<img src="${g.src}" alt="${g.title}" loading="lazy">`}
        <div class="caption">${locked ? `F(${g.at})` : g.title}</div>
      </div>`;
  }).join('') + '</div>';

  grid.querySelectorAll('.gallery-card:not(.gallery-locked)').forEach(card => {
    card.addEventListener('click', () => openGalleryItem(parseInt(card.dataset.at, 10)));
  });
}

function openGalleryItem(atN) {
  const item = GALLERY.find(g => g.at === atN);
  if (!item) return;
  document.getElementById('galleryItemImg').src = item.src;
  document.getElementById('galleryItemImg').alt = item.title;
  document.getElementById('galleryItemTitle').textContent = item.title;
  document.getElementById('galleryItemFact').textContent = item.fact;
  document.getElementById('galleryItemUnlock').textContent =
    `Unlocked at F(${item.at}) = ${fmt(fib(item.at))}`;
  document.getElementById('galleryItemOverlay').classList.add('open');
  // Mark as viewed
  state.galleryViewed[atN] = true;
  saveProgress();
  // Re-render grid to clear the NEW dot
  renderGalleryGrid();
}

// Wire up buttons
document.getElementById('galleryBtn').addEventListener('click', openGalleryModal);
document.getElementById('galleryClose').addEventListener('click', () => closeOverlay('galleryOverlay'));
document.getElementById('galleryItemClose').addEventListener('click', () => closeOverlay('galleryItemOverlay'));
document.getElementById('galleryOverlay').addEventListener('click', e => {
  if (e.target.id === 'galleryOverlay') closeOverlay('galleryOverlay');
});
document.getElementById('galleryItemOverlay').addEventListener('click', e => {
  if (e.target.id === 'galleryItemOverlay') closeOverlay('galleryItemOverlay');
});
```

### Unlock toast

When `state.highestAbsN` crosses a gallery threshold in `commitN`:

```js
// After updating highestAbsN, before checkAchievements:
GALLERY.forEach(g => {
  if (g.at > 0 && state.highestAbsN === g.at) {
    showGalleryUnlockToast(g);
  }
});

function showGalleryUnlockToast(item) {
  const container = document.getElementById('achievementToasts');
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `
    <div class="emblem">${item.emblem}</div>
    <div>
      <div class="ach-label">Gallery: new image</div>
      <div class="ach-title">${item.title}</div>
    </div>`;
  toast.addEventListener('click', () => {
    toast.remove();
    openGalleryModal();
    setTimeout(() => openGalleryItem(item.at), 200);
  });
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5100);
}
```

### Retire the Mona Lisa easter egg drawing

The current app hardcodes the Mona Lisa onto the F(12) square. With the gallery feature, the easter egg graduates to a proper gallery entry. Either:
- **Option A:** Keep the canvas overlay as a bonus — the square-painting is still cool.
- **Option B (recommended):** Remove the canvas overlay and rely on the gallery entry alone. Simpler code.

Claude Code should choose Option B unless Scott prefers the visual echo. Remove the `<img id="monaLisa">` hidden element and the `drawSpiral` block that paints it on sq12.

### Testing checklist

- [ ] Gallery button visible in top bar
- [ ] Grid shows 10 entries; locked ones as emblems with F(n) captions
- [ ] Reach F(3) — Nautilus unlocks, toast fires, image viewable in gallery
- [ ] NEW dot disappears after viewing
- [ ] Images load from Wikimedia (verify at least 3 URLs successfully return images)
- [ ] Lazy loading prevents all images loading at once
- [ ] Full-view modal shows image, title, and fact
- [ ] Click backdrop closes modal
- [ ] Old Mona Lisa canvas overlay removed (or kept intentionally per Scott's call)

---

## Feature 9 — Combo System

### The problem this solves

Active clicking in the mid-game (around F(13)-F(21)) becomes rote. A **combo system** rewards rhythm and attention — clicking within a short window of your last click builds up a multiplier. This makes active play feel punchy and gives idle players (who bought the engine) a reason to still click occasionally.

### Design

- **Combo window:** 1 second. Click within 1s of your last click → combo count increments.
- **Combo tiers:** at 5, 10, 21, 55 hits, the tick multiplier increases.
- **Decay:** if more than 1 second passes, combo resets to 0.
- **Auto-clicks from the engine do NOT build combos** — they would make combos meaningless. Only human clicks count.
- **Visual feedback:** a combo counter and multiplier badge appear on screen during active combos, fading out after the window expires.

### Combo tier table

| Combo count | Multiplier | Feel |
|---|---|---|
| 0–4 | ×1 | Normal |
| 5–9 | ×1.5 | "Warming up" |
| 10–20 | ×2 | "On a roll" |
| 21–54 | ×3 | "Streaking" |
| 55+ | ×5 | "Unstoppable" |

Each multiplier tier is capped at its Fibonacci threshold, so there's no runaway past ×5.

### State

```js
combo: {
  count:        0,
  lastClickAt:  0,      // performance.now()
  multTier:     1,      // cached current multiplier
  fadeAF:       null,
},
```

### Integration in `tickInput`

Wrap the existing tick computation:

```js
function tickInput(dir) {
  if (celebrationAF) return;
  state.nlIndSign  = dir;
  state.nlIndAlpha = 1.0;
  state.clickCounter++;

  // Combo tracking — only human input, not engine
  const now = performance.now();
  if (now - state.combo.lastClickAt < 1000) {
    state.combo.count++;
  } else {
    state.combo.count = 1;
  }
  state.combo.lastClickAt = now;
  state.combo.multTier = comboMultiplier(state.combo.count);
  updateComboDisplay();
  scheduleComboFade();

  if (state.mode === 'standard') {
    commitN(state.n + dir);
    return;
  }

  // Fib-steps with multipliers AND combo
  if (dir !== state.stepDir) {
    state.stepDir = dir;
    state.subStep = 0;
  }

  let ticksThisClick = clickMultiplier() * state.combo.multTier;

  // Periodic boost bonuses (from Tier 1)
  if (state.boostUpgrades.fingers && state.clickCounter % 5 === 0) {
    ticksThisClick += 5;
  }
  if (state.boostUpgrades.touch && state.clickCounter % 13 === 0) {
    ticksThisClick += 233;
  }

  applyTicks(ticksThisClick);
  updateModeInfo();
  // ... rest of existing tickInput (confetti, smiley triggers) ...
}

function comboMultiplier(count) {
  if (count >= 55) return 5;
  if (count >= 21) return 3;
  if (count >= 10) return 2;
  if (count >= 5)  return 1.5;
  return 1;
}
```

### Engine ticks do NOT increment combo

In the engine loop (`startEngineLoop` from Tier 1), the engine calls `applyTicks` directly — not `tickInput`. So combo is naturally excluded. No change needed.

### Combo display

Floating badge in the upper-center of the canvas. Shows live count and current multiplier.

```html
<div id="comboDisplay" style="position:absolute;top:20px;left:50%;transform:translateX(-50%);z-index:7;pointer-events:none;display:none;">
  <div class="combo-count" id="comboCount">0</div>
  <div class="combo-mult" id="comboMult">×1</div>
</div>
```

```css
#comboDisplay {
  text-align: center;
  font-family: 'Cormorant Garamond', serif;
  transition: opacity 0.3s;
}
.combo-count {
  font-size: 42px; font-weight: 700;
  background: linear-gradient(135deg, var(--amber-l), var(--orange));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1;
  text-shadow: 0 2px 8px rgba(245,166,35,0.4);
}
.combo-mult {
  font-size: 14px; font-weight: 600;
  color: var(--amber);
  font-family: 'JetBrains Mono', monospace;
  margin-top: 2px;
  letter-spacing: .1em;
}
@keyframes comboPulse {
  0%   { transform: translateX(-50%) scale(1.3); }
  100% { transform: translateX(-50%) scale(1); }
}
#comboDisplay.pulse {
  animation: comboPulse .25s ease-out;
}
```

Add inside the `.canvas-box` div (before the canvas-footer):

```html
<div class="canvas-box">
  <canvas id="spiralCanvas"></canvas>
  <canvas id="confettiCanvas"></canvas>
  <div id="flowerLayer"></div>
  <div id="comboDisplay">...</div>  <!-- NEW -->
  <div class="canvas-footer">...</div>
</div>
```

```js
function updateComboDisplay() {
  const el = document.getElementById('comboDisplay');
  const countEl = document.getElementById('comboCount');
  const multEl  = document.getElementById('comboMult');
  if (state.combo.count < 2) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  el.style.opacity = '1';
  countEl.textContent = state.combo.count;
  multEl.textContent  = '×' + state.combo.multTier;
  // Pulse on milestone crossings
  if ([5, 10, 21, 55].includes(state.combo.count)) {
    el.classList.remove('pulse');
    void el.offsetWidth; // force reflow
    el.classList.add('pulse');
  }
}

function scheduleComboFade() {
  if (state.combo.fadeAF) clearTimeout(state.combo.fadeAF);
  state.combo.fadeAF = setTimeout(() => {
    const el = document.getElementById('comboDisplay');
    if (!el) return;
    // Fade out, then reset combo
    el.style.transition = 'opacity 0.4s';
    el.style.opacity = '0';
    setTimeout(() => {
      state.combo.count = 0;
      state.combo.multTier = 1;
      el.style.display = 'none';
      el.style.transition = '';
    }, 400);
  }, 1100); // 1s combo window + 100ms grace
}
```

### Achievement for high combo

Add to the achievements catalog in Tier 2:

```js
{ id: 'combo_21', emblem: '⚡', title: 'Streaking', unlock: 'reach a 21-click combo',
  fact: '21 clicks in under 21 seconds is F(8) worth of reflex. Jazz drummers know this rhythm.' },
{ id: 'combo_55', emblem: '🔥', title: 'Unstoppable', unlock: 'reach a 55-click combo',
  fact: '55 straight clicks. Your dopamine loop just peaked.' },
```

Check in the combo update:

```js
// In updateComboDisplay, after updating:
if (state.combo.count >= 21 && !state.achievements.combo_21) {
  state.achievements.combo_21 = Date.now();
  showAchievementToast('combo_21');
  saveProgress();
}
if (state.combo.count >= 55 && !state.achievements.combo_55) {
  state.achievements.combo_55 = Date.now();
  showAchievementToast('combo_55');
  saveProgress();
}
```

### Non-persistence

Combo state is session-only. Do not save to Firestore — it would be stale by the time it loaded. Reset on sign-in is implicit (starts at 0).

### Testing checklist

- [ ] Click 4 times within 1s each — combo display hidden
- [ ] Click 5 times — combo shows, ×1.5 multiplier active, tick output reflects it
- [ ] Click 10 times — ×2
- [ ] Pause 2 seconds — display fades, combo resets
- [ ] Engine running autonomously — combo does not build from engine ticks
- [ ] Combo resets cleanly between active sessions
- [ ] Achievement `combo_21` fires at exactly 21 clicks in a row

---

## Feature 10 — Golden Moment (Cookie Clicker-style random reward)

### The problem this solves

Nothing in the current game is *surprising*. Every reward is predictable. A random reward — something that might appear at any moment — activates variable-ratio reinforcement, the most addictive engagement pattern known to gaming. This is why Cookie Clicker's "golden cookies" are the most-imitated mechanic in the genre.

### Design

- Every **2–5 minutes** of active play, a small **golden spiral** appears at a random position on the canvas for **8 seconds**.
- Clicking it gives one of three rewards, weighted randomly:
  - 50% — `+F(currentN)` instant ticks
  - 35% — `+5 🪙 to +34 🪙` Boost Tokens
  - 15% — "**Frenzy**" — 30-second ×7 multiplier on all clicks (the classic Cookie Clicker buff)
- If not clicked in 8 seconds, it fades and a new timer starts.
- Only spawns when the tab is visible (not backgrounded).
- Does not spawn during celebration animations.
- Visually distinct from regular spirals — pulsing, larger than a click target but smaller than the main spiral, with a subtle golden glow.

### State

```js
goldenMoment: {
  activeEl:        null,       // DOM element reference for the current spiral
  nextSpawnAt:     0,          // performance.now() of next scheduled spawn
  frenzyUntil:     0,          // performance.now() while frenzy is active
},
```

### Timing

Use a single `setTimeout` chain that schedules the next spawn. Visibility-aware:

```js
function initGoldenMoment() {
  scheduleNextGolden();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleNextGolden();
    else clearGoldenTimer();
  });
}

let goldenTimer = null;
function scheduleNextGolden() {
  clearGoldenTimer();
  const delay = 120000 + Math.random() * 180000; // 2–5 min
  goldenTimer = setTimeout(spawnGolden, delay);
}
function clearGoldenTimer() {
  if (goldenTimer) { clearTimeout(goldenTimer); goldenTimer = null; }
}
```

### Spawn

```js
function spawnGolden() {
  if (celebrationAF) { scheduleNextGolden(); return; }
  if (document.visibilityState !== 'visible') { scheduleNextGolden(); return; }

  const layer = document.getElementById('flowerLayer');
  const box = layer.getBoundingClientRect();
  if (box.width < 100 || box.height < 100) { scheduleNextGolden(); return; }

  const el = document.createElement('div');
  el.className = 'golden-moment';
  el.innerHTML = `
    <svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="gg" cx="50%" cy="50%">
          <stop offset="0%" stop-color="#fff8dc"/>
          <stop offset="50%" stop-color="#fbbf24"/>
          <stop offset="100%" stop-color="#b45309"/>
        </radialGradient>
      </defs>
      <circle cx="22" cy="22" r="18" fill="url(#gg)" stroke="#fbbf24" stroke-width="1.5"/>
      <path d="M 22,8 Q 32,14 32,22 Q 32,30 22,30 Q 14,30 14,22" fill="none" stroke="#78350f" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  el.style.left = (30 + Math.random() * (box.width  - 72)) + 'px';
  el.style.top  = (30 + Math.random() * (box.height - 72)) + 'px';

  el.addEventListener('click', collectGolden);
  el.addEventListener('touchend', e => { e.preventDefault(); collectGolden(e); });

  layer.appendChild(el);
  state.goldenMoment.activeEl = el;

  // Auto-remove after 8s
  setTimeout(() => {
    if (el.parentNode) el.remove();
    if (state.goldenMoment.activeEl === el) state.goldenMoment.activeEl = null;
    scheduleNextGolden();
  }, 8000);
}

function collectGolden(e) {
  if (e) e.stopPropagation();
  const el = state.goldenMoment.activeEl;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const boxRect = document.getElementById('flowerLayer').getBoundingClientRect();
  const x = rect.left - boxRect.left + 22;
  const y = rect.top  - boxRect.top  + 22;

  el.remove();
  state.goldenMoment.activeEl = null;

  // Random reward
  const roll = Math.random();
  if (roll < 0.5) {
    // +F(n) ticks
    const ticks = Number(fibPos(Math.max(1, state.highestAbsN)));
    if (state.stepDir !== 1) { state.stepDir = 1; state.subStep = 0; }
    applyTicks(ticks);
    launchConfetti(x, y, 40);
    showPointsAnimation(x, y - 20, `+F(${state.highestAbsN})`);
  } else if (roll < 0.85) {
    // Token bonus — pick a random Fibonacci value between F(5) and F(8)
    const choices = [5, 8, 13, 21, 34];
    const tokens = choices[Math.floor(Math.random() * choices.length)];
    state.boostTokens += tokens;
    state.boostTokensLifetime += tokens;
    updateTokenDisplay();
    launchConfetti(x, y, 30);
    showPointsAnimation(x, y - 20, `+${tokens} 🪙`);
  } else {
    // Frenzy!
    state.goldenMoment.frenzyUntil = performance.now() + 30000;
    launchConfetti(x, y, 80);
    showFrenzyBanner();
  }

  // Achievement
  if (!state.achievements.golden_touch) {
    state.achievements.golden_touch = Date.now();
    showAchievementToast('golden_touch');
    saveProgress();
  }

  scheduleNextGolden();
}
```

### Frenzy multiplier

Hook into `tickInput`:

```js
// In tickInput, after computing ticksThisClick:
const frenzyActive = performance.now() < state.goldenMoment.frenzyUntil;
if (frenzyActive) ticksThisClick *= 7;
```

Same hook in the engine loop (engine does NOT benefit from combo, but Frenzy is a shared buff, so it DOES apply):

```js
// In startEngineLoop tick function, after computing `whole`:
const frenzyActive = performance.now() < state.goldenMoment.frenzyUntil;
const effective = frenzyActive ? whole * 7 : whole;
applyTicks(effective);
```

### Frenzy banner

Full-width amber bar across the top of the canvas for 30 seconds.

```html
<div id="frenzyBanner" style="display:none;position:absolute;top:10px;left:10px;right:10px;z-index:8;pointer-events:none;">
  <div class="frenzy-bar">
    <span class="frenzy-label">⚡ FRENZY — ×7 clicks</span>
    <span class="frenzy-timer" id="frenzyTimer">30s</span>
  </div>
</div>
```

```css
.frenzy-bar {
  background: linear-gradient(90deg, #fbbf24, #f97316, #fbbf24);
  background-size: 200% 100%;
  animation: frenzyShimmer 2s linear infinite;
  color: #0b0f1a;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px; font-weight: 700;
  padding: 8px 14px;
  border-radius: 8px;
  display: flex; justify-content: space-between; align-items: center;
  box-shadow: 0 4px 20px rgba(251,191,36,0.5);
  letter-spacing: .1em;
}
@keyframes frenzyShimmer {
  0%   { background-position:   0% 50%; }
  100% { background-position: 200% 50%; }
}

.golden-moment {
  position: absolute;
  width: 44px; height: 44px;
  cursor: pointer;
  pointer-events: auto;
  animation: goldenPulse 8s ease-in-out forwards;
  filter: drop-shadow(0 0 12px rgba(251,191,36,0.8));
  z-index: 7;
}
.golden-moment svg { width: 100%; height: 100%; }
@keyframes goldenPulse {
  0%   { transform: scale(0); opacity: 0; }
  6%   { transform: scale(1.3); opacity: 1; }
  10%  { transform: scale(1); }
  /* slow pulse throughout */
  50%  { transform: scale(1.1); }
  90%  { transform: scale(1); opacity: 1; }
  100% { transform: scale(0); opacity: 0; }
}
```

```js
let frenzyBannerAF = null;
function showFrenzyBanner() {
  const banner = document.getElementById('frenzyBanner');
  banner.style.display = '';
  const start = performance.now();
  const end = state.goldenMoment.frenzyUntil;
  function tick(now) {
    const remaining = Math.max(0, end - now);
    document.getElementById('frenzyTimer').textContent = Math.ceil(remaining / 1000) + 's';
    if (remaining > 0) {
      frenzyBannerAF = requestAnimationFrame(tick);
    } else {
      banner.style.display = 'none';
      frenzyBannerAF = null;
    }
  }
  frenzyBannerAF = requestAnimationFrame(tick);
}
```

### Achievement

Add to the Tier 2 catalog:

```js
{ id: 'golden_touch', emblem: '✨', title: 'Seized the Moment', unlock: 'catch a Golden Moment',
  fact: 'Variable-ratio reinforcement — not knowing when the next reward will come — is the most engaging pattern in psychology. You just experienced it.' },
```

### Visibility-aware timer management

When the user tabs away during a spawn, the active spiral should persist visually but the 8-second timer should pause. Simplest approach: instead of pausing, just treat background time as "tab inactive → expire faster" and rely on `visibilitychange` for good UX. An active Golden Moment that's 6s in when the user tabs away will be gone when they return — acceptable.

### Non-persistence

Frenzy timer (`frenzyUntil`) and active spiral are session-only. Do not save to Firestore. If the user reloads mid-frenzy, they lose the remaining seconds. Acceptable — this is a transient buff, not a permanent upgrade.

### Boot integration

Call `initGoldenMoment()` at the end of boot, after `drawSpiral()` and friends. Suggest gating on `state.highestAbsN >= 5` so new users don't see golden spirals during their first minute of play (gives them time to learn the basics first).

```js
// In boot sequence:
if (state.highestAbsN >= 5) initGoldenMoment();

// In commitN, after updating highestAbsN:
if (state.highestAbsN === 5 && !goldenTimer) initGoldenMoment();
```

### Testing checklist

- [ ] Reach F(5), play for 2-5 minutes — golden spiral appears
- [ ] Click it — one of 3 rewards fires, achievement unlocks first time
- [ ] Frenzy banner shows ×7 multiplier in tickInput AND engine
- [ ] Banner counts down to 0 and disappears
- [ ] Tab away during spawn, come back — graceful cleanup, new spawn scheduled
- [ ] Multiple sessions — rewards feel varied (run 10 catches, verify roll distribution)
- [ ] Does not spawn during celebration zoom
- [ ] Does not spawn below F(5)

---

## Order of implementation

1. **Combo System** — smallest feature, purely client-side. Ship first for quick win.
2. **Golden Moment** — requires combo system for the highest-engagement feel. Also purely client-side.
3. **Gallery** — mostly UI, image URL list. Independent of other features.
4. **Weekly Challenge** — biggest feature, adds new Firestore collection. Ship last — needs security-rule update and testing with multiple accounts.

---

## Integration notes for Claude Code

- These features introduce only one new Firestore collection (`weeklyScores`). The main `scores/{uid}` doc grows by a handful of fields; all backward-compatible with `?? default`.
- The security-rule update in Firebase Console is **required** before the weekly challenge can write — note this in the deploy checklist.
- Combo and Golden Moment both hook `tickInput` and the engine loop. Coordinate with Tier 1's `applyTicks` — make sure the multiplier stacking order is: **Frenzy × Combo × ClickMultiplier × periodic bonuses**. This order gives the most dramatic stacking feel without runaway exponents.
- The `comboPulse` and `frenzyShimmer` CSS animations add visual noise. If Scott prefers a calmer classroom feel, the animations can be softened — but don't remove them entirely. The kinetic feedback IS the dopamine loop.
- Gallery images are external (Wikimedia CDN). Add a graceful fallback: if an image fails to load, show the emblem placeholder. This is important for school networks that may block Wikimedia at some districts.
- When the game hits **v3.0** (all of Tier 3 shipped), update the version comment in `index.html` header and the Versioning section of `CLAUDE.md`.

After Tier 3, the game has **surprise** (Golden Moments), **rhythm** (combos), **community** (weekly challenge), and **depth** (gallery). A player now has reasons to play a 5-minute session, a 30-minute session, and to come back next Monday for a new challenge. The hook runs three time-scales deep.
