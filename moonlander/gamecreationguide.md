# Moonlander Game Creation Guide

A phased roadmap for building the 2D↔3D lunar lander game on top of the
skeleton in this project. Each phase produces a playable build. No phase is
a rewrite of the previous one — every step is additive or a targeted fix.

**How to use this document:** work top to bottom. Don’t skip ahead. Each
phase lists its goal, the files touched, the work to do, and a “Definition
of Done” checklist. The DoD is the honest acceptance test — if any item
fails, the phase isn’t complete and the next phase’s assumptions will break.

-----

## Phase 0 — Get it running *(you are here if you’ve just unzipped)*

**Goal:** the skeleton boots in a browser, the HUD appears, a gray square
falls under gravity, and the mode switch to walk mode completes end-to-end
at least once.

**Files touched:** none — this is a validation phase.

**Work:**

1. Serve the project over HTTP (module scripts won’t run from `file://`):
   
   ```
   python3 -m http.server 8000
   ```
1. Open `http://localhost:8000` in a recent Chrome/Firefox/Safari.
1. Confirm the HUD shows SCORE/TIME/FUEL on the left and telemetry on the
   right, and the gray lander falls and responds to arrow keys.
1. Fly down, try to land softly on any flat segment. On a successful landing
   you should see “SUCCESSFULLY LANDED” in the center, then after ~1 second
   the scene transitions to the walk view (a capsule astronaut, a gray
   ground plane, an orange box = fuel cart, a white box = parked lander).
1. Click the canvas to engage mouse look. Walk to the orange box, press E.
   Fuel count should jump by 250 in the HUD.
1. Walk to the white box, press E. The scene should transition back to
   lander mode with the increased fuel already showing.

**Definition of Done:**

- [ ] Game loads without console errors
- [ ] Arrow keys move/rotate the lander and fuel burns while thrusting
- [ ] At least one end-to-end round-trip (land → walk → interact → return) works
- [ ] Closing and reopening the tab reloads cleanly (no save corruption)

**If it doesn’t work:** the console log tells you which module failed.
Ninety percent of the time it’s a path issue — check that `index.html`,
the `js/` folder, and the CSS are all present and the server is pointing
at the project root.

-----

## Phase 1 — Make the lander feel right (collision + lander visuals)

**Goal:** the lander is a recognizable craft with proper foot-collider
physics. The game feels fair: you crash when you *should* crash, you land
when you *should* land, and the feedback is clear.

**Files touched:** `js/modes/LanderMode.js`, `textures/` (new), `js/Constants.js`

**Work:**

1. **Port the 3-circle collision approximation.** Currently
   `LanderMode.checkCollisions()` does a naive single-point vs. segment
   test. Replace it with three circles: one main body circle at the
   lander’s center, and two small foot circles at the bottom corners. Each
   circle is tested against every segment. Keep the segment data structure
   as-is; just expand the collider side.
   
   The foot circles are children of the lander `Object3D`, so they rotate
   with the craft. Their *world* positions are what you test against
   segments. Getting a child’s world position:
   
   ```js
   const worldPos = new THREE.Vector3();
   footColliderLeft.getWorldPosition(worldPos);
   ```
1. **Add a “too close to edge” check.** The tblazevic rule is: if the
   lander’s x is within ~38% of the lander scale of either edge of the
   landing segment, crash with “TOO CLOSE TO EDGE OF TERRAIN.” This
   prevents half-on/half-off landings that look wrong.
1. **Add a real lander sprite.** Drop a `lander.png` into `textures/` (the
   tblazevic repo has one you can reference for style — draw your own, or
   ask an AI image generator for a 256×256 transparent-background classic
   four-legged lunar lander). Wire it into `LanderMode.buildLander()`:
   
   ```js
   const tex = new THREE.TextureLoader().load('textures/lander.png');
   tex.magFilter = THREE.NearestFilter;  // keep it crisp/retro
   const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
   ```
   
   Add the new texture and material to the `disposables` array so they get
   cleaned up on mode exit.
1. **Add score multipliers on flat pads.** When `buildTerrain()` runs, for
   each segment where `slope < 0.001`, roll a random multiplier (1x most
   of the time, with 2x/3x/5x as rarer outcomes). Store it on the segment.
   Draw a small “X2” / “X5” text label above the pad — the easiest way is
   a DOM element positioned in CSS based on the segment’s world→screen
   projection, but a simple approach is a Three.js `Sprite` with a canvas
   texture.

**Definition of Done:**

- [ ] Crashing onto a slope registers as “CRASHED ON UNEVEN TERRAIN”
- [ ] Landing too fast registers as “LANDING VELOCITY WAS TOO HIGH”
- [ ] Landing at a steep angle registers as “LANDING ANGLE WAS TOO HIGH”
- [ ] Landing with one foot off a pad registers as “TOO CLOSE TO EDGE”
- [ ] Landing gently on a flat pad with both feet grounded succeeds
- [ ] The lander *looks* like a lander, not a gray square
- [ ] Multiplier labels appear above bonus pads and affect score on landing

-----

## Phase 2 — Particles, audio, and polish for lander mode

**Goal:** lander mode feels alive. Thruster particles stream out when you
burn. A crash produces an explosion. Audio plays on the right events.

**Files touched:** `js/Particles.js`, `js/modes/LanderMode.js`, `audio/`, `js/Sound.js`

**Work:**

1. **Implement `ParticleSystemCone`.** Port the tblazevic class into the
   stub. It’s a pool of transparent plane meshes. Each particle has
   position, velocity, drag coefficient, lifetime, and lerps color/opacity/
   scale over its life. The system emits from a target `Object3D`’s world
   position, within a rectangular spawn width, at velocities inside a cone
   half-angle. The tunables in `Constants.js` are already defined.
1. **Implement `ParticleSystemExplosion`.** Same pool concept but one-shot:
   `emit()` activates all particles simultaneously with random radial
   velocities. Used on crash.
1. **Wire them into `LanderMode`.** Instantiate both in `enter()`, store as
   mode-local variables, call their `update(dt)` in `update()`, call
   `emit()` on the explosion inside `resolveCrash()`, and make the cone’s
   `emitting` flag follow the thrust state. Call `.dispose()` on both in
   `exit()` — they need to show up in the disposables set.
1. **Drop in audio files.** You need four files in `audio/`:
- `rocket.mp3` — looped while thrusting
- `crash.mp3` — on crash
- `alarm.mp3` — played every ~4 seconds while low-fuel alert is active
- `morse.mp3` — random comms chatter, every 20–40 seconds while playing
   
   Sound.js already handles missing files gracefully (no-op with warning).
   For the low-fuel and comms timers, port tblazevic’s `fuelAlert()` and
   `playComms()` functions into `Sound.js` as setTimeout-chained functions.
1. **Camera zoom-in near ground.** When altitude drops below a threshold
   (`cameraZoomAltitude` in the tblazevic constants), zoom the ortho
   camera toward the lander. This makes the final approach feel tense and
   readable. Implementation: in `LanderMode.update()`, if
   `altitude < 100`, set `camera.zoom = 4` and move `camera.position` to
   follow the lander; otherwise reset to `zoom = 1` and center the view.
   Call `camera.updateProjectionMatrix()` whenever you change zoom.

**Definition of Done:**

- [ ] Yellow-to-red particle stream pours from the lander while thrusting
- [ ] Particles respect gravity and drag (they curve and slow down)
- [ ] Crashing produces a radial orange explosion
- [ ] Rocket sound plays during thrust, stops when released
- [ ] Crash sound plays on crash
- [ ] Low-fuel alarm beeps every few seconds when fuel is low
- [ ] Camera zooms in as the lander approaches the ground

-----

## Phase 3 — Real walk mode (astronaut, terrain, first-person feel)

**Goal:** the walk segment is more than a flat plane with boxes. You’re on
the moon. The astronaut has an identity. There are things to do.

**Files touched:** `js/modes/WalkMode.js`, `models/` (new), `textures/`

**Work:**

1. **Model the astronaut.** Find or commission a low-poly astronaut GLTF.
   [Kenney’s Space Kit](https://kenney.nl/assets/space-kit) is CC0-licensed
   and has good options. Load it with `GLTFLoader` (already available via
   the importmap: `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'`).
   Replace the capsule placeholder.
   
   Add a walk animation cycle if the model has one — `AnimationMixer`
   handles this. Walking forward plays the cycle; standing stops it.
1. **Replace the flat ground with a displaced moon surface.** Use a
   `PlaneGeometry` with many segments, then perturb each vertex’s y by a
   simplex-noise or sin-sum function. Keep amplitude small (2–4 units) —
   the astronaut needs to walk on it, not climb mountains. Lock the
   astronaut’s y-position to the ground height at their current x/z via a
   raycast straight down.
1. **Add crater decals.** Pick ~20 random spots, drop a ring-geometry or
   textured plane at ground level. Purely cosmetic, but it anchors the
   sense of “moon surface.” Alternatively, bake the craters into the
   heightmap so they’re real depressions.
1. **Model the parked lander in the walk scene.** Use the same GLTF/sprite
   approach as the flying lander if possible — visual continuity matters.
   The player should clearly see “that’s my ship” when they turn around.
1. **Improve camera feel.** The current walk camera snaps behind the
   astronaut when not pointer-locked, and lets you orbit freely when it
   is. Either:
- **Strict chase cam:** always stay behind the astronaut, pitch follows
  mouse Y, yaw rotates the astronaut. Simpler, predictable.
- **Orbit cam:** the camera stays at a fixed distance but can orbit
  around. Free look, but the astronaut’s “forward” becomes the
  camera’s forward. More cinematic but trickier to tune.
   
   Pick one and commit to it. Hybrid-feeling controls are the worst of
   both worlds.
1. **Walk-mode collision.** Invisible walls around the playable area so
   the astronaut can’t walk to infinity. Simple approach: clamp
   `astronaut.position.x` and `.z` to `[-RADIUS, RADIUS]` after movement.

**Definition of Done:**

- [ ] Astronaut is a recognizable character, not a capsule
- [ ] Ground has visible terrain variation and craters
- [ ] Astronaut follows the ground (no floating, no clipping through)
- [ ] Walking feels smooth; camera doesn’t jitter or fight the player
- [ ] Can’t walk past the edges of the playable area
- [ ] The parked lander is visible and recognizable from the walk scene

-----

## Phase 4 — Interactions and mission loop

**Goal:** walk mode has a reason to exist. Multiple interactions, visible
inventory, meaningful choices. Landing somewhere specific matters.

**Files touched:** `js/modes/WalkMode.js`, `js/GameState.js`, `js/HUD.js`,
`js/Constants.js`

**Work:**

1. **Multiple interactable objects.** Rather than a single fuel cart, scatter:
- Fuel drums (add fuel)
- Supply crates (add repair kits)
- Science samples (add score)
- Damaged equipment (requires a repair kit to activate, then rewards big)
   
   Each one is an object with `position`, `type`, `onInteract(GameState)`,
   and `used` flag. A single loop in `update()` checks distance to each
   and shows the right prompt.
1. **Inventory in HUD.** Walk mode should show fuel, repair kits, and
   science samples. Add rows to `index.html`’s HUD, a `#hud-walk-*`
   section visible only in `WalkMode`. Update them via `GameState`
   subscription in `HUD.js`.
1. **Landing-site affects walk-scene contents.** The `lastLanding.x`
   value is already stored. Use it to seed the walk scene: landing on
   certain terrain segments spawns certain interactables. A simple lookup
   table in `Constants.js`:
   
   ```js
   export const LANDING_SITE_LOOT = {
     // segment index → array of spawns
     5:  [['fuel', 10, 10], ['sample', 15, 0]],
     18: [['repair', 5, 5], ['sample', 20, 20], ['sample', -10, 15]],
     // etc.
   };
   ```
   
   Some pads become gameplay-meaningful, not just score multipliers.
1. **Dialog system for comms.** When the player picks up certain items,
   an NPC (mission control) radios in with a comment. Implement as DOM
   text over the HUD, fade-in/fade-out. Triggered via `GameState.notify()`.
1. **Mission objective tracker.** A simple list: “Collect 3 samples,”
   “Refuel to 80%,” “Recover lost probe.” Objectives complete as
   `GameState` facts change. Show a checkmark list in a corner of the HUD.

**Definition of Done:**

- [ ] At least 4 distinct interactable types exist in walk mode
- [ ] Different landing sites produce visibly different walk scenes
- [ ] Inventory updates in HUD as the astronaut picks things up
- [ ] Missions track and complete based on game state
- [ ] Returning to the lander with objectives complete feels earned

-----

## Phase 5 — Cinematic transition polish

**Goal:** the 2D→3D handoff is a moment, not a cut. Players remember it.

**Files touched:** `js/modes/TransitionMode.js`, `css/main.css`, `index.html`

**Work:**

1. **Letterbox bars.** CSS `<div>`s at top and bottom, hidden normally,
   slide in during the transition via a CSS transition toggled from the
   TransitionMode. Classic “movie moment” signal.
1. **Fade through black at the midpoint.** A fullscreen black overlay div
   whose opacity is driven by the transition’s `elapsed` value:
   `opacity = 1 - Math.abs(t*2 - 1)` gives you a triangle wave that peaks
   at 1.0 exactly at t=0.5. This hides the ortho→perspective projection
   swap completely.
1. **Audio crossfade.** The rocket’s hum tapers out, a low wind-on-moon
   ambience tapers in. Same triangle-wave math on volume.
1. **Astronaut disembark animation.** On transition completion, the
   astronaut starts at the lander’s hatch position and walks outward a
   few steps before player control activates. Block input for 1.5s post-
   transition, run the walk animation along a scripted path, then unlock.
1. **Reverse transition with its own flavor.** Walk-to-lander should feel
   different from lander-to-walk: the astronaut walks into the lander,
   camera pulls up and back until it matches the ortho framing, fade in
   the 2D starfield.

**Definition of Done:**

- [ ] Transition has letterbox bars that slide in and out
- [ ] A fade-through-black hides the projection swap
- [ ] Audio fades smoothly in both directions
- [ ] Astronaut has a scripted exit/entry animation
- [ ] The transition is something you want to watch, not skip

-----

## Phase 6 — Game loop, persistence, and progression

**Goal:** there’s a reason to keep playing. Scores save. Difficulty ramps.
The game has a shape.

**Files touched:** `js/GameState.js`, `js/Main.js`, `js/Constants.js`, new: `js/Progression.js`

**Work:**

1. **Proper game-over flow.** When fuel hits zero with no recovery possible,
   show a final score screen. Ask to restart. Don’t just silently stop.
1. **High score persistence.** `GameState.save()` already writes to
   `localStorage`. Add a `GameState.highScores` array — top 10 by score —
   and a Main Menu screen (new mode) that shows it on boot.
1. **Difficulty ramp.** Each successful landing increases a “level”
   counter. Higher levels:
- Reduce gravity tolerance (or increase gravity)
- Narrow the flat pads
- Increase horizontal spawn velocity
- Reduce fuel gain per landing
1. **Achievements.** “First landing,” “Perfect landing (full fuel, center
   of pad, zero velocity),” “Hot-swap refuel (land with <100 fuel, return
   with 800+).” These are fun to hunt even solo.
1. **Settings menu.** Volume slider, invert-Y toggle, fullscreen button.
   Simple DOM overlay, toggled with Escape.

**Definition of Done:**

- [ ] Game over screen appears when the run ends
- [ ] High scores persist across sessions
- [ ] Difficulty noticeably increases over a run
- [ ] At least 5 achievements exist with trigger logic
- [ ] Settings menu opens and changes persist

-----

## Phase 7 — Release hygiene

**Goal:** someone other than you can play this without crashing or getting
confused.

**Files touched:** most, but small changes to each.

**Work:**

1. **Error boundaries.** Every mode’s `update()` and `render()` wrapped in
   try/catch that logs the error and drops back to a safe state (main
   menu) rather than freezing the frame loop.
1. **Asset preload with progress bar.** Load all GLTF models, textures,
   and audio up front; show a progress bar; only start the game when
   everything’s ready. Eliminates mid-game stutters.
1. **Frame rate target and adaptive quality.** Measure FPS. If it drops
   below 30 for more than a few seconds, reduce particle counts and
   disable fog. If it stays above 55, allow full quality.
1. **Mobile controls.** Three touch buttons (left, right, thrust) for
   lander mode; a touch joystick for walk mode. Detect touch devices and
   show the controls; otherwise hide them.
1. **Accessibility pass.** Colorblind-safe palette for the HUD (don’t rely
   only on red for alerts). Keyboard navigation for menus. Subtitle
   option for comms audio.
1. **README and deployment.** Update the project README with how to play,
   credits, license of any third-party assets. Deploy to GitHub Pages or
   Netlify — both host static files free.

**Definition of Done:**

- [ ] A friend can play start to finish without asking you for help
- [ ] Errors don’t freeze the game
- [ ] Assets preload with a visible progress indicator
- [ ] Plays on mobile
- [ ] Deployed at a public URL

-----

## Appendix A — Dependency and risk map

Each phase assumes the previous phase’s DoD holds. Key risks:

|Risk                                                |Mitigation                                                                                                 |
|----------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
|Phase 1 collision port changes how landings feel    |Keep old logic commented until new version is validated                                                    |
|Particle systems tank performance on low-end devices|Constants are already tunable — reduce max particle counts                                                 |
|Large GLTF models blow up memory                    |Check model file size (target <2 MB per model). Use Draco compression.                                     |
|Transition timing feels off                         |`TRANSITION_DURATION_S` in Constants — iterate                                                             |
|Save format changes break old saves                 |Save version is in the key (`moonlander.save.v1`). Add v2 key and migration function before changing shape.|

## Appendix B — Out of scope for this guide

These are legitimate directions but deliberately not phases:

- **Multiplayer.** Shared lander or racing modes. Requires a backend.
- **Level editor.** Let players design their own terrain. Big feature on its own.
- **Procedural terrain.** Each run is a new moon. Fun but changes scoring semantics.
- **VR mode.** Three.js supports WebXR; this is a “v2” direction.
- **Story / campaign.** Scripted mission progression with narrative.

Add new appendix entries as ideas come up so they don’t get lost, but
resist bolting them into the phases above until an earlier phase is done.