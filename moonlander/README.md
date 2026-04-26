# Space Racer (2D ↔ 3D)

A lunar-lander game that transitions between a 2D-style side-view landing
sequence and a 3D third-person walk sequence on the moon surface, **all in
Three.js with zero build step**. Import maps pull Three directly from unpkg;
the rest is plain ES modules.

Live URL: https://coolstemgames.com/moonlander/ (the folder name is kept as
`moonlander/` to avoid breaking existing links and cache; the player-facing
name is Space Racer).

## Current state — what's done

| Area | Done? | Notes |
|---|---|---|
| 2D Lander mode | ✅ | 3-circle collision, foot/edge tolerances, X2/X3/X5 bonus pads, beginner pads with fuel-drum sprites |
| Collision feedback | ✅ | Velocity-scaled crash explosion + camera shake, dust puff at each foot on soft landing, glancing-scrape sparks (mostly tangential body hits bounce + nick HP instead of ending the run) |
| Lander texture | ✅ | 256×256 pixel-art `textures/lander.png` (foiled descent stage, ascent cabin with triangular window, four splayed legs, foot pads) |
| 3D Walk mode | ✅ | Procedural astronaut OR NASA Mercury Spacesuit GLB, displaced moon ground OR tiled Apollo 11 STL, footprint trail (permanent), color-coded breadcrumb rings + beacon pillars to objectives |
| Mode transitions | ✅ | Letterbox + fade-through-black + audio crossfade, scripted disembark/embark |
| HUD | ✅ | Live telemetry with green/yellow/red color coding for V-SPEED / H-SPEED / ANGLE / FUEL |
| Main menu / game over | ✅ | High-score persistence (top 10) and 6 achievements |
| Settings | ✅ | Master volume, invert-Y, fullscreen, persisted in localStorage |
| Mobile | ✅ | Letterbox or full-viewport, touch joystick + thrust buttons, screen-swipe camera, **tap-on-canvas to interact** (no E button needed), top-right mute toggle, top-left satellite-map button. **iOS Safari URL-bar resize handled via `visualViewport`** so the canvas tracks every URL-bar dismiss / orientation change |
| Satellite map | ✅ | Top-left button opens a top-down view; **gated behind lander proximity** with a "CLIMBING LADDER" comms beat. Off-lander taps surface "RETURN TO LANDER" |
| Lander HP | ✅ | New HULL gauge (color-coded). Crashes shave LANDER_CRASH_DAMAGE per impact; HP=0 wrecks the craft and ends the run alongside fuel-empty |
| Astronaut HP | ✅ | New HEALTH gauge (color-coded). Health-pack pickups at Apollo sites and habitat heals top up `GameState.astronaut.hp` |
| Carry-and-deposit | ✅ | Fuel drums and repair parts are carried (HUD shows CARRY), then stowed at the lander with `E`/tap. Stow message reports `+FUEL · +HP`. **Pack persists across runs** — whatever you were holding when your last run ended carries forward into the next commander |
| Repair parts | ✅ | `'part'` interactable spawned at the current Apollo site; +25 HP per part on stow |
| Health packs | ✅ | `'healthpack'` interactable; +25 astronaut HP on touch |
| Apollo levels | ✅ | Apollo 11/12/14/15/16/17 all in `APOLLO_SITES`; level mods through the registry, so each run rotates the active destination |
| Per-level objectives | ✅ | `LEVEL_OBJECTIVES` (keyed by Apollo site id) merges with the career list — every destination has its own mini brief (visit, collect, stow, heal) |
| STEM math challenges | ✅ | Corner `STEM` button opens a modal with O₂/fuel/fall-speed/walk-time questions (`js/MathChallenge.js`); 3 attempts per session; `GameState.stats.mathSolved` persists |
| Mission Control messages | ✅ | `MISSION_MESSAGES` catalog in Constants; `HUD.showMissionMessage(key)` panel fades in on first landing, first Apollo, habitat reach, fuel/part stow, hull critical, low-fuel-return |
| Return-to-lander signposting | ✅ | Tall yellow beacon over the parked lander, "CARGO STOWED IN PACK — RETURN TO LANDER TO DEPOSIT" comms cadence when the astronaut wanders with items, low-fuel `lowFuelReturn` CAPCOM panel, synthetic "Return to the lander and board" objective always at the foot of the per-level brief |
| Story progression | ✅ | `js/Story.js` fires per-Apollo intro on `WalkMode.enter` and outro on the first successful landing of that level. One-time STEM nudge if the player hasn't tried any math challenges by their second walk. Beats gated by `GameState.flags` so each fires once per save |
| Carry-summary beat | ✅ | Walk→lander cinematic shows a `STOWED THIS TRIP` panel with the totals just stowed, snapshot from `GameState.lastStowed` and cleared on transition exit |
| Alien encounter | ✅ | Procedural critter (`js/modes/walk/Alien.js`) spawns at level ≥ 2 with a 45% per-session chance, drifts toward the astronaut, swipes one carried item on contact, then fades out. First encounter unlocks the `CLOSE ENCOUNTER` achievement |
| Music loop | ✅ | Optional `audio/music.mp3` looped via `Sounds.music`, started on first user gesture; settings overlay has a `MUSIC VOLUME` slider independent of master |
| Skybox + Earth | ✅ | Procedural `textures/starfield.png` (1024×512) wired as `scene.background` for walk mode + `textures/earth.png` mapped to a `SphereGeometry` placed in the south-west sky. Both skipped on `LOW_END` |
| Crater decals | ✅ | Procedural `textures/crater.png` (256×256, radial bowl + rim highlight + alpha falloff) mapped to plane decals in walk mode |
| Achievement icons | ✅ | Inline SVG glyph per achievement (no extra fetches); toast renders icon + title + description side-by-side |
| Ladder-climb animation | ✅ | Map button at the lander triggers `WalkMode.startLadderClimb` — astronaut translates +Y by 4.2 units over 1.4 s, then map opens; reverse on close |
| Tutorials | ✅ | First-time `#walk-tutorial` and `#lander-tutorial` cards. Each shown once per save, gated by `flags.walkTutorialSeen` / `flags.landerTutorialSeen` |
| Per-Apollo terrain | ◑ | Code path live: `buildGround` tries `assets/nasa_models/Apollo NN - Landing Site.stl` first, falls back to the bundled Apollo 11 STL. Drop additional NASA Resources STLs in to activate level-specific terrain |
| NASA 3D models | ✅ | Apollo Lunar Module, Mercury Spacesuit, Apollo 11 height-map terrain, Habitat Demonstration Unit part 1 (habitat-a) + part 2 (habitat-b), Atlas 6 / Friendship 7 — all wired with procedural fallbacks for missing files / Chromebooks |
| Particle texture | ✅ | Soft-glow `textures/particle.png` (64×64, smoothstep alpha) shared across cone + explosion materials; missing texture still renders as a colored quad |
| Adaptive quality | ✅ | Particle pool scales by `Device.LOW_END`; FPS-driven fallback drops emit rate further if average FPS < 30 |
| Audio | ◑ | `js/Sound.js` tries `.mp3` first, falls back to bundled synth `.wav`. Drop `audio/<name>.mp3` to upgrade quality with no code change |
| Retro pixel font | ✅ | VT323 (HUD) + Press Start 2P (headings + wordmark) loaded from Google Fonts; Courier monospace fallback |
| Game logo | ✅ | `link-images/space-racer-logo.svg` wordmark replaces the menu h1 text |
| Loading-screen art | ✅ | Animated lander sprite (3.2 s hover/rotate, respects `prefers-reduced-motion`) above the preload progress bar |

## Roadmap — what's pending

Tracked in detail in `docs/rev2plan.md`. Highlights still open:

- **Apollo 12/14/15/16/17 terrain STLs (asset gap).** Code path live —
  `buildGround` tries `assets/nasa_models/Apollo NN - Landing Site.stl`
  first and falls back to the bundled Apollo 11 STL. Drop the matching
  NASA Resources files in to activate per-level terrain.
- **Real audio MP3s (asset gap).** Code-side complete (`Sound.js` prefers
  `.mp3`, falls back to bundled synth `.wav`); waiting on freesound /
  CC0 audio drops at `audio/<name>.mp3`.
- **Music track (asset gap).** Music loop wired (`Sounds.music`,
  separate volume slider) — drop any `audio/music.mp3` to start it.
- **Mercury Spacesuit rigging (backlog).** GLB ships unrigged so we drive
  a procedural bob+sway in `updateWalkAnim`. Real walking-limb animation
  needs a Blender pass to add a skeleton + skin weights.
- **Suit customization, Google login + cloud save, persistent carry
  (backlog).** See `docs/rev2plan.md` for scoping notes.

## How to play

**Lander (2D side view)**

- `↑` thrust · `←` `→` rotate
- Touch down softly on any flat pad with both feet on the pad
- Bonus pads (`X2` / `X3` / `X5`) multiply the landing score
- Hitting terrain at speed, at an angle, or half-off a pad — that's a crash

**Walk (3D third-person)**

- Click the canvas to engage pointer lock
- Mouse turns the astronaut and orbits the camera pitch
- `W` `S` walk forward / back · `A` `D` strafe · `E` interact
- Pick up fuel drums, supply crates (repair kits), science samples; if you
  have a kit, repair the damaged probe for a big score
- Walk up to the parked lander and press `E` to return to lander mode

**Menus / global**

- `Esc` toggles the settings overlay (master volume, invert-Y, fullscreen)
- Tab/Enter navigates menu buttons
- Touch devices get on-screen controls automatically
- Top-left **STEM** button opens a math challenge (O₂, fuel, fall-speed,
  walk-time); 3 attempts per session

## Running locally

Static files, but module scripts need HTTP, not `file://`. From the game's
directory:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Architecture at a glance

| File | Role |
|------|------|
| `index.html` · `css/main.css` | Boot page, retro HUD, menu/overlay DOM |
| `js/Main.js` | Renderer, frame loop, mode switcher, error boundaries |
| `js/Constants.js` | Every tunable — physics, progression curves, achievements |
| `js/GameState.js` | Shared store (fuel, score, objectives, settings) with `startNewRun` / `commitRunToHighScores` / `unlockAchievement` |
| `js/Input.js` | Keyboard + synthetic-key injection for touch |
| `js/Touch.js` | Mobile buttons + joystick feeding the same Input queue |
| `js/Sound.js` | Audio wrapper with per-Sound `setVolume` and a global `setMasterVolume` |
| `js/HUD.js` | DOM HUD, comms blips, mission-control panel, achievement toasts, math overlay, and every overlay |
| `js/MathChallenge.js` | STEM question generators (O₂, fuel, fall-speed, walk-time) + answer validator |
| `js/Story.js` | Per-Apollo-site narrative beats (intro on WalkMode entry, outro on next landing) + STEM nudge |
| `js/modes/walk/Alien.js` | Optional roaming critter that swipes a carried item then fades out |
| `js/Particles.js` | Pooled thruster cone + crash explosion (quality-scaled) |
| `js/Progression.js` | Pure helpers that turn a `level` into effective values |
| `js/Quality.js` | Rolling-FPS adaptive quality (scales particles, toggles fog) |
| `js/Preload.js` | Asset prefetch with a progress bar |
| `js/TerrainData.js` | Lander-mode terrain polyline |
| `js/modes/LanderMode.js` | 2D ortho, 3-circle collision, scored landings |
| `js/modes/WalkMode.js` | 3D strict chase cam, displaced terrain, interactables |
| `js/modes/TransitionMode.js` | Cinematic ortho→perspective swap w/ letterbox, fade, crossfade |
| `js/modes/MainMenuMode.js` | Boot mode: starfield behind the main-menu overlay |
| `textures/lander.png` | Pixel-art lander sprite (generated) |
| `audio/*.wav` | Placeholder rocket / crash / alarm / morse / wind tracks |

## Design notes

- **One renderer, one canvas.** `WebGLRenderer` is created once in `Main.js`
  and lives for the whole session. Modes own their scene/camera and dispose
  on exit; the renderer is untouched.
- **DOM HUD, not canvas-texture HUD.** All menus, toasts, and the heads-up
  overlay are plain HTML. No second Three.js scene, no per-frame render
  cost, and it survives mode switches for free.
- **GameState is the handoff.** Modes never reference each other's meshes;
  they read/write shared facts (fuel, landing segment index, objectives).
- **Save is semantic.** `localStorage` key `moonlander.save.v3` — versioned
  in the key, shallow-merged on load so adding new state fields is additive.
- **Difficulty is data.** `Progression.js` takes `GameState.level` and
  returns effective gravity / tolerance / edge-margin / spawn-velocity /
  fuel-gain. LanderMode and WalkMode just ask.

## Memory budget + Chromebook safety

Space Racer is engineered for ~4 GB Chromebooks running Chrome's per-tab
memory budget. Key design choices that keep it light:

- **Single WebGLRenderer for the session.** No dispose/recreate on
  mode switches.
- **Per-mode `disposables` discipline.** Every geometry, material, and
  CanvasTexture allocated in a mode's `enter()` is pushed to a list and
  cleaned up in `exit()`. Round-tripping lander↔walk dozens of times
  doesn't grow heap monotonically.
- **`Device.LOW_END` profile.** Trips on Chromebook (CrOS UA), tight
  RAM (`navigator.deviceMemory ≤ 4`), low core count (≤ 4), or any
  touch device. When set:
  - Particle pools shrink ~65 % and emit rate further drops 45 %.
  - **All NASA model loads (`ModelCache`) are skipped** and the
    procedural fallbacks render instead — no GLB/STL upload.
  - Walk-mode fog disabled by `Quality.onQualityChange`.
- **Adaptive quality.** Rolling FPS sample over ~2 s; if average drops
  below 30, particle emit rate scales by 0.4 ×. If it recovers above
  55, full quality is restored.
- **Asset / model caches share textures and geometries.** The lander
  PNG is uploaded once (used by 2D + 3D); each Apollo 11 terrain tile
  shares one decoded geometry; cloned scene graphs share materials.
- **Footprint pool capped at 200** prints, ring-buffered by oldest.
  ~few hundred KB total.

To verify on a real device: open DevTools → Performance → Memory.
Round-trip lander → walk → lander 10 times. Heap should oscillate (GC
returns it to baseline after each cycle), not climb monotonically.

## Credits

- [Three.js](https://threejs.org/) (MIT) — loaded via importmap from unpkg.
- Architecture inspired by [tblazevic/moonlander](https://github.com/tblazevic/moonlander);
  no code copied — layout only.
- All placeholder textures and audio in `textures/` and `audio/` are
  generated from scratch by this project (pixel-art PNG written with
  stdlib zlib; WAVs synthesized with stdlib `struct`). Replace them with
  your own MP3s/PNGs any time — filenames live in `js/Sound.js` and
  `js/modes/LanderMode.js` / `js/modes/WalkMode.js`.
- 3D models in `assets/nasa_models/` come from NASA's public-domain
  3D Resources catalog:
  https://github.com/nasa/NASA-3D-Resources/tree/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models
  Public-domain works of the U.S. Government per 17 U.S.C. § 105.
  Used in walk mode for the parked Apollo Lunar Module, the Apollo 11
  Tranquility-Base height-map terrain, the Mercury Spacesuit astronaut,
  the Habitat Demonstration Unit landmarks, and the Atlas 6 / Friendship 7
  rocket. Each load is async with a procedural fallback so the game still
  runs offline or on low-end devices where the files are skipped.

  **Rigging note for the Mercury Spacesuit:** the GLB ships as a static
  mesh (no bones / skin weights), so `js/modes/WalkMode.js:updateWalkAnim`
  drives a procedural bob + sway in place of limb animation. Proper
  walking-limb motion would need a Blender pass to add a skeleton and
  paint vertex weights, then a re-export.

## License

This directory inherits the repo's top-level `LICENSE`. Third-party assets,
if any are added later, keep their own license — note them here.
