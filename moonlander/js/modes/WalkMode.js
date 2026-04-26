// modes/WalkMode.js — v0.3.0
// Third-person 3D walking scene. The astronaut spawns next to the parked
// lander at the landing site, can walk around a small moon-surface patch, and
// interact with scattered loot (fuel drums, supply crates, science samples,
// damaged probes). Pressing E next to the lander hands control back to
// Main.js, which cinematic-swaps to LanderMode.
//
// Phase 3 added: procedural astronaut + walk cycle, displaced moon surface,
//   crater decals, textured parked-lander sprite, strict chase cam, xz clamp.
// Phase 4 added: four distinct interactable types seeded by landing segment
//   (see Constants.LANDING_SITE_LOOT), proper inventory effects, a comms
//   blip on every pickup, and objective progression via refreshObjectives().

import * as THREE from 'three';
import {
  PERSP_FOV, PERSP_NEAR, PERSP_FAR,
  LANDER_SCALE,
  WALK_SPEED, WALK_CAMERA_DISTANCE, WALK_CAMERA_HEIGHT, WALK_INTERACT_RADIUS,
  WALK_PLAY_RADIUS, WALK_MOUSE_SENSITIVITY,
  WALK_PITCH_MIN, WALK_PITCH_MAX,
  WALK_GROUND_AMPLITUDE, WALK_CRATER_COUNT,
  INTERACTABLE_TYPES, APOLLO_SITES, apolloSiteForLevel, apolloSiteStlPath,
  DISEMBARK_DURATION_S, DISEMBARK_STEP_UNITS, EMBARK_DURATION_S,
  TRANSITION_WIND_VOL,
  HOT_SWAP_LOW_FUEL, HOT_SWAP_HIGH_FUEL,
  MODEL_PATHS, LANDMARKS, LEVEL1_FIXED_LOOT,
  TERRAIN_TILE_POSITIONS, TERRAIN_TILE_SIZE, TERRAIN_TILE_SINK,
  LANDER_REPAIR_PER_PART, HABITAT_HEAL_AMOUNT, HEALTH_PACK_AMOUNT,
  LANDER_BEACON_COLOR, LANDER_BEACON_HEIGHT,
  LANDER_BEACON_RADIUS, LANDER_BEACON_OPACITY,
  CARGO_REMINDER_INTERVAL_S, CARGO_REMINDER_MIN_DIST,
  LOW_FUEL_RETURN_FRAC,
  MODE
} from '../Constants.js';
import {
  GameState, update as updateState, notify, refreshObjectives,
  unlockAchievement, setObjectivesForLevel
} from '../GameState.js';
import { Input } from '../Input.js';
import {
  setCenterMessage, showComms, showAchievementToast,
  showWalkTutorial, hideWalkTutorial,
  setMapDataProvider, setLadderProviders, hideMap, resetStemSession,
  showMissionMessage, setCarryDropHandler
} from '../HUD.js';
import { Sounds } from '../Sound.js';
import { effectiveFuelGain } from '../Progression.js';
import { getQuality, onQualityChange } from '../Quality.js';
import { getSharedTexture } from '../AssetCache.js';
import { loadModel, loadSTL, placeOnGround } from '../ModelCache.js';
import * as Story from '../Story.js';
import { Alien } from './walk/Alien.js';
import { ALIEN_MIN_LEVEL, ALIEN_SPAWN_CHANCE } from '../Constants.js';
import { LOW_END } from '../Device.js';

let scene = null;
let camera = null;
let canvasEl = null;
let astronaut = null;
let astronautParts = null;     // references to animated bones
let landerModel = null;
let interactables = [];        // Phase-4 loot: [{ type, object3d, used, ... }]
let disposables = [];
let footprints = [];           // pooled fading prints behind the astronaut
let footprintCursor = 0;       // ring-buffer write index
let lastFootprintPos = null;   // THREE.Vector3 — last spot we dropped a print

// NASA 3D Resources GLB integration. When the file is present + decoded
// these references hold the swapped-in mesh; the procedural primitive
// underneath is hidden but kept around as a fallback. `null` means we're
// running on the procedural fallback (LOW_END device or missing file).
let astronautModel = null;     // Mercury Spacesuit GLB scene
let astronautProceduralVisible = true;
let landerModel3D = null;      // Apollo Lunar Module GLB scene
let onReturnToLanderCallback = null;

// Camera-orbit state — yaw also rotates the astronaut (strict chase cam).
let yawRad = 0;
let pitchRad = 0.55;
let pointerLocked = false;
let walkPhase = 0;             // drives the leg/arm cycle

// Phase-5 scripted disembark/embark animation state. While non-null, player
// input is ignored and astronaut position/yaw are driven by the timeline.
let scripted = null;
// { kind, t, duration, startPos, endPos, startYaw, endYaw, onDone }

// Optional alien encounter (Batch 4 #12). Constructed in enter() under a
// chance gate; updated each frame; disposed in exit().
let alien = null;

// Mouse-move handler bound in enter(), unbound in exit().
let onMouseMove = null;
let onPointerLockChange = null;
let onCanvasClick = null;
let onCanvasTouchStart = null;
let onCanvasTouchMove = null;
let onCanvasTouchEnd = null;
let unsubQuality = null;

// Return-to-lander signposting: throttle the "cargo waiting" comms blip
// so we don't spam the same line every frame the player is wandering.
// `walkSessionElapsed` is incremented in update() and powers both the
// reminder cadence and the low-fuel-return gate (both reset in enter()).
let walkSessionElapsed = 0;
let lastCargoReminderAt = -Infinity;

// Mobile touch state — a one-finger drag rotates astronaut yaw + camera
// pitch (replaces unreachable pointer-lock); a quick tap with little
// movement triggers the closest in-range interactable.
let touchActiveId  = null;
let touchLastX = 0, touchLastY = 0;
let touchStartX = 0, touchStartY = 0;
let touchStartTime = 0;
const TOUCH_TAP_MAX_PIXELS = 16;
const TOUCH_TAP_MAX_MS     = 300;
const TOUCH_LOOK_GAIN      = 1.7;   // touch is coarser than mouse — bump sens

export const WalkMode = {
  enter(context, callbacks = {}) {
    console.log('▶ WalkMode.enter');
    onReturnToLanderCallback = callbacks.onReturnToLander || (() => {});
    canvasEl = context.canvas;

    scene = new THREE.Scene();
    // Batch 5 #20: starfield panorama as scene.background. LOW_END skips
    // the texture load (extra GPU upload not worth it on cheap devices)
    // and falls back to the solid color.
    if (LOW_END) {
      scene.background = new THREE.Color(0x0a0a1a);
    } else {
      scene.background = getSharedTexture('textures/starfield.png');
    }
    // Fog is cosmetic but adds a depth-cue shader cost; the adaptive quality
    // controller toggles it off when FPS tanks.
    if (getQuality() !== 'low') scene.fog = new THREE.Fog(0x0a0a1a, 60, 320);
    unsubQuality = onQualityChange(q => {
      if (!scene) return;
      scene.fog = (q === 'low') ? null : new THREE.Fog(0x0a0a1a, 60, 320);
    });

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(PERSP_FOV, aspect, PERSP_NEAR, PERSP_FAR);

    buildLighting();
    buildGround();
    buildCraters();
    buildEarth();
    buildAstronaut();
    buildParkedLander();
    // Tall yellow pillar over the parked lander so the player can find
    // home from anywhere in the play area. Always on (not gated on cargo).
    buildLanderBeacon();
    // Rebuild the objectives list from career + this level's Apollo briefs
    // BEFORE spawning loot, so the HUD can show the full list immediately.
    setObjectivesForLevel(GameState.level);
    spawnInteractables();
    buildFootprintPool();

    // Reset per-walk-session signposting state so reminders don't carry
    // over from the previous trip's timestamps.
    walkSessionElapsed = 0;
    lastCargoReminderAt = -Infinity;
    if (GameState.flags) GameState.flags.lowFuelReturnFired = false;

    // Spawn next to the parked lander, facing away from it. The lunar
    // cheat (Main.js:triggerLunarCheat) overrides this to drop the
    // astronaut next to the LEVEL1_FIXED_LOOT fuel drum at (34, -28),
    // facing it, so the player can grab the drum immediately.
    if (callbacks.cheatSpawn) {
      astronaut.position.set(30, 0, -25);
      astronaut.position.y = groundHeight(astronaut.position.x, astronaut.position.z);
      // Face the drum at (34, -28). Astronaut forward = (-sin(yaw), -cos(yaw)),
      // matching the startEmbark math elsewhere in this file.
      const dx = 34 - 30, dz = -28 - (-25);
      yawRad = Math.atan2(-dx, -dz);
    } else {
      astronaut.position.set(6, 0, 6);
      astronaut.position.y = groundHeight(astronaut.position.x, astronaut.position.z);
      yawRad = Math.PI * 0.25;
    }
    pitchRad = 0.55;

    bindMouse();

    GameState.mode = MODE.WALK;
    notify('mode');
    setCenterMessage('TAP TO INTERACT  ·  WASD or joystick to move');
    // Wire up the satellite-map button by handing HUD a function that
    // returns the current snapshot. Cleared on exit.
    setMapDataProvider(() => this.getMapData());
    // Batch 5 #9 — hand HUD the scripted climb / descend functions so
    // requestOpenMap() drives an actual visible animation rather than a
    // 750 ms timeout. Cleared on exit().
    setLadderProviders({
      climb:   (onTop)  => this.startLadderClimb(onTop),
      descend: (onDone) => this.startLadderDescend(onDone)
    });
    // Per-walk-session caps: STEM challenges (Batch 2 #3) reset so the
    // player can answer a few each trip, not just once per page load.
    resetStemSession();
    // HUD CARRY row → tap to drop one of that type at the astronaut's
    // current xz. Item persists in GameState.droppedItems and respawns
    // here on next WalkMode.enter (across runs).
    setCarryDropHandler((idx) => dropCarryItem(idx));
    // Story progression layer (Batch 4 #10) — fires the per-level intro
    // beat the first time the player walks each Apollo site.
    Story.onWalkEnter();

    // Alien encounter (Batch 4 #12) — gated by level + dice roll so it's
    // a rare surprise, not a constant nuisance. Spawns 4–10 s after the
    // scene loads so the player has time to settle.
    alien = null;
    if ((GameState.level | 0) >= ALIEN_MIN_LEVEL && Math.random() < ALIEN_SPAWN_CHANCE) {
      const delay = 4000 + Math.random() * 6000;
      setTimeout(() => {
        if (!scene) return;  // bailed to lander before spawn timer fired
        alien = new Alien(scene, groundHeight, WALK_PLAY_RADIUS);
      }, delay);
    }
  },

  exit() {
    console.log('◀ WalkMode.exit');
    unbindMouse();
    if (unsubQuality) { unsubQuality(); unsubQuality = null; }
    if (document.pointerLockElement) document.exitPointerLock();
    // Tear down the first-time tutorial if it was still open — we don't
    // want it hovering over lander mode.
    hideWalkTutorial();
    // Tear down the satellite map's data link so HUD doesn't poll a dead
    // walk session, and hide the overlay if it was open.
    setMapDataProvider(null);
    setLadderProviders(null);
    setCarryDropHandler(null);
    hideMap();

    for (const d of disposables) {
      if (d.geometry) d.geometry.dispose();
      if (d.material) {
        if (Array.isArray(d.material)) d.material.forEach(m => m.dispose());
        else d.material.dispose();
      }
      if (d.texture) d.texture.dispose();
    }
    disposables = [];

    if (alien) { alien.dispose(); alien = null; }

    scene = null;
    camera = null;
    canvasEl = null;
    astronaut = null;
    astronautParts = null;
    astronautModel = null;
    astronautProceduralVisible = true;
    landerModel = null;
    landerModel3D = null;
    interactables = [];
    footprints = [];
    footprintCursor = 0;
    lastFootprintPos = null;
    pointerLocked = false;
    scripted = null;
  },

  update(dt) {
    // Scripted disembark / embark takes priority over player input. It drives
    // position, yaw, walk animation, and camera each frame, then bails out
    // before the normal input loop runs.
    if (scripted) {
      scripted.t = Math.min(1, scripted.t + dt / scripted.duration);
      const t = scripted.t;
      if (scripted.kind === 'climb-up' || scripted.kind === 'climb-down') {
        // Pure vertical lift up the lander side. Y is the only axis that
        // animates; xz stay locked and the astronaut faces the lander
        // (already set when the climb started).
        astronaut.position.x = scripted.startPos.x;
        astronaut.position.z = scripted.startPos.z;
        const yEase = t * t * (3 - 2 * t);
        astronaut.position.y = lerp(scripted.startPos.y, scripted.endPos.y, yEase);
        astronaut.rotation.y = scripted.startYaw;
        updateWalkAnim(dt, true);
        updateChaseCamera();
      } else {
        astronaut.position.x = lerp(scripted.startPos.x, scripted.endPos.x, t);
        astronaut.position.z = lerp(scripted.startPos.z, scripted.endPos.z, t);
        astronaut.position.y = groundHeight(astronaut.position.x, astronaut.position.z);
        yawRad = lerpAngle(scripted.startYaw, scripted.endYaw, t);
        astronaut.rotation.y = yawRad;
        updateWalkAnim(dt, true);
        updateChaseCamera();
      }
      if (t >= 1) {
        const done = scripted.onDone;
        scripted = null;
        done();
      }
      return;
    }

    // Walk-session clock for cadence-based comms (cargo / low-fuel reminders).
    walkSessionElapsed += dt;
    updateReturnToLanderSignposting();

    // --- movement in the astronaut's facing direction ---
    astronaut.rotation.y = yawRad;
    const fwdX = -Math.sin(yawRad);
    const fwdZ = -Math.cos(yawRad);

    let moveSign = 0;
    if (Input.isDown('w') || Input.isDown('W')) moveSign += 1;
    if (Input.isDown('s') || Input.isDown('S')) moveSign -= 1;
    if (moveSign !== 0) {
      astronaut.position.x += fwdX * WALK_SPEED * dt * moveSign;
      astronaut.position.z += fwdZ * WALK_SPEED * dt * moveSign;
    }

    // Strafe with A/D — works whether or not the pointer is locked. Mouse X
    // handles turning (when locked); the player will see "CLICK TO LOOK
    // AROUND" until they engage pointer lock.
    let strafeSign = 0;
    if (Input.isDown('a') || Input.isDown('A')) strafeSign -= 1;
    if (Input.isDown('d') || Input.isDown('D')) strafeSign += 1;
    if (strafeSign !== 0) {
      const rightX = -fwdZ, rightZ = fwdX;
      astronaut.position.x += rightX * WALK_SPEED * dt * strafeSign;
      astronaut.position.z += rightZ * WALK_SPEED * dt * strafeSign;
    }

    // --- boundary clamp ---
    if (astronaut.position.x >  WALK_PLAY_RADIUS) astronaut.position.x =  WALK_PLAY_RADIUS;
    if (astronaut.position.x < -WALK_PLAY_RADIUS) astronaut.position.x = -WALK_PLAY_RADIUS;
    if (astronaut.position.z >  WALK_PLAY_RADIUS) astronaut.position.z =  WALK_PLAY_RADIUS;
    if (astronaut.position.z < -WALK_PLAY_RADIUS) astronaut.position.z = -WALK_PLAY_RADIUS;

    // --- ground follow via heightmap (cheaper than a real raycast) ---
    astronaut.position.y = groundHeight(astronaut.position.x, astronaut.position.z);

    // --- walk animation ---
    const isMoving = moveSign !== 0 || strafeSign !== 0;
    updateWalkAnim(dt, isMoving);

    // --- footprint trail (permanent, no fade) ---
    if (isMoving) dropFootprintIfMoved();

    // --- strict chase camera around the astronaut's chest ---
    updateChaseCamera();

    // --- alien encounter (Batch 4 #12) ---
    if (alien) {
      alien.update(dt, astronaut.position);
      if (alien.isGone()) { alien.dispose(); alien = null; }
    }

    // --- loot idle animation (sample spin, etc.) ---
    for (const it of interactables) {
      if (it.used || !it.object3d.visible) continue;
      if (it.spin) it.object3d.rotation.y += it.spin * dt;
    }

    // --- interaction: pick the closest in-range interactable, fall back to
    // the parked lander if none is near. Prompts and E-key are handled here. ---
    const ePressed = Input.wasPressed('e') || Input.wasPressed('E');
    const closest = pickClosestInteractable();
    if (closest) {
      setCenterMessage(promptFor(closest));
      if (ePressed) performInteraction(closest);
    } else {
      const distToLander = astronaut.position.distanceTo(landerModel.position);
      if (distToLander < WALK_INTERACT_RADIUS) {
        // Carrying anything? First E stows everything (refuels +
        // restores HP). Empty hands? E boards the lander.
        if (GameState.carrying.length > 0) {
          setCenterMessage('STOW CARGO');
          if (ePressed) stowCarryAtLander();
        } else {
          setCenterMessage('BOARD LANDER');
          if (ePressed) {
            // Tick the synthetic "return to the lander" objective the moment
            // the astronaut commits to climbing in. LanderMode.resolveLanding
            // clears it for the next level.
            updateState(s => { s.flags.boardedThisLevel = true; }, 'boarded');
            refreshObjectives();
            onReturnToLanderCallback();
          }
        }
      } else {
        setCenterMessage('');
      }
    }
  },

  render(renderer) {
    renderer.render(scene, camera);
  },

  getCamera() { return camera; },
  getScene()  { return scene; },
  getAstronaut() { return astronaut; },

  /**
   * Snapshot of everything the satellite-map overlay needs to render.
   * Returns null when called outside walk mode (caller should hide map).
   */
  getMapData() {
    if (!astronaut || !landerModel) return null;
    const items = interactables.map(it => {
      const p = it.object3d.position;
      let kind, color, label;
      if (it.type === 'apollo') {
        kind = 'apollo';
        color = '#ffd860';
        label = it.apollo.name;
      } else if (it.type === 'landmark') {
        kind = 'landmark';
        color = '#c0c0c8';
        label = it.landmark.name;
      } else {
        kind = it.type;
        const c = INTERACTABLE_TYPES[it.type]?.color ?? 0xffffff;
        color = '#' + c.toString(16).padStart(6, '0');
        label = INTERACTABLE_TYPES[it.type]?.label || it.type.toUpperCase();
      }
      return { kind, x: p.x, z: p.z, used: it.used, color, label };
    });
    const distToLander = astronaut.position.distanceTo(landerModel.position);
    return {
      bounds: WALK_PLAY_RADIUS,
      astronaut: { x: astronaut.position.x, z: astronaut.position.z, yaw: yawRad },
      lander:    { x: landerModel.position.x, z: landerModel.position.z },
      items,
      // The satellite-map overlay is gated behind being at the lander
      // (lore: you climb the ladder, jack into the uplink). HUD reads
      // this flag on map-button click and either plays a "climbing" beat
      // or rejects with a "REACH THE LANDER FIRST" comms blip.
      nearLander: distToLander < WALK_INTERACT_RADIUS * 1.6
    };
  },

  /**
   * Phase-5 disembark: teleport the astronaut to the parked lander's hatch,
   * then walk them forward DISEMBARK_STEP_UNITS. Input is locked for the
   * duration. Main.js fires this on the lander→walk transition's onComplete.
   */
  startDisembark(onDone = () => {}) {
    const lx = landerModel.position.x;
    const lz = landerModel.position.z;
    // Hatch is just in front of the lander along +Z; astronaut faces +Z.
    const hatchX = lx;
    const hatchZ = lz + 3;
    astronaut.position.set(hatchX, groundHeight(hatchX, hatchZ), hatchZ);
    yawRad = Math.PI;   // facing +Z so forward walks away from the lander
    pitchRad = 0.55;
    const endX = hatchX;
    const endZ = hatchZ + DISEMBARK_STEP_UNITS;
    scripted = {
      kind: 'disembark',
      t: 0,
      duration: DISEMBARK_DURATION_S,
      startPos: astronaut.position.clone(),
      endPos: new THREE.Vector3(endX, 0, endZ),
      startYaw: yawRad,
      endYaw: yawRad,
      onDone
    };
    // Prompt is irrelevant mid-script; the lockout is also visually cued by
    // the still-sliding letterbox bars.
    setCenterMessage('');
    // Wind ambience takes over from the transition crossfade.
    Sounds.wind?.setVolume(TRANSITION_WIND_VOL);
    // First-time-on-the-moon help card. No-ops if the player has dismissed
    // it before (GameState.flags.walkTutorialSeen persists across saves).
    showWalkTutorial();
  },

  /**
   * Phase-5 embark: walk the astronaut into the parked lander, then fire
   * onDone so Main.js can start the walk→lander cinematic swap.
   */
  startEmbark(onDone = () => {}) {
    const target = landerModel.position.clone();
    const dx = target.x - astronaut.position.x;
    const dz = target.z - astronaut.position.z;
    const targetYaw = Math.atan2(-dx, -dz); // astronaut forward = (-sin, 0, -cos)
    scripted = {
      kind: 'embark',
      t: 0,
      duration: EMBARK_DURATION_S,
      startPos: astronaut.position.clone(),
      endPos: target,
      startYaw: yawRad,
      endYaw: targetYaw,
      onDone
    };
    setCenterMessage('');
  },

  /**
   * Batch 5 #9: scripted up-the-ladder climb. Used when opening the
   * satellite map — replaces the old 750 ms blind timeout in HUD with an
   * actual visible motion. Astronaut is already at the lander when this
   * fires (HUD checks via the data provider). Translates +Y over ~1.4 s,
   * then fires onTop.
   */
  startLadderClimb(onTop = () => {}) {
    const sp = astronaut.position.clone();
    // Face the lander so the chase camera frames the climb cleanly.
    const dx = landerModel.position.x - sp.x;
    const dz = landerModel.position.z - sp.z;
    const facingYaw = Math.atan2(-dx, -dz);
    yawRad = facingYaw;
    scripted = {
      kind: 'climb-up',
      t: 0,
      duration: 1.4,
      startPos: sp,
      endPos: new THREE.Vector3(sp.x, sp.y + 4.2, sp.z),
      startYaw: facingYaw,
      endYaw: facingYaw,
      onDone: onTop
    };
    setCenterMessage('CLIMBING LADDER…');
  },

  /**
   * Reverse of startLadderClimb — returns the astronaut to the ground.
   * Called when the satellite map closes.
   */
  startLadderDescend(onDone = () => {}) {
    const sp = astronaut.position.clone();
    const groundY = groundHeight(sp.x, sp.z);
    scripted = {
      kind: 'climb-down',
      t: 0,
      duration: 1.0,
      startPos: sp,
      endPos: new THREE.Vector3(sp.x, groundY, sp.z),
      startYaw: yawRad,
      endYaw: yawRad,
      onDone
    };
    setCenterMessage('');
  }
};

// ---------- helpers ----------

/**
 * Per-frame nudges that point the player back at the lander:
 *   - "CARGO STOWED IN PACK …" comms blip if they've been wandering with
 *     items in their pack for CARGO_REMINDER_INTERVAL_S, far enough from
 *     the lander to actually need the prompt.
 *   - One-shot CAPCOM panel when fuel drops below LOW_FUEL_RETURN_FRAC.
 *     `flags.lowFuelReturnFired` gates it so it only fires once per walk
 *     session (cleared on WalkMode.enter).
 * Both are skipped during the scripted disembark/embark animation since
 * the player has no agency there.
 */
function updateReturnToLanderSignposting() {
  if (scripted) return;
  if (!astronaut || !landerModel) return;

  // Distance check shared between the two reminders.
  const dx = astronaut.position.x - landerModel.position.x;
  const dz = astronaut.position.z - landerModel.position.z;
  const distSq = dx * dx + dz * dz;
  const farEnough = distSq > CARGO_REMINDER_MIN_DIST * CARGO_REMINDER_MIN_DIST;

  if ((GameState.carrying?.length || 0) > 0 &&
      farEnough &&
      walkSessionElapsed - lastCargoReminderAt >= CARGO_REMINDER_INTERVAL_S) {
    showComms('CARGO STOWED IN PACK — RETURN TO LANDER TO DEPOSIT');
    lastCargoReminderAt = walkSessionElapsed;
  }

  const cap  = GameState.fuel?.capacity || 0;
  const cur  = GameState.fuel?.current  || 0;
  const frac = cap > 0 ? cur / cap : 1;
  if (frac < LOW_FUEL_RETURN_FRAC && !GameState.flags?.lowFuelReturnFired) {
    showMissionMessage('lowFuelReturn');
    if (GameState.flags) GameState.flags.lowFuelReturnFired = true;
  }
}

function bindMouse() {
  onMouseMove = (e) => {
    if (!pointerLocked || scripted) return;
    const pitchSign = GameState.settings?.invertY ? -1 : 1;
    yawRad   -= e.movementX * WALK_MOUSE_SENSITIVITY;
    pitchRad += e.movementY * WALK_MOUSE_SENSITIVITY * pitchSign;
    if (pitchRad < WALK_PITCH_MIN) pitchRad = WALK_PITCH_MIN;
    if (pitchRad > WALK_PITCH_MAX) pitchRad = WALK_PITCH_MAX;
  };
  onPointerLockChange = () => {
    pointerLocked = document.pointerLockElement === canvasEl;
  };
  onCanvasClick = () => {
    // Skip pointer-lock requests on touch devices — they get screen-swipe
    // controls instead, and a synthetic click after touchend would otherwise
    // trip the lock dialog.
    if (touchActiveId !== null) return;
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;
    if (!pointerLocked) canvasEl.requestPointerLock?.();
  };

  // ----- Mobile touch handlers (canvas only) -----
  // Drag → camera/astronaut yaw + pitch. Tap → tap-to-interact.
  // We ignore touches whose target isn't the canvas itself, so the joystick
  // and the corner buttons keep their own behavior.
  onCanvasTouchStart = (e) => {
    if (e.target !== canvasEl) return;
    if (touchActiveId !== null) return;
    const t = e.changedTouches[0];
    touchActiveId  = t.identifier;
    touchLastX = touchStartX = t.clientX;
    touchLastY = touchStartY = t.clientY;
    touchStartTime = performance.now();
  };
  onCanvasTouchMove = (e) => {
    if (touchActiveId === null || scripted) return;
    let t = null;
    for (const tt of e.changedTouches) {
      if (tt.identifier === touchActiveId) { t = tt; break; }
    }
    if (!t) return;
    const dx = t.clientX - touchLastX;
    const dy = t.clientY - touchLastY;
    touchLastX = t.clientX;
    touchLastY = t.clientY;
    const pitchSign = GameState.settings?.invertY ? -1 : 1;
    yawRad   -= dx * WALK_MOUSE_SENSITIVITY * TOUCH_LOOK_GAIN;
    pitchRad += dy * WALK_MOUSE_SENSITIVITY * TOUCH_LOOK_GAIN * pitchSign;
    if (pitchRad < WALK_PITCH_MIN) pitchRad = WALK_PITCH_MIN;
    if (pitchRad > WALK_PITCH_MAX) pitchRad = WALK_PITCH_MAX;
    if (e.cancelable) e.preventDefault();   // suppress page scroll while looking
  };
  onCanvasTouchEnd = (e) => {
    if (touchActiveId === null) return;
    let t = null;
    for (const tt of e.changedTouches) {
      if (tt.identifier === touchActiveId) { t = tt; break; }
    }
    if (!t) return;
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const moved = Math.hypot(dx, dy);
    const elapsed = performance.now() - touchStartTime;
    touchActiveId = null;
    // Tap = short + still: trigger the closest in-range interactable.
    if (moved < TOUCH_TAP_MAX_PIXELS && elapsed < TOUCH_TAP_MAX_MS && !scripted) {
      const closest = pickClosestInteractable();
      if (closest) performInteraction(closest);
    }
  };

  window.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  canvasEl.addEventListener('click', onCanvasClick);
  canvasEl.addEventListener('touchstart',  onCanvasTouchStart, { passive: true });
  canvasEl.addEventListener('touchmove',   onCanvasTouchMove,  { passive: false });
  canvasEl.addEventListener('touchend',    onCanvasTouchEnd);
  canvasEl.addEventListener('touchcancel', onCanvasTouchEnd);
}

function unbindMouse() {
  if (onMouseMove) window.removeEventListener('mousemove', onMouseMove);
  if (onPointerLockChange) document.removeEventListener('pointerlockchange', onPointerLockChange);
  if (onCanvasClick && canvasEl) canvasEl.removeEventListener('click', onCanvasClick);
  if (canvasEl) {
    if (onCanvasTouchStart)  canvasEl.removeEventListener('touchstart',  onCanvasTouchStart);
    if (onCanvasTouchMove)   canvasEl.removeEventListener('touchmove',   onCanvasTouchMove);
    if (onCanvasTouchEnd)    canvasEl.removeEventListener('touchend',    onCanvasTouchEnd);
    if (onCanvasTouchEnd)    canvasEl.removeEventListener('touchcancel', onCanvasTouchEnd);
  }
  onMouseMove = onPointerLockChange = onCanvasClick = null;
  onCanvasTouchStart = onCanvasTouchMove = onCanvasTouchEnd = null;
  touchActiveId = null;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpAngle(a, b, t) {
  // Shortest-path angular lerp so a PI→-PI swing doesn't take the long way.
  let d = b - a;
  while (d >  Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function updateChaseCamera() {
  // Spherical offset from the astronaut's chest at current yaw/pitch.
  const R = WALK_CAMERA_DISTANCE;
  const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad);
  const sy = Math.sin(yawRad),  cy = Math.cos(yawRad);
  const targetX = astronaut.position.x;
  const targetY = astronaut.position.y + 2.5;
  const targetZ = astronaut.position.z;
  camera.position.x = targetX + R * cp * sy;
  camera.position.y = targetY + R * sp + WALK_CAMERA_HEIGHT * 0.15;
  camera.position.z = targetZ + R * cp * cy;
  camera.lookAt(targetX, targetY, targetZ);
}

// ---------- world build ----------

function buildLighting() {
  const ambient = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(50, 80, 30);
  scene.add(sun);
}

/** Deterministic sin-sum heightmap — shared by buildGround() and ground-follow. */
function groundHeight(x, z) {
  const a = Math.sin(x * 0.08) * 1.2;
  const b = Math.cos(z * 0.06) * 1.0;
  const c = Math.sin((x + z) * 0.045) * 0.6;
  const d = Math.sin(x * 0.19 - z * 0.13) * 0.4;
  return (a + b + c + d) * (WALK_GROUND_AMPLITUDE / 3.2);
}

function buildGround() {
  // Procedural sin-displaced plane stays as the SOURCE OF TRUTH for ground
  // height — astronaut, footprints, landmarks all sample groundHeight(x,z).
  // This way swapping in / failing to swap in the STL never affects collision
  // or placement; the STL is purely visual cladding on top.
  const size = WALK_PLAY_RADIUS * 2.4;
  const segs = 128;
  const geom = new THREE.PlaneGeometry(size, size, segs, segs);
  geom.rotateX(-Math.PI / 2);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
  }
  geom.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0x8c8c90, flatShading: true });
  const mesh = new THREE.Mesh(geom, mat);
  scene.add(mesh);
  disposables.push({ geometry: geom, material: mat });

  // Async upgrade: tile the NASA height-map STL across the play area as
  // visual cladding. The STL is "thicker than needed" — it's a 3D-
  // printable height block — so we sink each tile by TERRAIN_TILE_SINK
  // units. From astronaut height the buried bottom is invisible; only
  // the top surface reads. The procedural plane underneath fills gaps.
  //
  // Batch 5 #23: try the per-Apollo path first (e.g. Apollo 12 / 14 /
  // 15 / 16 / 17 - Landing Site.stl) and fall back to the bundled
  // Apollo 11 STL if it's missing. Only Apollo 11 ships today; dropping
  // additional NASA STLs into assets/nasa_models/ activates them
  // automatically with no further code change.
  const perLevelStl = apolloSiteStlPath(GameState.level);
  const stlPromise = (perLevelStl && perLevelStl !== MODEL_PATHS.apollo11Site)
    ? loadSTL(perLevelStl).catch(() => loadSTL(MODEL_PATHS.apollo11Site))
    : loadSTL(MODEL_PATHS.apollo11Site);
  stlPromise
    .then(stlGeom => {
      if (!scene) return;
      const tileMat = new THREE.MeshLambertMaterial({
        color: 0x7c7c84, flatShading: true
      });
      disposables.push({ material: tileMat });
      // Compute a uniform scale so the longest STL dimension fits
      // TERRAIN_TILE_SIZE world units. Centered per-tile via geometry
      // bounding box so each instance lines up on its anchor.
      stlGeom.computeBoundingBox();
      const bb = stlGeom.boundingBox;
      const sizeX = bb.max.x - bb.min.x;
      const sizeY = bb.max.y - bb.min.y;
      const sizeZ = bb.max.z - bb.min.z;
      const longest = Math.max(sizeX, sizeY, sizeZ) || 1;
      const tileScale = TERRAIN_TILE_SIZE / longest;
      // STL files commonly use Z-up; rotate to Y-up if the model was
      // exported as a horizontal slab seen from above (Z is the "thickness"
      // axis). We detect by which axis is shortest — the thin one is the
      // height for a top-down lunar terrain.
      const shortest = Math.min(sizeX, sizeY, sizeZ);
      const needsZupFix = (shortest === sizeZ);

      for (const [tx, tz] of TERRAIN_TILE_POSITIONS) {
        const tile = new THREE.Mesh(stlGeom, tileMat);
        if (needsZupFix) tile.rotation.x = -Math.PI / 2;
        tile.scale.setScalar(tileScale);
        // Center the tile horizontally on (tx, tz) and sink it so the
        // visible top surface meets the procedural ground level near the
        // anchor point (groundHeight is small relative to tile height).
        tile.updateMatrixWorld(true);
        const tbb = new THREE.Box3().setFromObject(tile);
        const tcx = (tbb.min.x + tbb.max.x) / 2;
        const tcz = (tbb.min.z + tbb.max.z) / 2;
        tile.position.set(
          tx - tcx,
          groundHeight(tx, tz) - TERRAIN_TILE_SINK,
          tz - tcz
        );
        scene.add(tile);
      }
      console.log(`[WalkMode] Apollo 11 terrain tiles active (${TERRAIN_TILE_POSITIONS.length})`);
      // Note: STL geometry is owned by ModelCache (shared by every tile)
      // and is NOT pushed to disposables — exit() leaves it in the cache.
    })
    .catch(() => { /* keep procedural ground as the only visual */ });
}

// ---------- Boot-print trail ----------
//
// A pool of dark prints laid flat on the surface every time the astronaut
// walks ~1.6 units. Alternates left/right offset to read as a proper boot
// trail. Per playtest feedback (no wind / erosion on the moon), prints
// stay visible permanently — when the pool wraps, the oldest print is
// repositioned rather than fading. Pool sized so the trail covers nearly
// the full playable area before wrapping.

const FOOTPRINT_POOL_SIZE = 200;
const FOOTPRINT_INTERVAL  = 1.6;   // world units between prints
const FOOTPRINT_OPACITY   = 0.55;

function buildFootprintPool() {
  const geom = new THREE.PlaneGeometry(0.55, 0.95);
  geom.rotateX(-Math.PI / 2);
  disposables.push({ geometry: geom });

  footprints = [];
  for (let i = 0; i < FOOTPRINT_POOL_SIZE; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a1a20,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.visible = false;
    scene.add(mesh);
    footprints.push({ mesh, mat });
    disposables.push({ material: mat });
  }
  footprintCursor = 0;
  lastFootprintPos = null;
}

function dropFootprintIfMoved() {
  if (!astronaut || footprints.length === 0) return;
  if (!lastFootprintPos) {
    lastFootprintPos = astronaut.position.clone();
    return;
  }
  if (astronaut.position.distanceTo(lastFootprintPos) < FOOTPRINT_INTERVAL) return;

  const fp = footprints[footprintCursor];
  footprintCursor = (footprintCursor + 1) % footprints.length;

  // Offset left/right of centerline by ~0.35 units. The astronaut's forward
  // is (-sin(yaw), 0, -cos(yaw)); right is its 90° rotation.
  const sign = footprintCursor % 2 === 0 ? 1 : -1;
  const sideX = -Math.cos(astronaut.rotation.y) * 0.35 * sign;
  const sideZ =  Math.sin(astronaut.rotation.y) * 0.35 * sign;
  const px = astronaut.position.x + sideX;
  const pz = astronaut.position.z + sideZ;

  fp.mesh.position.set(px, groundHeight(px, pz) + 0.06, pz);
  fp.mesh.rotation.y = astronaut.rotation.y;
  fp.mat.opacity = FOOTPRINT_OPACITY;
  fp.mesh.visible = true;

  lastFootprintPos.copy(astronaut.position);
}

function buildCraters() {
  // Batch 5 #15: textured circular decals replace the old empty rings.
  // The PNG carries its own alpha (transparent outside the disc, soft
  // inside). If the texture is missing the loader returns a placeholder
  // and the decals fall back to a flat dark fill, which still reads as
  // craters at distance.
  const tex = getSharedTexture('textures/crater.png');
  const craterMat = new THREE.MeshBasicMaterial({
    map: tex, color: 0xffffff,
    transparent: true, opacity: 0.92, side: THREE.DoubleSide,
    depthWrite: false
  });
  disposables.push({ material: craterMat });

  for (let i = 0; i < WALK_CRATER_COUNT; i++) {
    const cx = (Math.random() * 2 - 1) * WALK_PLAY_RADIUS * 0.9;
    const cz = (Math.random() * 2 - 1) * WALK_PLAY_RADIUS * 0.9;
    const size = 6 + Math.random() * 16;
    const decalGeom = new THREE.PlaneGeometry(size, size);
    decalGeom.rotateX(-Math.PI / 2);
    const decal = new THREE.Mesh(decalGeom, craterMat);
    // Slight Y offset so the decal sits just above the ground without
    // z-fighting with the displaced plane.
    decal.position.set(cx, groundHeight(cx, cz) + 0.06, cz);
    decal.rotation.y = Math.random() * Math.PI * 2;
    scene.add(decal);
    disposables.push({ geometry: decalGeom });
  }
}

/**
 * Batch 5 #21: Earth hangs in the sky — a textured sphere placed far
 * above the play area. Skipped on LOW_END. The texture has soft
 * continents + clouds painted on a transparent disc; we apply it via
 * MeshBasicMaterial so it doesn't need lighting (Earth is its own
 * source of imagery here, not a lit object).
 */
function buildEarth() {
  if (LOW_END) return;
  const tex = getSharedTexture('textures/earth.png');
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false
  });
  const geom = new THREE.SphereGeometry(40, 32, 24);
  const earth = new THREE.Mesh(geom, mat);
  // Place high in the south-west sky; far enough away that the player
  // can't walk around it. Walk-mode camera is around y=4 so y=180 puts
  // it well above the horizon.
  earth.position.set(-220, 180, -260);
  // Tilt so the continents face the camera at typical pitch.
  earth.rotation.set(-0.3, 0.4, 0);
  scene.add(earth);
  disposables.push({ geometry: geom, material: mat });
}

function buildAstronaut() {
  astronaut = new THREE.Group();

  const suitMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f4 });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0xc9c9cf });
  const visorMat = new THREE.MeshLambertMaterial({ color: 0x1a1a22, emissive: 0x332a14 });
  const packMat = new THREE.MeshLambertMaterial({ color: 0xb0b0b8 });
  disposables.push({ material: suitMat });
  disposables.push({ material: trimMat });
  disposables.push({ material: visorMat });
  disposables.push({ material: packMat });

  // Torso
  const torsoGeom = new THREE.BoxGeometry(1.4, 1.8, 0.9);
  const torso = new THREE.Mesh(torsoGeom, suitMat);
  torso.position.y = 2.3;
  astronaut.add(torso);
  disposables.push({ geometry: torsoGeom });

  // Waist belt
  const beltGeom = new THREE.BoxGeometry(1.5, 0.3, 1.0);
  const belt = new THREE.Mesh(beltGeom, trimMat);
  belt.position.y = 1.45;
  astronaut.add(belt);
  disposables.push({ geometry: beltGeom });

  // Head / helmet
  const helmetGeom = new THREE.SphereGeometry(0.75, 20, 14);
  const helmet = new THREE.Mesh(helmetGeom, suitMat);
  helmet.position.y = 3.55;
  astronaut.add(helmet);
  disposables.push({ geometry: helmetGeom });

  // Visor — a smaller sphere offset forward so only a "lens" peeks out
  const visorGeom = new THREE.SphereGeometry(0.72, 20, 14,
    0, Math.PI, Math.PI * 0.35, Math.PI * 0.3);
  const visor = new THREE.Mesh(visorGeom, visorMat);
  visor.position.y = 3.55;
  visor.rotation.y = Math.PI;
  astronaut.add(visor);
  disposables.push({ geometry: visorGeom });

  // Oxygen pack on the back (+Z in local space is back because forward is -Z)
  const packGeom = new THREE.BoxGeometry(1.2, 1.5, 0.5);
  const pack = new THREE.Mesh(packGeom, packMat);
  pack.position.set(0, 2.3, 0.65);
  astronaut.add(pack);
  disposables.push({ geometry: packGeom });

  // Arms — each a Group so we can swing from the shoulder
  const armGeom = new THREE.CylinderGeometry(0.22, 0.22, 1.6, 10);
  armGeom.translate(0, -0.8, 0);
  disposables.push({ geometry: armGeom });

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.85, 3.0, 0);
  leftArm.add(new THREE.Mesh(armGeom, suitMat));
  astronaut.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.85, 3.0, 0);
  rightArm.add(new THREE.Mesh(armGeom, suitMat));
  astronaut.add(rightArm);

  // Legs — same trick
  const legGeom = new THREE.CylinderGeometry(0.28, 0.28, 1.5, 10);
  legGeom.translate(0, -0.75, 0);
  disposables.push({ geometry: legGeom });

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.4, 1.3, 0);
  leftLeg.add(new THREE.Mesh(legGeom, suitMat));
  astronaut.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.4, 1.3, 0);
  rightLeg.add(new THREE.Mesh(legGeom, suitMat));
  astronaut.add(rightLeg);

  // Feet
  const footGeom = new THREE.BoxGeometry(0.55, 0.22, 0.8);
  disposables.push({ geometry: footGeom });
  const lf = new THREE.Mesh(footGeom, trimMat);
  lf.position.set(0, -1.45, 0.1);
  leftLeg.add(lf);
  const rf = new THREE.Mesh(footGeom, trimMat);
  rf.position.set(0, -1.45, 0.1);
  rightLeg.add(rf);

  astronautParts = { leftArm, rightArm, leftLeg, rightLeg };

  scene.add(astronaut);

  // Async upgrade to the NASA Mercury Spacesuit GLB. Static mesh — no
  // skeleton — so updateWalkAnim() drives a procedural bob + sway in
  // place of limb swings. Fallback path keeps the procedural humanoid.
  loadModel(MODEL_PATHS.spacesuit)
    .then(model => {
      if (!astronaut) return;             // mode already exited
      placeOnGround(model, 0, 0, 0, 3.2);
      astronaut.add(model);
      astronautModel = model;
      // Hide every procedural mesh under the astronaut group (helmet,
      // torso, limbs, feet) without removing them — keeps disposables
      // intact and lets us flip back if needed.
      astronaut.traverse(child => {
        if (child === astronaut || child === model) return;
        if (model.getObjectById(child.id)) return;  // descendant of new model
        if (child.isMesh || child.isGroup) child.visible = false;
      });
      astronautProceduralVisible = false;
      console.log('[WalkMode] Mercury Spacesuit GLB active');
    })
    .catch(() => { /* procedural humanoid keeps the role */ });
}

function updateWalkAnim(dt, moving) {
  if (moving) walkPhase += dt * 7;
  // Procedural humanoid → swing limbs (only when those meshes are still
  // visible; the spacesuit GLB hides them in favor of a different motion).
  if (astronautProceduralVisible && astronautParts) {
    const swing = moving ? Math.sin(walkPhase) * 0.7 : 0;
    astronautParts.leftLeg.rotation.x  =  swing;
    astronautParts.rightLeg.rotation.x = -swing;
    astronautParts.leftArm.rotation.x  = -swing * 0.6;
    astronautParts.rightArm.rotation.x =  swing * 0.6;
  }
  // Mercury Spacesuit GLB is unrigged — bones and skin weights aren't
  // baked in, so we can't drive limb deformation at runtime. Substitute a
  // procedural BOB (vertical bounce) + SWAY (subtle z-roll) tied to the
  // walk phase. Reads as motion without claiming to be limb animation.
  // Reset to neutral while idle so the suit settles cleanly.
  if (astronautModel) {
    astronautModel.position.y = moving ? Math.sin(walkPhase) * 0.12 : 0;
    astronautModel.rotation.z = moving ? Math.sin(walkPhase * 2) * 0.04 : 0;
  }
}

function buildParkedLander() {
  // Visual continuity: reuse the same texture as the flying lander, shared
  // via AssetCache so we don't upload the PNG twice on low-memory devices.
  // Stays as the fallback while the Apollo Lunar Module GLB tries to load.
  const tex = getSharedTexture('textures/lander.png');
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const size = LANDER_SCALE * 0.8;
  landerModel = new THREE.Sprite(mat);
  landerModel.scale.set(size, size, 1);
  const lx = 0, lz = 0;
  landerModel.position.set(lx, groundHeight(lx, lz) + size * 0.453, lz);
  scene.add(landerModel);
  disposables.push({ material: mat });

  // Async upgrade to the NASA Apollo Lunar Module GLB. If it loads, hide
  // the sprite and add the model as a sibling at the same world spot.
  loadModel(MODEL_PATHS.apolloLM)
    .then(model => {
      if (!scene) return;                 // mode already exited
      landerModel3D = model;
      placeOnGround(model, lx, lz, groundHeight(lx, lz), LANDER_SCALE * 0.7);
      scene.add(model);
      // Hide the placeholder sprite. Keep landerModel as the proximity
      // anchor so existing distance checks (boarding, breadcrumb origin)
      // keep working without changes.
      landerModel.visible = false;
      console.log('[WalkMode] Apollo Lunar Module GLB active');
    })
    .catch(() => { /* keep sprite fallback — already placed */ });
}

/**
 * Plant a tall yellow pillar over the parked lander. Visible from across
 * the play area so the player has a constant reference point for "home"
 * regardless of where their wandering took them. Mirrors the destination
 * pillar style used by `buildTrailMarkers()` but taller, brighter, and
 * always on (not gated on a specific interactable being alive).
 */
function buildLanderBeacon() {
  if (!landerModel) return;
  const lx = landerModel.position.x;
  const lz = landerModel.position.z;
  const geom = new THREE.CylinderGeometry(
    LANDER_BEACON_RADIUS, LANDER_BEACON_RADIUS, LANDER_BEACON_HEIGHT, 8
  );
  const mat  = new THREE.MeshBasicMaterial({
    color: LANDER_BEACON_COLOR,
    transparent: true,
    opacity: LANDER_BEACON_OPACITY,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(lx, groundHeight(lx, lz) + LANDER_BEACON_HEIGHT / 2, lz);
  scene.add(mesh);
  disposables.push({ geometry: geom, material: mat });
}

// ---------- Phase-4 interactable system ----------

/**
 * Walk-scene loot is seeded by the metadata stashed on GameState.lastLanding
 * when the lander touched down. The pad KIND drives what appears:
 *   - 'beginner' → a fuel drum near spawn (reward advertised in 2D)
 *   - 'bonus'    → a science sample near spawn (extra on top of the score
 *                  multiplier you already banked)
 *   - 'plain'    → no automatic loot; the landing is its own reward
 * Apollo 11 is always placed (fixed world position) so there's always a
 * named destination to walk to regardless of where you landed.
 */
function spawnInteractables() {
  const ll = GameState.lastLanding;

  // Pad-kind extras (variable per landing). At level >= 1 these are the
  // primary loot; level 0 also gets the curated LEVEL1_FIXED_LOOT below.
  if (ll.padKind === 'beginner') {
    const it = buildInteractable('fuel', 12, 8);
    if (it) interactables.push(it);
  } else if (ll.padKind === 'bonus') {
    const it = buildInteractable('sample', 12, 8);
    if (it) interactables.push(it);
  }

  // Level 1 (GameState.level === 0): curated fixed-location loot so a new
  // player always has the same layout to learn from. Higher levels skip
  // this set so the moon feels less crowded and the run leans more on
  // procedural placement.
  if (GameState.level === 0) {
    for (const [type, x, z] of LEVEL1_FIXED_LOOT) {
      const it = buildInteractable(type, x, z);
      if (it) interactables.push(it);
    }
  }

  // Current-level Apollo landmark + a repair part next to it. The Apollo
  // site rotates by GameState.level (level 0 = Apollo 11, level 1 =
  // Apollo 12). The repair part offers a tangible reason to walk there:
  // pick it up, carry it back to the lander, restore HP.
  const currentSite = apolloSiteForLevel(GameState.level);
  if (currentSite) {
    const [sx, sz] = currentSite.walkPos;
    const apollo = buildApolloSite(currentSite, sx, sz);
    if (apollo) interactables.push(apollo);
    const part = buildInteractable('part', sx + 6, sz + 4);
    if (part) interactables.push(part);
    // Each Apollo site also has a health pack — a "for me" reward to pair
    // with the "for the lander" repair part.
    const pack = buildInteractable('healthpack', sx - 6, sz + 4);
    if (pack) interactables.push(pack);
  }

  // Static landmarks (habitats + Atlas 6) — each tries to load its NASA
  // GLB; on failure or LOW_END the placeholder primitive stays.
  for (const spec of LANDMARKS) {
    const [sx, sz] = spec.walkPos;
    const it = buildLandmark(spec, sx, sz);
    if (it) interactables.push(it);
  }

  // Persisted drops from prior walk sessions / runs. The astronaut left
  // these on the moon — they sit at the same world coords until picked
  // back up. Tagged with `droppedId` so performInteraction can remove
  // the matching GameState.droppedItems entry on pickup.
  for (const drop of (GameState.droppedItems || [])) {
    const it = buildInteractable(drop.type, drop.x, drop.z);
    if (it) {
      it.droppedId = drop.id;
      interactables.push(it);
    }
  }

  // Breadcrumb rings from the parked lander to each interactable so the
  // player has cues on where to walk. Built after everything exists.
  for (const it of interactables) {
    it.trailMarkers = buildTrailMarkers(landerModel.position, it.object3d.position, it.type);
  }
  console.log(
    `ℹ️ Spawned ${interactables.length} interactables for pad kind "${ll.padKind}"`
  );
}

/**
 * Drop one item of `GameState.carrying[idx]` at the astronaut's current
 * xz. The dropped item becomes a fresh interactable in the world and a
 * persisted entry in `GameState.droppedItems` (so it respawns next walk
 * session, even across runs). Fires from the HUD CARRY-row tap handler.
 */
function dropCarryItem(idx) {
  if (!astronaut || !scene) return;
  const item = GameState.carrying?.[idx];
  if (!item) return;
  const x = astronaut.position.x;
  const z = astronaut.position.z;
  let dropEntry;
  updateState(s => {
    s.carrying.splice(idx, 1);
    if (!s.droppedItems) s.droppedItems = [];
    if (!s.nextDropId)   s.nextDropId   = 1;
    dropEntry = { id: s.nextDropId++, type: item.type, x, z };
    s.droppedItems.push(dropEntry);
  }, 'drop');

  const it = buildInteractable(item.type, x, z);
  if (it) {
    it.droppedId = dropEntry.id;
    it.trailMarkers = buildTrailMarkers(landerModel.position, it.object3d.position, it.type);
    interactables.push(it);
  }
  showComms(`DROPPED ${item.type.toUpperCase()}`);
}

function buildInteractable(type, x, z) {
  const spec = INTERACTABLE_TYPES[type];
  if (!spec) { console.warn(`Unknown interactable type: ${type}`); return null; }

  const group = new THREE.Group();
  group.position.set(x, groundHeight(x, z), z);

  let spin = 0;
  switch (type) {
    case 'fuel':    buildFuelDrum(group, spec);    break;
    case 'repair':  buildRepairCrate(group, spec); break;
    case 'sample':  buildSample(group, spec);      spin = 1.2; break;
    case 'damaged': buildDamagedProbe(group, spec); break;
    case 'part':    buildRepairPart(group, spec);  spin = 0.6; break;
    case 'healthpack': buildHealthPack(group, spec); spin = 0.4; break;
  }

  scene.add(group);
  return { type, object3d: group, used: false, spin, trailMarkers: [] };
}

/**
 * Drop a chain of small dim rings on the ground from `start` to `end`. Each
 * ring is colored to match the destination interactable so the player can
 * tell the trails apart at a glance. Returns the meshes so the caller can
 * hide them when the interactable is consumed.
 */
function buildTrailMarkers(start, end, type) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 4) return [];                  // too close to need a trail

  // Denser + bigger + brighter than the previous version so players can
  // actually see them from across the playable radius. ~1 marker every 2
  // world units, capped 6–18.
  const count = Math.max(6, Math.min(18, Math.round(dist / 2)));
  const ringGeom = new THREE.RingGeometry(0.9, 1.6, 24);
  ringGeom.rotateX(-Math.PI / 2);
  const color = INTERACTABLE_TYPES[type]?.color ?? 0xffee88;
  const ringMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85,
    side: THREE.DoubleSide, depthWrite: false
  });
  disposables.push({ geometry: ringGeom, material: ringMat });

  const markers = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const mx = start.x + dx * t;
    const mz = start.z + dz * t;
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.set(mx, groundHeight(mx, mz) + 0.08, mz);
    scene.add(ring);
    markers.push(ring);
  }

  // Beacon pillar at the destination — a thin tall bar of the same color
  // visible from far away. Hidden along with the trail when the
  // interactable is consumed.
  const beaconGeom = new THREE.CylinderGeometry(0.18, 0.18, 8, 8);
  const beaconMat  = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.55, depthWrite: false
  });
  const beacon = new THREE.Mesh(beaconGeom, beaconMat);
  beacon.position.set(end.x, groundHeight(end.x, end.z) + 4, end.z);
  scene.add(beacon);
  markers.push(beacon);
  disposables.push({ geometry: beaconGeom, material: beaconMat });

  return markers;
}

function hideTrailMarkers(it) {
  if (!it?.trailMarkers) return;
  for (const m of it.trailMarkers) m.visible = false;
}

function buildFuelDrum(group, spec) {
  const bodyGeom = new THREE.CylinderGeometry(0.85, 0.85, 2.2, 18);
  const bodyMat  = new THREE.MeshLambertMaterial({ color: spec.color });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 1.1;
  group.add(body);
  disposables.push({ geometry: bodyGeom, material: bodyMat });

  const capGeom = new THREE.CylinderGeometry(0.9, 0.9, 0.12, 18);
  const capMat  = new THREE.MeshLambertMaterial({ color: 0x3a3a3f });
  disposables.push({ geometry: capGeom, material: capMat });
  const top = new THREE.Mesh(capGeom, capMat);    top.position.y = 2.25;
  const bot = new THREE.Mesh(capGeom, capMat);    bot.position.y = 0.06;
  group.add(top, bot);

  const stripeGeom = new THREE.BoxGeometry(1.72, 0.18, 0.05);
  const stripeMat  = new THREE.MeshLambertMaterial({ color: 0x222226 });
  disposables.push({ geometry: stripeGeom, material: stripeMat });
  const s1 = new THREE.Mesh(stripeGeom, stripeMat); s1.position.set(0, 1.7, 0.86);
  const s2 = new THREE.Mesh(stripeGeom, stripeMat); s2.position.set(0, 0.5, 0.86);
  group.add(s1, s2);
}

function buildRepairCrate(group, spec) {
  const bodyGeom = new THREE.BoxGeometry(1.8, 1.3, 1.8);
  const bodyMat  = new THREE.MeshLambertMaterial({ color: spec.color });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 0.65;
  group.add(body);
  disposables.push({ geometry: bodyGeom, material: bodyMat });

  // Red cross on top
  const crossMat = new THREE.MeshLambertMaterial({ color: 0xd43a2a });
  const crossH = new THREE.BoxGeometry(1.2, 0.1, 0.3);
  const crossV = new THREE.BoxGeometry(0.3, 0.1, 1.2);
  disposables.push({ material: crossMat });
  disposables.push({ geometry: crossH });
  disposables.push({ geometry: crossV });
  const ch = new THREE.Mesh(crossH, crossMat); ch.position.y = 1.36;
  const cv = new THREE.Mesh(crossV, crossMat); cv.position.y = 1.36;
  group.add(ch, cv);
}

function buildSample(group, spec) {
  const geom = new THREE.IcosahedronGeometry(0.65, 0);
  const mat = new THREE.MeshLambertMaterial({
    color: spec.color, emissive: 0x1a4060, emissiveIntensity: 0.6
  });
  const crystal = new THREE.Mesh(geom, mat);
  crystal.position.y = 1.2;
  group.add(crystal);
  disposables.push({ geometry: geom, material: mat });

  // Small pedestal so the sample reads as "placed", not "floating debris"
  const padGeom = new THREE.CylinderGeometry(0.7, 0.7, 0.15, 14);
  const padMat  = new THREE.MeshLambertMaterial({ color: 0x555560 });
  const pad = new THREE.Mesh(padGeom, padMat);
  pad.position.y = 0.08;
  group.add(pad);
  disposables.push({ geometry: padGeom, material: padMat });
}

function buildDamagedProbe(group, spec) {
  const bodyGeom = new THREE.BoxGeometry(2.2, 1.5, 2.2);
  const bodyMat  = new THREE.MeshLambertMaterial({ color: spec.color });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 0.75;
  group.add(body);
  // Tag for color-swap on repair
  body.userData.role = 'hull';
  disposables.push({ geometry: bodyGeom, material: bodyMat });

  // Hazard stripes — two thin yellow bands wrapped around the hull
  const stripeMat = new THREE.MeshLambertMaterial({ color: 0xffd736 });
  disposables.push({ material: stripeMat });
  const stripeGeom = new THREE.BoxGeometry(2.26, 0.18, 2.26);
  disposables.push({ geometry: stripeGeom });
  const s1 = new THREE.Mesh(stripeGeom, stripeMat); s1.position.y = 1.15;
  const s2 = new THREE.Mesh(stripeGeom, stripeMat); s2.position.y = 0.35;
  group.add(s1, s2);

  // Broken antenna — tilted cylinder
  const antGeom = new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8);
  const antMat  = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
  disposables.push({ geometry: antGeom, material: antMat });
  const ant = new THREE.Mesh(antGeom, antMat);
  ant.position.set(0.7, 2.0, 0);
  ant.rotation.z = -0.5;
  group.add(ant);
}

/**
 * Repair-part interactable. A small green octahedron on a pedestal — picks
 * up into the carrying inventory; deposit at the lander to restore HP.
 */
function buildRepairPart(group, spec) {
  const geom = new THREE.OctahedronGeometry(0.6, 0);
  const mat = new THREE.MeshLambertMaterial({
    color: spec.color, emissive: 0x123a18, emissiveIntensity: 0.55
  });
  const crystal = new THREE.Mesh(geom, mat);
  crystal.position.y = 1.2;
  group.add(crystal);
  disposables.push({ geometry: geom, material: mat });

  const padGeom = new THREE.CylinderGeometry(0.7, 0.7, 0.15, 14);
  const padMat  = new THREE.MeshLambertMaterial({ color: 0x444450 });
  const pad = new THREE.Mesh(padGeom, padMat);
  pad.position.y = 0.08;
  group.add(pad);
  disposables.push({ geometry: padGeom, material: padMat });
}

/**
 * Health-pack interactable. A pink medical-cross box, picked up directly
 * (no carry / stow step) — heals the astronaut on touch. Spawned next to
 * the current Apollo site alongside the repair part so the player has
 * both a "for the lander" and "for me" reward at each destination.
 */
function buildHealthPack(group, spec) {
  const bodyGeom = new THREE.BoxGeometry(1.2, 1.0, 1.2);
  const bodyMat  = new THREE.MeshLambertMaterial({ color: spec.color });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 0.55;
  group.add(body);
  disposables.push({ geometry: bodyGeom, material: bodyMat });

  // White medical cross on top
  const crossMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  disposables.push({ material: crossMat });
  const armH = new THREE.BoxGeometry(0.85, 0.06, 0.22);
  const armV = new THREE.BoxGeometry(0.22, 0.06, 0.85);
  disposables.push({ geometry: armH });
  disposables.push({ geometry: armV });
  const ch = new THREE.Mesh(armH, crossMat); ch.position.y = 1.08;
  const cv = new THREE.Mesh(armV, crossMat); cv.position.y = 1.08;
  group.add(ch, cv);
}

/**
 * Apollo landing-site landmark. Builds a small ensemble visible from a
 * distance: descent-stage silhouette, a pole with an American flag, and a
 * small commemorative plaque. Returned as a regular interactable record
 * with `type: 'apollo'` so performInteraction() can route it.
 */
function buildApolloSite(site, x, z) {
  const group = new THREE.Group();
  group.position.set(x, groundHeight(x, z), z);

  // Descent stage — a stubby octagonal block to represent the lander base
  // left behind at the site.
  const baseGeom = new THREE.CylinderGeometry(1.5, 1.7, 1.2, 8);
  const baseMat  = new THREE.MeshLambertMaterial({ color: 0x8a8a90 });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.6;
  group.add(base);
  disposables.push({ geometry: baseGeom, material: baseMat });

  // Async upgrade: replace the cylinder placeholder with a smaller copy
  // of the Apollo Lunar Module GLB so the Apollo 11 site reads as the
  // actual descent stage left behind. Falls back silently if the GLB
  // isn't available.
  loadModel(MODEL_PATHS.apolloLM)
    .then(model => {
      if (!group.parent) return;
      placeOnGround(model, 0, 0, 0, 5);
      group.add(model);
      base.visible = false;
    })
    .catch(() => { /* keep the cylinder placeholder */ });

  // Flag pole + cloth
  const poleGeom = new THREE.CylinderGeometry(0.06, 0.06, 4.5, 8);
  const poleMat  = new THREE.MeshLambertMaterial({ color: 0xdadade });
  const pole = new THREE.Mesh(poleGeom, poleMat);
  pole.position.set(1.8, 2.25, 0);
  group.add(pole);
  disposables.push({ geometry: poleGeom, material: poleMat });

  // Flag cloth — stiff (no wind on the moon) rectangle. Painted with a
  // CanvasTexture so we avoid needing an extra asset file.
  const flagCanvas = document.createElement('canvas');
  flagCanvas.width = 96;
  flagCanvas.height = 60;
  const fctx = flagCanvas.getContext('2d');
  fctx.fillStyle = '#cc2233'; fctx.fillRect(0, 0, 96, 60);
  fctx.fillStyle = '#ffffff';
  for (let i = 1; i < 7; i += 2) fctx.fillRect(0, i * (60 / 7), 96, 60 / 7);
  fctx.fillStyle = '#1a3a8a'; fctx.fillRect(0, 0, 36, 28);
  fctx.fillStyle = '#ffffff';
  for (let ry = 0; ry < 4; ry++) for (let rx = 0; rx < 5; rx++) {
    fctx.fillRect(3 + rx * 7, 3 + ry * 7, 2, 2);
  }
  const flagTex = new THREE.CanvasTexture(flagCanvas);
  flagTex.magFilter = THREE.NearestFilter;
  const flagMat  = new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide });
  const flagGeom = new THREE.PlaneGeometry(1.8, 1.1);
  const flag = new THREE.Mesh(flagGeom, flagMat);
  flag.position.set(2.7, 3.9, 0);
  group.add(flag);
  disposables.push({ geometry: flagGeom, material: flagMat, texture: flagTex });

  // Plaque: small dark block with a pale top strip.
  const plaqueGeom = new THREE.BoxGeometry(1.4, 0.8, 0.15);
  const plaqueMat  = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
  const plaque = new THREE.Mesh(plaqueGeom, plaqueMat);
  plaque.position.set(-1.6, 1.3, 0);
  group.add(plaque);
  disposables.push({ geometry: plaqueGeom, material: plaqueMat });
  const stripGeom = new THREE.BoxGeometry(1.35, 0.22, 0.16);
  const stripMat  = new THREE.MeshLambertMaterial({ color: 0xd0d0d5 });
  const strip = new THREE.Mesh(stripGeom, stripMat);
  strip.position.set(-1.6, 1.62, 0);
  group.add(strip);
  disposables.push({ geometry: stripGeom, material: stripMat });

  scene.add(group);
  return {
    type: 'apollo',
    object3d: group,
    used: false,
    spin: 0,
    apollo: site,
    trailMarkers: []
  };
}

/**
 * Build a static-landmark interactable (habitat / Atlas 6 / etc.). The
 * primitive placeholder appears immediately; the NASA GLB swaps in once
 * loadModel() resolves. Either way the same interactable record is
 * returned so the breadcrumb-trail + tap-to-interact flow doesn't care.
 */
function buildLandmark(spec, x, z) {
  const group = new THREE.Group();
  group.position.set(x, groundHeight(x, z), z);

  // Primitive placeholder: a chunky vertical capsule so the player sees
  // SOMETHING at the spot before the GLB lands. Different colors per
  // landmark kind keep them distinguishable on a low-end / offline boot.
  const placeholderColor =
    spec.kind === 'habitat' ? 0xc0c0c8 :
    spec.kind === 'atlas'   ? 0xeeeeee : 0x9999aa;
  const ph = makeLandmarkPlaceholder(spec, placeholderColor);
  group.add(ph);

  scene.add(group);

  // Async upgrade to the GLB.
  const path = MODEL_PATHS[spec.model];
  if (path) {
    loadModel(path)
      .then(model => {
        if (!scene) return;
        // Compute the right scale + ground placement, then attach to the
        // landmark group so it shares the group's position.
        placeOnGround(model, 0, 0, 0, spec.targetHeight ?? 5);
        group.add(model);
        ph.visible = false;
        console.log(`[WalkMode] ${spec.id} GLB active`);
      })
      .catch(() => { /* placeholder stays visible */ });
  }

  return {
    type: 'landmark',
    object3d: group,
    used: false,
    spin: 0,
    landmark: spec,
    trailMarkers: []
  };
}

/**
 * Distinct primitive placeholder per landmark kind so something visible
 * appears at the spot before the GLB resolves.
 */
function makeLandmarkPlaceholder(spec, color) {
  let geom;
  if (spec.kind === 'atlas') {
    // Tall capsule for the rocket — narrow + tall.
    geom = new THREE.CylinderGeometry(0.7, 1.0, spec.targetHeight ?? 12, 12);
  } else if (spec.kind === 'habitat') {
    // Stout dome-ish cylinder for the habitat module.
    geom = new THREE.CylinderGeometry(2.2, 2.4, spec.targetHeight ?? 5, 14);
  } else {
    geom = new THREE.BoxGeometry(2, 3, 2);
  }
  const mat = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = (spec.targetHeight ?? 5) / 2;
  disposables.push({ geometry: geom, material: mat });
  return mesh;
}

function pickClosestInteractable() {
  let best = null;
  let bestDist = WALK_INTERACT_RADIUS;
  for (const it of interactables) {
    if (it.used && it.type !== 'damaged') continue;
    const d = astronaut.position.distanceTo(it.object3d.position);
    if (d < bestDist) { best = it; bestDist = d; }
  }
  return best;
}

function promptFor(it) {
  if (it.type === 'apollo') {
    return it.apollo.name;
  }
  if (it.type === 'landmark') {
    return it.used ? '' : it.landmark.name;
  }
  const spec = INTERACTABLE_TYPES[it.type];
  if (it.type === 'damaged') {
    if (it.used) return '';  // already repaired, no prompt
    return GameState.supplies.repairKits >= spec.costKits
      ? spec.promptReady
      : spec.promptBlocked;
  }
  return spec.prompt;
}

function performInteraction(it) {
  let justDone = [];

  // Apollo landmarks aren't in INTERACTABLE_TYPES — they live on the site
  // record itself (from APOLLO_SITES). Handle them first and bail.
  if (it.type === 'apollo') {
    const gain = it.apollo.artifactScore | 0;
    const wasFirstApollo = !Object.values(GameState.flags.apolloVisited || {}).some(Boolean);
    updateState(s => {
      s.score += gain;
      // Mark this Apollo site visited so the level's "Visit X" objective
      // predicate flips true on the next refresh.
      s.flags.apolloVisited = s.flags.apolloVisited || {};
      s.flags.apolloVisited[it.apollo.id] = true;
      justDone = refreshObjectives();
    }, 'pickup-apollo');
    showComms(it.apollo.comms || `+${gain} SCORE — APOLLO ARTIFACT`);
    if (wasFirstApollo) showMissionMessage('firstApollo');
    it.used = true;
    // Leave the landmark standing so the player sees it on repeat visits;
    // just hide its breadcrumb trail.
    hideTrailMarkers(it);
    if (justDone.length) {
      setTimeout(() => showComms(`OBJECTIVE COMPLETE: ${firstObjectiveLabel(justDone[0])}`), 1100);
    }
    return;
  }

  // Static landmarks (habitats, Atlas 6) — same shape as Apollo: score +
  // comms, leave the model standing.
  if (it.type === 'landmark') {
    const gain = it.landmark.score | 0;
    // Habitats double as a heal stop. One-time per habitat (existing
    // 'used' marker takes care of that), tops up astronaut HP up to maxHp.
    const isHabitat = it.landmark.kind === 'habitat';
    const wasFirstHabitat = isHabitat && !GameState.flags.habitatVisited;
    let healed = 0;
    updateState(s => {
      s.score += gain;
      if (isHabitat) {
        const room = s.astronaut.maxHp - s.astronaut.hp;
        healed = Math.min(HABITAT_HEAL_AMOUNT, room);
        s.astronaut.hp = Math.min(s.astronaut.maxHp, s.astronaut.hp + healed);
        s.flags.habitatVisited = true;          // Apollo 14 objective hook
      }
      justDone = refreshObjectives();
    }, 'pickup-landmark');
    const healSuffix = healed > 0 ? ` · +${healed} HEALTH` : '';
    showComms((it.landmark.comms || `+${gain} SCORE — ${it.landmark.name}`) + healSuffix);
    if (wasFirstHabitat) showMissionMessage('habitatReached');
    it.used = true;
    hideTrailMarkers(it);
    if (justDone.length) {
      setTimeout(() => showComms(`OBJECTIVE COMPLETE: ${firstObjectiveLabel(justDone[0])}`), 1100);
    }
    return;
  }

  const spec = INTERACTABLE_TYPES[it.type];

  switch (it.type) {
    case 'fuel': {
      // No more auto-deposit. Carrying it back to the lander is the loop.
      const scaled = effectiveFuelGain(GameState.level, spec.amount);
      updateState(s => {
        s.carrying.push({ type: 'fuel', amount: scaled });
        justDone = refreshObjectives();
      }, 'pickup-fuel');
      showComms(`PICKED UP FUEL DRUM (+${scaled | 0} ON STOW)`);
      break;
    }
    case 'part': {
      // Repair part — carry to the lander to restore HP.
      const hp = spec.hp || LANDER_REPAIR_PER_PART;
      updateState(s => {
        s.carrying.push({ type: 'part', amount: hp });
        justDone = refreshObjectives();
      }, 'pickup-part');
      showComms(`PICKED UP REPAIR PART (+${hp} HP ON STOW)`);
      break;
    }
    case 'healthpack': {
      // Health pack — instant astronaut HP top-up (no carry step,
      // since the suit's medical kit is, lore-wise, applied on the spot).
      const cap   = GameState.astronaut.maxHp;
      const room  = cap - GameState.astronaut.hp;
      const hp    = spec.hp || HEALTH_PACK_AMOUNT;
      const gained = Math.min(hp, room);
      if (gained <= 0) {
        showComms('HEALTH ALREADY FULL');
        return;     // bail without consuming the pack
      }
      updateState(s => {
        s.astronaut.hp = Math.min(cap, s.astronaut.hp + gained);
        justDone = refreshObjectives();
      }, 'pickup-healthpack');
      showComms(`+${gained | 0} HEALTH`);
      break;
    }
    case 'repair': {
      updateState(s => {
        s.supplies.repairKits += spec.amount;
        justDone = refreshObjectives();
      }, 'pickup-repair');
      showComms('REPAIR KIT STOWED');
      break;
    }
    case 'sample': {
      updateState(s => {
        s.supplies.scienceSamples += 1;
        s.stats.totalSamples += 1;
        s.score += spec.score;
        justDone = refreshObjectives();
      }, 'pickup-sample');
      showComms(`SAMPLE LOGGED (+${spec.score})`);
      if (GameState.stats.totalSamples >= 10) {
        showAchievementToast(unlockAchievement('sample-collector'));
      }
      break;
    }
    case 'damaged': {
      if (GameState.supplies.repairKits < spec.costKits) {
        showComms('PROBE NEEDS A REPAIR KIT');
        return;
      }
      updateState(s => {
        s.supplies.repairKits -= spec.costKits;
        s.stats.totalProbesRepaired += 1;
        s.score += spec.score;
        s.flags.probeRepaired = true;
        justDone = refreshObjectives();
      }, 'probe-repair');
      showComms(`PROBE RECOVERED (+${spec.score})`);
      it.object3d.traverse(child => {
        if (child.isMesh && child.userData.role === 'hull') {
          child.material.color.set(0x3ec46c);
        }
      });
      if (GameState.stats.totalProbesRepaired >= 3) {
        showAchievementToast(unlockAchievement('probe-rescuer'));
      }
      break;
    }
  }

  it.used = true;
  if (it.type !== 'damaged') it.object3d.visible = false;
  // Cue trail leading to this interactable is no longer useful — hide the
  // breadcrumb rings so the player isn't drawn back to a finished objective.
  hideTrailMarkers(it);
  // If this interactable was a player-dropped item, take it off the
  // persisted droppedItems list so it doesn't respawn on the next
  // walk session.
  if (it.droppedId != null) {
    updateState(s => {
      s.droppedItems = (s.droppedItems || []).filter(d => d.id !== it.droppedId);
    }, 'drop-pickup');
  }

  if (justDone.length) {
    setTimeout(() => showComms(`OBJECTIVE COMPLETE: ${firstObjectiveLabel(justDone[0])}`), 1100);
  }
}

function firstObjectiveLabel(id) {
  const o = GameState.objectives.find(x => x.id === id);
  return o ? o.label.toUpperCase() : id;
}

/**
 * Apply every item in GameState.carrying to the lander and clear the
 * carry stack. Fuel goes into the tank (capped); repair parts add HP
 * (capped at maxHp). Surfaces a single comms summary so the player
 * sees what changed.
 */
function stowCarryAtLander() {
  if (!GameState.carrying || GameState.carrying.length === 0) return;
  let fuelGained = 0;
  let hpGained = 0;
  let partsStowedThisTrip = 0;
  updateState(s => {
    for (const item of s.carrying) {
      if (item.type === 'fuel') {
        const room = s.fuel.capacity - s.fuel.current;
        const got = Math.min(item.amount, room);
        s.fuel.current += got;
        fuelGained += got;
      } else if (item.type === 'part') {
        const room = s.lander.maxHp - s.lander.hp;
        const got = Math.min(item.amount, room);
        s.lander.hp += got;
        hpGained += got;
        partsStowedThisTrip += 1;
      }
    }
    s.stats.partsStowed = (s.stats.partsStowed | 0) + partsStowedThisTrip;
    s.carrying = [];
    if (s.isAlerted && s.fuel.current >= s.fuel.capacity * 0.3) s.isAlerted = false;
    // Snapshot for the carry-summary beat shown during the walk→lander
    // cinematic (Batch 4 #11). TransitionMode reads + clears.
    s.lastStowed = {
      fuel: fuelGained | 0,
      hp:   hpGained   | 0,
      parts: partsStowedThisTrip | 0,
      at:   Date.now()
    };
  }, 'stow-cargo');

  // Hot-swap achievement still applies on stow if the player landed
  // dangerously low and refueled past the high threshold.
  if (fuelGained > 0 &&
      (GameState.lastLanding.fuelAtLanding ?? Infinity) < HOT_SWAP_LOW_FUEL &&
      GameState.fuel.current >= HOT_SWAP_HIGH_FUEL) {
    showAchievementToast(unlockAchievement('hot-swap-refuel'));
  }

  const parts = [];
  if (fuelGained > 0) parts.push(`+${fuelGained | 0} FUEL`);
  if (hpGained > 0)   parts.push(`+${hpGained | 0} HP`);
  showComms(parts.length ? `STOWED — ${parts.join(' · ')}` : 'NOTHING TO STOW');
  // Mission Control narrative beat — "fuelStowed" if any fuel went in,
  // else "partStowed" if HP went up. We don't double-fire when both
  // happened in one stow.
  if (fuelGained > 0)      showMissionMessage('fuelStowed');
  else if (hpGained > 0)   showMissionMessage('partStowed');
}
