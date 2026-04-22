# Moonlander Skeleton (2D ↔ 3D)

A starting point for a lunar-lander game that transitions between a 2D-style
side-view lander sequence and a 3D third-person walk sequence, **all in
Three.js**. Architecture is inspired by [tblazevic/moonlander](https://github.com/tblazevic/moonlander)'s
module layout, but everything here was written from scratch (no copied code)
so there is no license taint.

## What's here

| File | Role |
|------|------|
| `index.html` | Boot page. Loads Three.js via importmap, sets up the DOM HUD. |
| `css/main.css` | Minimal retro HUD styling (Courier New, white-on-black). |
| `js/Constants.js` | All tunables. Physics, cameras, transition timing, mode IDs. |
| `js/GameState.js` | The shared **store** — fuel, score, landing position. Survives mode switches. Has save/load. |
| `js/TerrainData.js` | Terrain polyline (ported point data from tblazevic). |
| `js/Input.js` | Central keyboard state with edge detection. |
| `js/Sound.js` | Audio wrapper with no-op fallback if files are missing. |
| `js/HUD.js` | DOM-based HUD (no second Three.js scene needed). |
| `js/Particles.js` | **Stub** — class shapes match tblazevic for future port. |
| `js/modes/ModeInterface.js` | Docs only. The contract every mode implements. |
| `js/modes/LanderMode.js` | 2D-style side view, orthographic camera, jerk-based thrust physics. |
| `js/modes/WalkMode.js` | 3D third-person, `PointerLockControls` for mouse look. |
| `js/modes/TransitionMode.js` | Cinematic camera lerp between the two modes. |
| `js/Main.js` | Renderer, frame loop, mode switcher. |

## How the 2D ↔ 3D switch works

1. **One renderer, one canvas.** The `WebGLRenderer` is created once in `Main.js`
   and lives for the whole session. No dispose/recreate on mode change.
2. **Each mode owns its own scene and camera.** LanderMode builds an orthographic
   camera + line-based terrain. WalkMode builds a perspective camera + ground
   plane + astronaut.
3. **Mode swap = `exit()` + `enter()`.** `exit()` disposes every geometry and
   material the mode created (the memory-discipline checkpoint). The next
   mode's `enter()` builds fresh assets.
4. **Transition is its own mode.** When the lander touches down, Main.js enters
   `TransitionMode`, which animates the camera from lander-ortho pose to
   walk-perspective pose, then hands off. This is where polish (letterbox,
   DOF, crossfade) will go.
5. **GameState is the handoff.** When the lander lands, `LanderMode` writes
   `GameState.lastLanding.x` etc. When the astronaut loads fuel,
   `WalkMode` writes `GameState.fuel.current`. Neither mode talks to the
   other directly — they talk through `GameState`.

## What currently works

- Boots, renders, shows the HUD.
- LanderMode: gravity, jerk-based thrust, rotation, drag, fuel burn, naive
  terrain collision (single-circle against segment top), crash/land resolution.
- Cinematic-ish transition to WalkMode after a successful landing.
- WalkMode: tank-style WASD astronaut, mouse look, fuel cart interaction
  adds fuel to `GameState`, "press E to board" returns to LanderMode.
- Memory: each mode disposes its assets on `exit()`.

## What's stubbed (deliberate — fill these in next)

- **3-circle collision** in LanderMode. Currently a single point-vs-segment
  test. The tblazevic approach (1 big circle + 2 foot circles) is the pattern
  to reimplement.
- **Particle systems**. `Particles.js` has class stubs matching the shape of
  tblazevic's `ParticleSystemCone` / `ParticleSystemExplosion`.
- **Textures and models**. Lander is a gray quad; astronaut is a capsule;
  ground is flat. Drop `textures/lander.png` and GLTF models and wire them up.
- **Score multipliers on flat pads**. Data structure is there (segment slope
  is recorded); random multiplier assignment and HUD labels need to be added.
- **Audio files**. Sound.js expects `audio/crash.mp3`, `audio/rocket.mp3`,
  `audio/alarm.mp3`, `audio/morse.mp3`. Missing files log a warning and no-op.
- **Game-over / restart flow**. Fuel-exhaustion end state is not yet wired.

## Running it

It's pure static files, but module scripts need to be served over HTTP, not
opened via `file://`. From the project root:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

## Controls

**Lander mode:** ↑ thrust · ← → rotate

**Walk mode:** click to lock mouse · W/S move · A/D turn · mouse look · E interact

## Where to add things

- New tunable? `Constants.js`.
- New persistent fact about the player/session? `GameState.js`.
- New HUD element? `index.html` + `HUD.js` (keep it DOM, not canvas).
- New mode (e.g., `CockpitMode`, `MapMode`)? Copy `LanderMode.js` as a
  template, implement `enter/exit/update/render/getCamera/getScene`, then
  swap into it via `goToMode()` or `cinematicSwap()` in `Main.js`.

## Design decisions worth calling out

- **Importmap over bundler.** Keeps the project zero-build and lets you copy
  addon code from the Three.js examples without rewriting paths. Swap in
  Vite or esbuild later if you want tree-shaking.
- **DOM HUD, not canvas-texture HUD.** tblazevic's approach of a second
  Three.js scene with a canvas texture is clever but pays render cost every
  frame. DOM is free, styleable with CSS, and survives mode switches untouched.
- **Modes are objects, not classes.** There's only ever one of each, so a
  module-level singleton object is simpler than `new LanderMode()`.
- **Ortho→perspective is a midpoint swap, not a matrix morph.** Genuinely
  interpolating an ortho projection into a perspective one would require
  custom shader work; a midpoint handoff reads fine and is one line of code.
