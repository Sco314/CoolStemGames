# Revision 2 — Pending TODO ranking (current state)

## Context

Session-end stocktake after PRs #79, #80, #81 shipped. The Phase 8 NASA
integration is live; lander damage / repair-part / carry-and-deposit /
ladder-gate map landed in PR #81. This revision compiles every item that
was deferred along the way (from PR descriptions, the original Rev 1
shopping list, and seven user-added items in the latest message), ranks
them, and tags each with the file paths and function names so future-me
can scope without re-reading code.

**Scoring axes** (each 1–5):

- **I (Impact)** — how often / how early the player feels it (level 1 = 5,
  level 10 only = 1)
- **D (Dependency weight)** — how much other deferred work hangs on this
- **E (Ease)** — small / contained = 5, multi-system + asset hunt = 1

Combined = `I + D + E`. **Brand bump (+1)** applied to items that deliver
the actual STEM-game pitch (`STEM⭐`).

## Ranked TODO

| # | Item | I/D/E | Score | Files / functions to touch |
|---|---|---|---|---|
| 1 | **Astronaut HP + damage sources + health packs** | 5/5/3 | 13 | `js/Constants.js` (ASTRO_MAX_HP, HEALTH_PACK_AMOUNT), `js/GameState.js` (`astronaut.hp/maxHp`, reset in `startNewRun()`), `js/HUD.js` (`onStateChange` + new `#hud-astro-hp` row, color-state CSS like the existing HULL gauge), `js/modes/WalkMode.js` (damage source — fall-from-height check in update(), or alien-encounter), new 'healthpack' type in `INTERACTABLE_TYPES`, deposit at habitats via `performInteraction` 'landmark' branch (heal on touch). |
| 2 | **More mission objectives + per-level unique experiences** `STEM⭐` | 5/4/3 | 13 | `js/Constants.js` — extend `OBJECTIVES` and add a `LEVEL_OBJECTIVES` map keyed by level (or by `apolloSiteForLevel(level).id`). `js/GameState.js:refreshObjectives()` already evaluates predicates — extend with level filter. `js/modes/WalkMode.js:spawnInteractables()` could add per-level conditional spawns. `js/HUD.js:renderObjectives()` already renders the list; just feeds richer data. |
| 3 | **Math questions on screen (STEM accuracy)** `STEM⭐` | 4/3/3 | 12 | New `js/MathChallenge.js` (question generators: O₂/time, fuel/burn-rate, terminal-velocity-on-moon, etc., plus answer validator). New modal in `index.html` (`#math-challenge`) + CSS. New `HUD.js` exports `showMathChallenge(spec, onResult)`. Hooks: `LanderMode` could gate ignition behind a quick math beat; walk mode could pop one before stowing or boarding. Persist `GameState.stats.mathSolved`. |
| 4 | **Real audio MP3s** | 5/1/5 | 11 | Drop files into `moonlander/audio/`. Update path strings in `js/Sound.js:initSound()` if extension changes (`.wav` → `.mp3`). The setVolume / setMuted / loop wiring stays. Worth keeping the existing fallback warn-on-error, so missing files still no-op. |
| 5 | **Mission Control text messages** | 4/3/4 | 11 | Extend `js/HUD.js:showComms()` into a longer-form `showMessage(title, body, ttl)` OR add a separate `#mission-msg` overlay with a small history log icon on the HUD. Catalog in `js/Constants.js` keyed by trigger (e.g. `MISSION_MSGS.firstLanding`, `.apollo11Reached`). Fire from `LanderMode.resolveLanding`, `WalkMode.performInteraction`, `GameState.unlockAchievement`. Reuses existing comms CSS class. |
| 6 | **Apollo 14 / 15 / 16 / 17 entries** | 4/1/5 | 10 | `js/Constants.js` — append four entries to `APOLLO_SITES` with `walkPos`, `artifactScore`, `comms`. `apolloSiteForLevel(level)` already mods by length so they auto-rotate. Pick `walkPos` so they don't overlap habitats / atlas. |
| 7 | **Particle smoke / glow texture** | 4/1/4 | 9 | Add `moonlander/textures/particle.png` (64×64 soft white blob, alpha falloff). In `js/Particles.js:buildPool()` swap each `MeshBasicMaterial({color, transparent, opacity, blending: AdditiveBlending})` to also include `map: tex` (single shared `THREE.TextureLoader().load(...)`). |
| 8 | **Higher-res `lander.png`** | 3/1/5 | 9 | Drop replacement at `moonlander/textures/lander.png`. `js/AssetCache.js:getSharedTexture` re-uses by URL; nothing else changes. Tip: keep `NearestFilter` setting in callers if you want the retro look or switch to `LinearFilter` for a smooth one. |
| 9 | **3D ladder-climb animation** | 3/2/4 | 9 | New scripted-anim path in `js/modes/WalkMode.js` (mirror `startDisembark`/`startEmbark`). Triggered from `js/HUD.js:requestOpenMap` instead of the current 750 ms timeout — provider-callback pattern. Astronaut translates +Y up the lander side over ~1.5 s, then map opens; reverse on close. |
| 10 | **Mission / story progression layer** | 4/4/1 | 9 | Big design + new module `js/Story.js`. Ties together objectives, mission-control messages, math challenges. Probably best to scope after items 1–5 land so the substrate is real. |
| 11 | **Return 3D → 2D with carry-summary beat** | 3/2/4 | 9 | `js/Main.js:cinematicSwap` onComplete already runs after walk→lander; insert a brief `setCenterMessage()` showing what was stowed (read from a snapshot taken right before `WalkMode.startEmbark`). Or add a small "STOWED THIS TRIP" panel in `js/modes/TransitionMode.js` rendered during the fade. |
| 12 | **Alien that steals carried items** | 4/2/2 | 8 | New `js/modes/walk/Alien.js` module with build/update/dispose. Spawns under conditions (level >= N OR random chance per session). Wander toward astronaut; if within steal radius, removes one entry from `GameState.carrying`, plays comms blip, fades out. Needs a model (procedural cone+sphere fallback) and possibly a hiss audio. Also: tie into `GameState.flags.alienVisited` for an achievement. |
| 13 | **Music loop (gameplay ambience)** | 3/1/4 | 8 | Add `moonlander/audio/music.mp3`. Extend `js/Sound.js`: `Sounds.music`, looped, started on first user gesture. Lower default volume (0.3). Toggle via existing settings menu (could add a separate music slider). |
| 14 | **Persist carry across runs** | 2/1/5 | 8 | One-line change: in `js/GameState.js:startNewRun()` keep `GameState.carrying` instead of resetting (or reset to `[]` only on `commitRunToHighScores()`). Decide based on intended difficulty — leaving carry might be too generous. |
| 15 | **Crater detail texture** | 2/1/5 | 8 | Drop `moonlander/textures/crater.png`. In `js/modes/WalkMode.js:buildCraters()` swap `MeshBasicMaterial({color: 0x3a3a42, transparent, opacity})` to use the texture's alpha. |
| 16 | **Loading-screen art** | 2/1/5 | 8 | Add `<img>` inside `#preload .preload-inner` in `index.html`, sourced from a new `moonlander/textures/preload.png` (or reuse `lander.png`). CSS in `moonlander/css/main.css` for size + animation (gentle rotate). |
| 17 | **Retro pixel font** | 2/1/5 | 8 | `<link>` to Google Fonts (Press Start 2P / VT323 / Major Mono) in `index.html`. Update `body { font-family: ... }` + the HUD-specific stacks in `moonlander/css/main.css`. Confirm letter-spacing still reads. |
| 18 | **Achievement icons** | 2/1/4 | 7 | Six 32×32 PNGs at `moonlander/textures/achievements/<id>.png`. Update `js/HUD.js:runToastQueue()` to add an `<img>` next to `.toast-title` keyed by `def.id`. |
| 19 | **Game logo / wordmark** | 2/1/4 | 7 | Replace text in `index.html` `#main-menu h1` with `<img src="link-images/space-racer-logo.svg">`. Add SVG. Update `#preload-title` similarly if you want consistency. |
| 20 | **Walk-mode skybox panorama** | 3/1/3 | 7 | Add equirectangular `moonlander/textures/sky.jpg` (~2048×1024). In `js/modes/WalkMode.js:enter()` after `scene.background = new THREE.Color(...)` swap to a CubeTexture or equirect texture. Consider Earth visible in the sky. |
| 21 | **Earth-in-sky textured sphere** | 2/1/4 | 7 | Subset of #20 — if a full skybox is too heavy, just add a `SphereGeometry(60)` with `moonlander/textures/earth.jpg` mapped, positioned far away. Add to walk scene. |
| 22 | **Tutorial / onboarding refresh** | 3/1/3 | 7 | The first-time walk card already exists (`#walk-tutorial`). Add a similar one-time card for lander mode pointing at the new HULL gauge / fuel-drum sprites / X-pad multipliers. New flag in `GameState.flags`. |
| 23 | **Per-Apollo terrain STLs** | 3/1/2 | 6 | Asset blocker — need 5 more height-map STLs from NASA Resources at `moonlander/assets/nasa_models/Apollo XX - Landing Site.stl`. Code in `js/modes/WalkMode.js:buildGround()` already loads + tiles; extend `MODEL_PATHS` to be per-level via `apolloSiteForLevel`. |
| 24 | **Astronaut suit customization** | 2/1/3 | 6 | Settings menu adds a color picker. New `GameState.settings.suitColor` (persists). In `js/modes/WalkMode.js:buildAstronaut()` apply tint to `suitMat.color`. For the GLB, traverse meshes and tint named materials. |
| 25 | **Google login + cloud save** | 3/2/1 | 6 | Big lift. Add Google Identity Services `<script>` in `index.html`. New `js/CloudSave.js` for OAuth flow + token mgmt. Backend: cheapest is Firebase Realtime DB or Cloud Firestore (free tier) keyed by Google user id. Sync hook in `js/GameState.js:save/load`. Sign-in button in main menu. Defer until cross-device or social features become priority. |
| 26 | **Mercury Spacesuit rigging** | 2/1/1 | 4 | Out of code scope — Blender pass to add skeleton + skin weights, then re-export GLB. Once rigged, replace the procedural bob in `js/modes/WalkMode.js:updateWalkAnim()` with a `THREE.AnimationMixer` clip. |

## What shipped since Revision 1 was written

Cross-walk against the original Rev 1 shopping list — items that have
landed are checked off inline below. Quick summary:

- **Tier 1 #1 Astronaut GLTF** ✅ — Mercury Spacesuit GLB integrated in PR #79 (static; rigging deferred — see Rev 2 #26).
- **Tier 1 #2 Lander 3D model** ✅ — Apollo Lunar Module GLB integrated in PR #79.
- **Tier 1 #3 Higher-res `lander.png`** ⏳ — still placeholder; Rev 2 #8.
- **Tier 1 #4 Real audio** ⏳ — still synth WAVs; Rev 2 #4.
- **Tier 2 #5 Moon ground texture** ◑ — partially covered by Apollo 11 STL terrain tiles in PR #79; tileable regolith JPG still pending.
- **Tier 2 #6 Particle texture** ⏳ — Rev 2 #7.
- **Tier 2 #7 Skybox panorama** ⏳ — Rev 2 #20.
- **Tier 2 #8 Game logo** ⏳ — Rev 2 #19.
- **Tier 3 #9 Crater texture** ⏳ — Rev 2 #15.
- **Tier 3 #10 Achievement icons** ⏳ — Rev 2 #18.
- **Tier 3 #11 Music** ⏳ — Rev 2 #13.
- **Tier 3 #12 Retro font** ⏳ — Rev 2 #17.
- **Tier 3 #13 Earth-in-sky** ⏳ — Rev 2 #21.
- **Tier 3 #14 Loading-screen art** ⏳ — Rev 2 #16.

Plus from later PRs that aren't on this list but were shipped:
satellite map, ladder-gate, fixed-loot level 1, mobile swipe-look,
mobile E-button removal, lander HP, carry-and-deposit, repair parts,
Apollo 12 entry — see PRs #76 / #78 / #80 / #81.

---

# Revision 1 — original shopping list + NASA-3D integration plan

> Preserved verbatim below. Items that have shipped are marked inline
> with ✅; partially-shipped with ◑; still-pending with no marker (and
> tracked under Revision 2 above).

## Original shopping list ("Space Racer — asset shopping list")

## Context

You asked: *"Do I need to go make images for the load page, for background,
for icons? or go get images of the lunar surface? or supply 3D objects or
2D objects for the game to enhance it? Please provide a list."*

The game currently runs on a mix of **one real PNG** (the pixel-art lander I
generated with Python `zlib`), **five synthesized WAV stubs**, **two SVG card
images**, and **a lot of procedural geometry built from THREE primitives**
(astronaut limbs, ground heightmap, crater rings, particle quads, starfield).
It plays end-to-end, but every "asset" is a placeholder. Real art would lift
it from "skeleton with logic" to "a game you'd actually screenshot."

The Three.js import map is already wired for `GLTFLoader`
(`three/addons/loaders/GLTFLoader.js`), so any `.gltf` / `.glb` you drop in
`moonlander/models/` is one `loader.load()` call away from rendering.

---

## What's already in the repo

| Slot | Current file | What it is |
|---|---|---|
| Lander sprite | `moonlander/textures/lander.png` (699 B, 128×128) | Pixel-art, generated by my Python script. **Functional but tiny / coarse.** |
| Site card art | `link-images/moonlander.svg` (3.3 KB) | Hand-drawn SVG — fine for the launcher. |
| Rocket loop | `moonlander/audio/rocket.wav` (44 KB) | Synthesized noise + low rumble. Sounds like "noise + low rumble." |
| Crash | `moonlander/audio/crash.wav` (39 KB) | Synthesized noise burst. |
| Low-fuel beep | `moonlander/audio/alarm.wav` (16 KB) | Synthesized 880 Hz sine bell. |
| Comms blip | `moonlander/audio/morse.wav` (68 KB) | Synthesized morse pattern. |
| Wind ambience | `moonlander/audio/wind.wav` (130 KB) | Synthesized LPF noise. |

`moonlander/models/` is **empty** apart from a `1.txt` placeholder.

---

## Recommended pickups, prioritized

### Tier 1 — biggest visible impact (do these first)

1. **Astronaut GLTF** (with walk-cycle animation) ✅ shipped (PR #79, static — rigging deferred to Rev 2 #26)
   - Currently: helmet + box torso + cylinder arms/legs in `js/modes/WalkMode.js:buildAstronaut()`
   - Source the guide already names: **Kenney Space Kit** (CC0, free) — https://kenney.nl/assets/space-kit
   - Drop in `moonlander/models/astronaut.glb`; load with `GLTFLoader`,
     hand the clip to a `THREE.AnimationMixer` driven by `walkPhase`.
   - Target file size: < 1 MB.

2. **Lander 3D model (.glb)** for the **walk-mode parked lander** ✅ shipped (PR #79)
   - Currently: a flat PNG sprite billboarded in 3D, which reads as cardboard.
   - Same Kenney Space Kit has a lunar lander; or model your own.
   - Drop in `moonlander/models/lander.glb`; replace the
     `THREE.Sprite` in `js/modes/WalkMode.js:buildParkedLander()`.

3. **Higher-res `lander.png`** for the 2D LanderMode side view ⏳ still pending (Rev 2 #8)
   - Currently: 128×128 generated pixel art, looks blurry when zoomed.
   - Want: 256×256 (or 512×512) PNG, transparent background, classic
     four-legged lunar lander. AI image gen is fine; the guide says so.
   - Same path: `moonlander/textures/lander.png` (just overwrites the placeholder).

4. **Real audio** (WAV or MP3) — replace the 5 synthesized files ⏳ still pending (Rev 2 #4)
   - Best free source: **freesound.org** (filter to CC0 / Attribution).
   - Files (keep these exact names — `js/Sound.js` reads them):
     - `audio/rocket.wav` — looped rocket / engine hum, 1–3 s loop
     - `audio/crash.wav`  — short impact / explosion, ~1 s
     - `audio/alarm.wav`  — short alarm beep, ~0.3 s
     - `audio/morse.wav`  — short morse / radio chatter, ~1.5 s
     - `audio/wind.wav`   — looped low rumble, 3–5 s loop
   - MP3 also works — change extensions in `js/Sound.js:initSound()`.

### Tier 2 — solid polish

5. **Moon ground texture** (tileable regolith) ◑ partially shipped (Apollo 11 height-map STL tiled in PR #79; tileable regolith JPG still pending)
   - Currently: flat gray Lambert material on a sin-displaced plane.
   - Want: a square seamless regolith / lunar-surface texture, ~1024².
   - Sources: **NASA Lunar Reconnaissance Orbiter** imagery (public
     domain), or **OpenGameArt.org** (filter to CC0).
   - Drop at `moonlander/textures/regolith.jpg`; map it with
     `THREE.MeshLambertMaterial({ map: tex })` in `WalkMode.js:buildGround()`.

6. **Particle texture** (soft glow / smoke puff) ⏳ Rev 2 #7
   - Currently: solid colored quads with additive blending.
   - Want: a 64×64 PNG of a soft white blob with alpha falloff.
   - Big visual upgrade for the thruster cone and crash explosion.
   - Drop at `moonlander/textures/particle.png`; `js/Particles.js` swaps
     `MeshBasicMaterial({color, …})` → `MeshBasicMaterial({map: tex, …})`.

7. **Skybox / starfield panorama** for walk mode ⏳ Rev 2 #20
   - Currently: solid `0x0a0a1a` color + nothing in the sky.
   - Want: a moon-sky panorama (Earth visible in the distance is iconic).
   - Two formats both work: a single equirectangular image
     (`moonlander/textures/sky.jpg`, ~2048×1024) used as
     `scene.background = new THREE.Texture(...)`, OR a 6-image cubemap.
   - Sources: **NASA Image Library** (public domain), Three.js example skies.

8. **Game logo / wordmark** ⏳ Rev 2 #19
   - Currently: the menu shows the literal word `SPACE RACER` in CSS.
   - Want: a custom logo SVG or PNG. Even a stylized wordmark with a
     small lander icon would lift the menu screen.
   - Used in: `index.html` (`#main-menu h1`) and `link-images/moonlander.svg`
     (the site card — already custom; could be richer).

### Tier 3 — nice-to-have, not blocking

9. **Crater detail texture** for the ring decals ⏳ Rev 2 #15
   - Currently: bare `RingGeometry` with a translucent dark material.
   - Want: a circular crater texture (radial shading, slight rim) — turns
     each ring into a believable depression.
   - Drop at `moonlander/textures/crater.png`; bind to `MeshBasicMaterial`
     in `js/modes/WalkMode.js:buildCraters()`.

10. **Achievement icons** (one tiny PNG per achievement) ⏳ Rev 2 #18
    - Currently: text-only toast.
    - Six icons (~32×32 each) for: first-landing, perfect-landing,
      hot-swap, sample-collector, probe-rescuer, marathon.
    - Drop at `moonlander/textures/achievements/<id>.png`; HUD toast
      adds an `<img>` slot.

11. **Music** (an ambient gameplay loop, optional) ⏳ Rev 2 #13
    - Not specified in the guide. A 1–2 minute looped ambient track
      (synthwave / chiptune / minimal electronic) would complete the
      atmosphere. Sources: **freemusicarchive.org**, **incompetech.com**.

12. **Retro pixel font** ⏳ Rev 2 #17
    - Currently: Courier New (browser default monospace).
    - On-theme options (all free): **Press Start 2P**, **VT323**,
      **Major Mono Display**. Add via `<link>` to Google Fonts in
      `index.html`, switch CSS `font-family` in `css/main.css`.

13. **Earth-in-sky model** ⏳ Rev 2 #21
    - A textured sphere visible from the walk scene. Public-domain
      Earth maps from NASA (Visible Earth / Blue Marble).
    - Drop at `moonlander/textures/earth.jpg`; add a `SphereGeometry`
      to `WalkMode.js:enter()`.

14. **Loading screen art** ⏳ Rev 2 #16
    - Currently: pure text + a yellow progress bar.
    - A small pixel-art moon or lander above the bar would dress it
      up. Could be the same `lander.png` with a CSS animation.

---

## Things you almost certainly **don't** need to make

- Multiplier label sprites (`X2` / `X5`) — generated at runtime via canvas.
- Particle pool quads — code-driven; just gets a texture upgrade if you do (6).
- HUD layout art — pure CSS.
- Letterbox bars / fade overlay — pure CSS.

---

## Quick "check what you have first" list

Before sourcing anything new, see if you already have files for:

1. Any **lunar-surface JPG** (NASA images you've saved before, satellite
   imagery, even moon stock photos) — could become the regolith texture.
2. Any **astronaut / lunar lander 3D models** in your library — `.glb`,
   `.gltf`, `.fbx`, `.obj` all have free conversion paths to `.glb`.
3. **Royalty-free sound libraries** you already own — freesound packs,
   game-jam SFX bundles.
4. Any **starfield / nebula photos** — even a single panorama works as a
   skybox source after a quick re-projection.
5. **Old game-jam fonts** — many are CC0 and look great here.

---

## Recommended source map (all free / CC0 unless noted)

| Asset type | Best source |
|---|---|
| 3D models (astronaut, lander, props) | https://kenney.nl/assets/space-kit (CC0) |
| Lunar surface imagery | https://images.nasa.gov (public domain) |
| Tileable textures | https://opengameart.org (filter CC0) · https://polyhaven.com (CC0) |
| SFX | https://freesound.org (filter to CC0 / Attribution) |
| Music loops | https://freemusicarchive.org · https://incompetech.com (CC-BY) |
| Fonts | https://fonts.google.com (Open Font License) |

---

## NASA 3D Resources integration plan (shipped in PR #79) ✅

## Context

You added (or are about to push) NASA 3D Resources models under
`moonlander/assets/nasa_models/`:

- **Apollo Lunar Module.glb** — replaces the parked-lander sprite in walk mode
- **Apollo 11 - Landing Site.stl** — height-mapped block; top surface used
  as ground; tiled to expand exploration area
- **Atlas 6 (Friendship 7).glb** — Mercury rocket landmark
- **Habitat Demonstration*.glb** — two habitats placed side-by-side
- **Mercury Spacesuit.glb** — alternative astronaut, **not rigged**

**Source:** https://github.com/nasa/NASA-3D-Resources/tree/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models

The verified facts that drive the plan:

- The folder is **not yet on `main`**; the code I write must be safe with
  files absent (graceful fallback to current procedural primitives).
- Three.js importmap (`index.html` lines 18–19) already maps
  `three/addons/`, so `GLTFLoader` and `STLLoader` are one import away.
- `AssetCache.js` already gives us a session-lifetime cache pattern (Map
  by URL, never disposed) that I can mirror for models.
- `Device.LOW_END` and `Quality.getQualityFactor()` already gate heavy
  loads — the model-load path will hook into both.
- The Mercury Spacesuit GLB is **not rigged**. Adding a skeleton + skin
  weights is a Blender task, not a runtime operation. Plan does not try
  to rig at runtime; instead applies a procedural "bob + sway" while
  walking (translate.y / rotation.z driven by `walkPhase`). Documented
  in README so it's clear that proper limb animation needs Blender.

## Approach

### 1. New `js/ModelCache.js` — async GLB/STL loader with fallback

Mirrors `AssetCache.js`. Single Map keyed by URL; one shared loader per
type. Public API:

```js
loadModel(url)        // → Promise<THREE.Object3D>  (clones a cached prototype)
loadSTL(url, opts)    // → Promise<THREE.BufferGeometry>
```

On 404 / parse errors the promise rejects; callers catch and fall back
to their primitive build. On `Device.LOW_END` we **skip the load** and
go straight to the fallback — no GPU spike on Chromebooks.

### 2. Apollo Lunar Module replaces the parked-lander sprite
**File:** `js/modes/WalkMode.js` — `buildParkedLander()` (line ~660)

- `await loadModel('assets/nasa_models/Apollo Lunar Module.glb')`
- Compute `Box3.setFromObject(model)`, translate so the model's bbox
  bottom == `groundHeight(0, 0)` (no floating, no buried legs).
- Scale to ~`LANDER_SCALE * 0.6` of game units tall (legs taller than
  astronaut but not screen-filling).
- Same model is reused inside `buildApolloSite()` as the descent-stage
  silhouette (smaller scale).
- Fallback on missing file or LOW_END: keep the current
  `getSharedTexture('textures/lander.png')` sprite.

### 3. Apollo 11 terrain STL — "top surface" + tiling
**File:** `js/modes/WalkMode.js` — `buildGround()` (line ~456)

- `loadSTL('assets/nasa_models/Apollo 11 - Landing Site.stl')`
- The "thicker than needed" base is handled cheaply: position each tile
  so its bbox bottom is below `groundHeight` (e.g. y = -8); only the top
  surface pokes above the play surface, the box base sits below.
  No vertex-stripping needed — invisible from astronaut height.
- Apply `MeshLambertMaterial({color: 0x8c8c90, flatShading: true})`,
  matching the current ground tone (STLs carry no UVs / texture).
- **Tile a 2×2 grid** of the same geometry centered on the play area;
  bump `WALK_PLAY_RADIUS` 180 → 320 so the tiled terrain has room. The
  procedural sin-displaced plane stays as the **base** so anywhere the
  STL doesn't cover (corners, between tiles) still looks like ground.
- `groundHeight(x, z)` keeps using the sin-sum formula — astronaut +
  footprints + tracks all stay on the procedural surface, the STL is
  pure visual cladding. Avoids re-implementing height sampling against
  arbitrary STL geometry.

### 4. Mercury Spacesuit replaces the procedural astronaut (with bob)
**File:** `js/modes/WalkMode.js` — `buildAstronaut()` (line ~557)

- `loadModel('assets/nasa_models/Mercury Spacesuit.glb')`
- Compute bbox, scale uniformly to ~3 game units tall (slightly taller
  than the current procedural humanoid so it reads from chase-cam).
- Translate so bbox bottom sits at the parent group's origin (matches
  how the current procedural astronaut spans 0..~4).
- **No rigging.** `updateWalkAnim(dt, moving)` switches behavior:
  - If `astronautParts` exists (current procedural model) → swing limbs
    as today.
  - If `astronautModel` is set (the GLB) → drive a procedural BOB:
    `model.position.y = sin(walkPhase) * 0.12` plus
    `model.rotation.z = sin(walkPhase * 2) * 0.04` — a subtle bounce +
    sway that reads as motion without claiming to be limb animation.
- Fallback: missing file or LOW_END keeps the procedural humanoid.

### 5. Habitats and Atlas 6 — new landmark interactables
**Files:** `js/modes/WalkMode.js` (new builders), `js/Constants.js`
(positions + scoring)

- New `LANDMARKS` array in Constants:
  ```
  {id, kind: 'habitat'|'atlas'|'apollo', model, walkPos, score, comms}
  ```
- Two habitats placed at `(-25, 60)` and `(-12, 60)` (side-by-side, same
  Z so they read as a paired complex).
- Atlas 6 at `(80, 80)` standing vertical (rocket pose).
- Each spawns via a new `buildLandmark(spec)` that wraps `loadModel()` +
  bbox-bottom-at-ground + interactable wiring (uses the existing
  `pickClosestInteractable` flow).
- Apollo 11 site already exists; it is upgraded to use the loaded
  Lunar Module GLB for its descent-stage silhouette but keeps its flag
  + plaque.

### 6. README — NASA 3D Resources credit
**File:** `moonlander/README.md` — Credits section

Append:
```
- 3D models in moonlander/assets/nasa_models/ are from NASA's
  3D Resources catalog:
  https://github.com/nasa/NASA-3D-Resources/tree/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models
  Public-domain works of the U.S. Government per 17 U.S.C. § 105.
- Mercury Spacesuit GLB ships unrigged; limb animation requires
  manual rigging in Blender (out of repo scope).
```

## Memory + Chromebook safety

- `ModelCache` returns clones from a single decoded prototype, so 4
  terrain tiles cost one geometry upload, not four.
- All loads gated behind `Device.LOW_END`: low-end devices keep the
  procedural primitives, no GLB/STL upload at all.
- Console-warn on any model file > 5 MB so we notice oversized assets.
- Every callsite is `loadModel(...).then(use).catch(useFallback)` so a
  missing file is identical to a low-end fallback path — no broken
  scenes, no "click to retry" UI needed.

## Files modified

| File | Change |
|---|---|
| `js/ModelCache.js` (new, ~80 lines) | GLB + STL async loaders with cache + LOW_END skip |
| `js/Constants.js` | `MODEL_PATHS`, `LANDMARKS`, bumped `WALK_PLAY_RADIUS` |
| `js/modes/WalkMode.js` | `buildAstronaut`, `buildParkedLander`, `buildGround`, `buildApolloSite`, new `buildLandmark`, animated bob in `updateWalkAnim` |
| `moonlander/README.md` | NASA 3D Resources credit + rigging note |

No changes to LanderMode, GameState, HUD, Sound, particles, or the
existing AssetCache. The 2D lander still uses `lander.png` — only the
walk-mode 3D world consumes the GLBs.

## Open question

**Mercury Spacesuit rigging.** I cannot rig a static GLB at runtime in
any way that produces real bone-driven limb deformation. The plan uses
a procedural bob + sway. If you want true walking-limb animation, the
only paths are:
1. Rig it in Blender (add bones + skin weights), re-export, drop it back
   in `assets/nasa_models/`.
2. Use a different already-rigged spacesuit (Kenney Space Kit has one,
   CC0).

I'll proceed with the bob approach and note the limitation in the
README. Tell me if you'd rather hold off on the spacesuit swap until
the rig exists.

## Verification

Once the plan is implemented and the assets are pushed:

- [ ] `console` shows `[ModelCache] loaded Apollo Lunar Module.glb (… KB)` etc.
- [ ] Apollo Lunar Module visible at the parked-lander spot, legs sit on ground.
- [ ] Apollo 11 terrain STL visible underfoot when astronaut walks across the play area; tiled corners line up reasonably.
- [ ] Habitats render side-by-side; tap-to-interact (mobile) or `E` (desktop) gives a comms blip + score.
- [ ] Atlas 6 stands vertical, tap-to-interact works.
- [ ] Mercury Spacesuit renders, bobs while moving, stays still while idle.
- [ ] Disable network for `assets/nasa_models/*` (or use a low-end UA) → game still runs with procedural fallbacks; no console errors.
- [ ] Memory pre/post in DevTools shows < 50 MB increase on a phone.
- [ ] coolstemgames.com README lists the NASA 3D Resources URL.

---

## How to give them to me

When you've gathered files, drop them at the paths listed above and tell me
which slots are filled. I'll:
1. Wire each asset in (load via `GLTFLoader` / `TextureLoader` / `Audio`).
2. Adjust scales / offsets so models sit on the ground correctly.
3. Update `js/Preload.js` so the new files load behind the progress bar.
4. Push the changes to a follow-up PR.

If you want, I can also cut a single follow-up PR that **just** wires up
Kenney's Space Kit astronaut + a single moon ground texture — those two
alone would be the biggest visible jump.

---

## Verification (when assets land)

For each new asset, the manual check is:

- **3D model:** loads without console errors, casts roughly the right
  shadow / footprint, walk animation plays in WalkMode.
- **Texture:** appears in the right place, isn't blurry (NearestFilter for
  pixel art, LinearFilter for photo textures), respects transparency.
- **Audio:** plays at the right moment, doesn't pop at loop seams,
  master-volume slider in the settings menu still scales it.
- **Logo / fonts:** render before the preload bar finishes (fonts may
  need `font-display: swap`).
- **Preload progress bar:** total count goes up to include new files; bar
  doesn't get stuck on a missing asset.

Then sanity test the round trip on desktop + a touch device, the same way
PR #66's test plan describes.
