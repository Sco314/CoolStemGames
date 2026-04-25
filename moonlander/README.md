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
| Lander texture | ✅ | Pixel-art `textures/lander.png` (drop-in replacement supported) |
| 3D Walk mode | ✅ | Procedural astronaut OR NASA Mercury Spacesuit GLB, displaced moon ground OR tiled Apollo 11 STL, footprint trail (permanent), color-coded breadcrumb rings + beacon pillars to objectives |
| Mode transitions | ✅ | Letterbox + fade-through-black + audio crossfade, scripted disembark/embark |
| HUD | ✅ | Live telemetry with green/yellow/red color coding for V-SPEED / H-SPEED / ANGLE / FUEL |
| Main menu / game over | ✅ | High-score persistence (top 10) and 6 achievements |
| Settings | ✅ | Master volume, invert-Y, fullscreen, persisted in localStorage |
| Mobile | ✅ | Letterbox or full-viewport, touch joystick + thrust buttons, screen-swipe camera, **tap-on-canvas to interact** (no E button needed), top-right mute toggle, top-left satellite-map button |
| Satellite map | ✅ | Top-left button opens a top-down view; **gated behind lander proximity** with a "CLIMBING LADDER" comms beat. Off-lander taps surface "RETURN TO LANDER" |
| Lander HP | ✅ | New HULL gauge (color-coded). Crashes shave LANDER_CRASH_DAMAGE per impact; HP=0 wrecks the craft and ends the run alongside fuel-empty |
| Carry-and-deposit | ✅ | Fuel drums and repair parts are carried (HUD shows CARRY), then stowed at the lander with `E`/tap. Stow message reports `+FUEL · +HP` |
| Repair parts | ✅ | New `'part'` interactable spawned at the current Apollo site; +25 HP per part on stow |
| Apollo levels | ✅ | Walk scene shows Apollo 11 at level 0, Apollo 12 at level 1+. Registry is `APOLLO_SITES`; add 14/15/16/17 entries to extend |
| NASA 3D models | ✅ | Apollo Lunar Module, Mercury Spacesuit, Apollo 11 height-map terrain, Habitat Demonstration Unit (×2), Atlas 6 / Friendship 7 — all wired with procedural fallbacks for missing files / Chromebooks |
| Adaptive quality | ✅ | Particle pool scales by `Device.LOW_END`; FPS-driven fallback drops emit rate further if average FPS < 30 |
| Audio | ⚠️ | Synthesized .wav placeholders; drop in real .mp3s and update paths in `js/Sound.js` |

## Roadmap — what's pending

Things explicitly deferred to a follow-up PR:

- **Astronaut HP + health packs.** Separate pool from lander HP. Walk
  mode currently has no damage source for the astronaut, so the pool
  isn't introduced until a damage source (falls / suit punctures /
  habitat heals) lands.
- **Apollo 14 / 15 / 16 / 17 sites.** The registry is in place; new
  entries in `APOLLO_SITES` immediately rotate by level. Apollo 11 is
  level 0, Apollo 12 is level 1+; 14–17 just need their `walkPos` +
  artifact data filled in (and ideally height-map STLs added to
  `assets/nasa_models/`).
- **Per-Apollo terrain.** All levels currently share the Apollo 11
  height-map STL tiles. Each Apollo destination should swap to its
  own STL once the asset files arrive.
- **Ladder-climb 3D animation.** The map gate is currently a comms
  beat ("CLIMBING LADDER…") + 750 ms delay. A scripted up-the-ladder
  motion of the astronaut model would sell the moment.
- **Mercury Spacesuit rigging.** GLB ships unrigged so we drive a
  procedural bob+sway in `updateWalkAnim`. Real walking-limb animation
  needs a Blender pass to add a skeleton + skin weights.
- **Real audio.** All five WAVs are synthesized placeholders.

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
| `js/HUD.js` | DOM HUD, comms blips, achievement toasts, and every overlay |
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
