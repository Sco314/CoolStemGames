# Space Racer (2D ↔ 3D)

A lunar-lander game that transitions between a 2D-style side-view landing
sequence and a 3D third-person walk sequence on the moon surface, **all in
Three.js with zero build step**. Import maps pull Three directly from unpkg;
the rest is plain ES modules.

Live URL: https://coolstemgames.com/moonlander/ (the folder name is kept as
`moonlander/` to avoid breaking existing links and cache; the player-facing
name is Space Racer).

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
