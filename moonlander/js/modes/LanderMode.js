// modes/LanderMode.js — v0.1.0
// The classic lunar-lander side-view, now rendered with a 3D scene and an
// ORTHOGRAPHIC camera locked to the x/y plane. Visually indistinguishable
// from the tblazevic 2D version, but the lander itself is a THREE.Object3D
// whose position/rotation we can hand off seamlessly to the walk mode.
//
// STUBBED AREAS (marked with TODO) are left as clean insertion points:
//   - Starfield background
//
// The jerk-based thrust physics from tblazevic IS implemented below — that's
// the piece with subtle feel we didn't want to lose.

import * as THREE from 'three';
import {
  GAME_WIDTH, GAME_HEIGHT, HALF_WIDTH, HALF_HEIGHT,
  LANDER_SCALE, THRUSTER_ACCEL_MAX, THRUSTER_JERK,
  ACCEL_FALLOFF_MULT, ANGULAR_VELOCITY, HORIZONTAL_DRAG_COEF,
  FUEL_CONSUMPTION_MIN, FUEL_CONSUMPTION_MAX, FUEL_ALERT_THRESHOLD,
  LANDING_ANGLE_TOLERANCE,
  MAIN_COLLIDER_SCALE, SMALL_COLLIDER_SCALE,
  FOOT_COLLIDER_OFFSET_X, FOOT_COLLIDER_OFFSET_Y,
  PAD_MULTIPLIER_WEIGHTS, SCORE_PER_LANDING,
  BEGINNER_PAD_CENTERS, BEGINNER_PAD_TOLERANCE, MIN_PAD_WIDTH,
  CAMERA_ZOOM_ALTITUDE, CAMERA_ZOOM_FACTOR,
  PERFECT_FUEL_FRAC, PERFECT_VELOCITY_MAX, PERFECT_CENTER_FRAC, PERFECT_ANGLE_MAX,
  LANDER_CRASH_DAMAGE,
  IMPACT_VELOCITY_SOFT, IMPACT_VELOCITY_HARD,
  DUST_PUFF_COUNT, DUST_PUFF_COLOR_START, DUST_PUFF_COLOR_END,
  DUST_PUFF_SPEED_MIN, DUST_PUFF_SPEED_MAX,
  DUST_PUFF_LIFETIME_MIN, DUST_PUFF_LIFETIME_MAX, DUST_PUFF_GRAVITY,
  CRASH_EXPLOSION_COUNT_MIN, CRASH_EXPLOSION_COUNT_MAX,
  CRASH_EXPLOSION_SPEED_MAX_MIN, CRASH_EXPLOSION_SPEED_MAX_MAX,
  CRASH_EXPLOSION_LIFETIME_MAX_MIN, CRASH_EXPLOSION_LIFETIME_MAX_MAX,
  CRASH_SHAKE_BASE, CRASH_SHAKE_PEAK_MUL, CRASH_SHAKE_DURATION,
  SCRAPE_VELOCITY_THRESHOLD, SCRAPE_DAMAGE_HP, SCRAPE_BOUNCE,
  SCRAPE_PARTICLE_COUNT, SCRAPE_COLOR_START, SCRAPE_COLOR_END,
  SCRAPE_SPEED_MIN, SCRAPE_SPEED_MAX,
  SCRAPE_LIFETIME_MIN, SCRAPE_LIFETIME_MAX, SCRAPE_GRAVITY, SCRAPE_COOLDOWN_S,
  ORTHO_NEAR, ORTHO_FAR, MODE, BINDINGS
} from '../Constants.js';
import { GameState, update as updateState, notify, unlockAchievement } from '../GameState.js';
import { Input } from '../Input.js';
import {
  setLanderTelemetry, setCenterMessage,
  showAchievementToast, showMissionMessage,
  showLanderTutorial, hideLanderTutorial,
  setCarryStowHandler, effectiveThrustFrac, hideInventory, showComms
} from '../HUD.js';
import * as Story from '../Story.js';
import { points as terrainPoints } from '../TerrainData.js';
import { Sounds } from '../Sound.js';
import { ParticleSystemCone, ParticleSystemExplosion } from '../Particles.js';
import { getSharedTexture } from '../AssetCache.js';
import {
  effectiveGravity, effectiveLandingVelocityTolerance, effectiveEdgeMarginFrac,
  effectiveSpawnVelocity
} from '../Progression.js';

// ----- mode-local state (reset in enter(), cleared in exit()) -----
let scene = null;
let camera = null;
let lander = null;               // THREE.Group — the visible craft
let mainCollider = null;         // child Object3D at body center
let footColliderLeft = null;     // child Object3D at left foot
let footColliderRight = null;    // child Object3D at right foot
let terrainSegments = [];        // [{ left: Vec2, right: Vec2, slope: number, multiplier: number }]
let disposables = [];            // geometries/materials/textures to dispose on exit
let thrusterParticles = null;    // ParticleSystemCone — exhaust trail
let explosionParticles = null;   // ParticleSystemExplosion — crash burst

// Scratch vectors reused each frame — avoids per-frame allocations.
const _mainWorld  = new THREE.Vector3();
const _leftWorld  = new THREE.Vector3();
const _rightWorld = new THREE.Vector3();

// physics state
let velX = 0, velY = 0;
let currentAcceleration = 0;
let onLandedCallback = null;
let onCrashedCallback = null;
let landingResolved = false;     // guard so we only resolve once per life

// Collision-visuals state. shake decays from `amplitude` over `duration`
// seconds; lastScrapeAt prevents the per-frame body-circle test from
// spamming dozens of bursts while sliding along a ridge.
let shakeAmplitude = 0;
let shakeT = 0;
let cameraBaseX = 0, cameraBaseY = 0;  // sane camera pos snapshotted before shake
let lastScrapeAt = -Infinity;
let modeElapsed = 0;             // seconds since enter() — drives scrape cooldown
let scrapeBannerClearAt = 0;     // modeElapsed at which to clear "HULL SCRAPE" text

export const LanderMode = {
  /**
   * @param {object} context - { renderer, canvas }
   * @param {object} callbacks - { onLanded(result), onCrashed(result) }
   *   Called by the mode when the life ends. Main.js wires these to trigger
   *   the transition into walk mode or the game-over screen.
   */
  enter(context, callbacks = {}) {
    console.log('▶ LanderMode.enter');
    onLandedCallback  = callbacks.onLanded  || (() => {});
    onCrashedCallback = callbacks.onCrashed || (() => {});
    landingResolved = false;
    // Reset collision-visuals state so a new life never inherits the
    // previous attempt's residual shake or scrape cooldown.
    shakeAmplitude = 0;
    shakeT = 0;
    cameraBaseX = 0;
    cameraBaseY = 0;
    lastScrapeAt = -Infinity;
    modeElapsed = 0;
    scrapeBannerClearAt = 0;
    // Clear any leftover center message from the previous life (e.g. the
    // "CRASHED ON UNEVEN TERRAIN" notice) so the next attempt boots fresh.
    setCenterMessage('');

    // Build scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Orthographic camera matching the original 800×450 "game area"
    camera = new THREE.OrthographicCamera(
      -HALF_WIDTH, HALF_WIDTH,
      HALF_HEIGHT, -HALF_HEIGHT,
      ORTHO_NEAR, ORTHO_FAR
    );
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);

    buildTerrain();
    buildLander();
    // TODO: buildStarfield();  — port tblazevic createStars()

    // Particle systems: exhaust cone tracks the lander, explosion fires on crash.
    thrusterParticles  = new ParticleSystemCone(scene, lander);
    explosionParticles = new ParticleSystemExplosion(scene, lander);
    disposables.push({ dispose: () => thrusterParticles?.dispose() });
    disposables.push({ dispose: () => explosionParticles?.dispose() });

    // Reset zoom state in case a previous life left the camera zoomed in.
    camera.zoom = 1;
    camera.position.set(0, 0, 100);
    camera.updateProjectionMatrix();

    // Initial spawn
    respawn();

    GameState.mode = MODE.LANDER;
    notify('mode');

    // Batch 5 #22 — first-time lander mode tutorial (gauges + multipliers
    // + carry-stow loop). Mirrors the walk-mode card pattern; gated by
    // GameState.flags.landerTutorialSeen so it only shows once per save.
    showLanderTutorial();

    // Wire the lander-mode inventory overlay (Rev 2 inventory bundle).
    // Tapping a row in the overlay calls back here to apply the item's
    // effect (fuel→tank, part→hull HP) and remove it from carry — which
    // in turn shaves the lander's mass for the next frame's physics.
    setCarryStowHandler((idx) => stowCarryItemInLander(idx));
  },

  exit() {
    console.log('◀ LanderMode.exit');
    Sounds.rocket?.stop();
    hideLanderTutorial();
    hideInventory();
    setCarryStowHandler(null);

    // Dispose every geometry, material, texture, and pooled subsystem.
    for (const d of disposables) {
      if (d.geometry) d.geometry.dispose();
      if (d.material) {
        if (Array.isArray(d.material)) d.material.forEach(m => m.dispose());
        else d.material.dispose();
      }
      if (d.texture) d.texture.dispose();
      if (typeof d.dispose === 'function') d.dispose();
    }
    disposables = [];
    terrainSegments = [];
    thrusterParticles = null;
    explosionParticles = null;
    shakeAmplitude = 0;
    shakeT = 0;
    cameraBaseX = 0;
    cameraBaseY = 0;
    lastScrapeAt = -Infinity;
    modeElapsed = 0;
    scrapeBannerClearAt = 0;

    // Detach lander from scene but DO NOT dispose its meshes — the transition
    // and walk mode may want to render the parked lander visually. Main.js
    // will hand it off via the sharedScene mechanism.
    scene = null;
    camera = null;
    lander = null;
    mainCollider = null;
    footColliderLeft = null;
    footColliderRight = null;
  },

  update(dt) {
    modeElapsed += dt;
    // Particles keep animating across landingResolved so the crash explosion
    // and any in-flight exhaust can finish their lifetime visibly. Camera
    // shake also keeps decaying so the impact reads kinetically against the
    // frozen scene (lander.visible is false but the explosion plays on).
    if (landingResolved) {
      if (thrusterParticles) thrusterParticles.emitting = false;
      thrusterParticles?.update(dt);
      explosionParticles?.update(dt);
      applyCameraShake(dt);
      return;
    }

    // --- rotation ---
    if (Input.isAnyDown(BINDINGS.LANDER_ROTATE_LEFT))  lander.rotation.z += ANGULAR_VELOCITY * dt;
    if (Input.isAnyDown(BINDINGS.LANDER_ROTATE_RIGHT)) lander.rotation.z -= ANGULAR_VELOCITY * dt;
    lander.rotation.z = Math.max(-Math.PI/2, Math.min(Math.PI/2, lander.rotation.z));

    // --- thrust (jerk-based, per tblazevic) ---
    // BINDINGS.LANDER_THRUST covers W, ArrowUp, and Space — all three are
    // valid thrust inputs in 2D mode. Space is thrust-only here (it does
    // NOT interact); walk mode is where Space doubles as a secondary
    // interact key.
    const wantThrust = Input.isAnyDown(BINDINGS.LANDER_THRUST) && GameState.fuel.current > 0;
    if (wantThrust) {
      currentAcceleration = Math.min(
        THRUSTER_ACCEL_MAX,
        currentAcceleration + THRUSTER_JERK * dt
      );
      const ratio = currentAcceleration / THRUSTER_ACCEL_MAX;
      const burn = FUEL_CONSUMPTION_MIN + ratio * (FUEL_CONSUMPTION_MAX - FUEL_CONSUMPTION_MIN);
      GameState.fuel.current = Math.max(0, GameState.fuel.current - burn * dt);
      Sounds.rocket?.play();
      if (GameState.fuel.current < FUEL_ALERT_THRESHOLD && !GameState.isAlerted) {
        updateState(s => { s.isAlerted = true; }, 'fuel-alert');
      }
    } else {
      currentAcceleration = Math.max(0, currentAcceleration - THRUSTER_JERK * ACCEL_FALLOFF_MULT * dt);
      Sounds.rocket?.stop();
    }
    // Exhaust streams while the player is actively burning fuel.
    if (thrusterParticles) thrusterParticles.emitting = wantThrust;

    // --- integrate ---
    // Forward vector points "up" from the lander, rotated by lander.rotation.z.
    const angle = lander.rotation.z;
    const fwdX = -Math.sin(angle);
    const fwdY =  Math.cos(angle);

    // Weight scalar: heavier carry payload → less acceleration per unit
    // throttle (effective thrust / mass). Burn rate doesn't change — same
    // fuel produces less Δv when the lander is loaded down. Floored in
    // HUD.effectiveThrustFrac at LANDER_MIN_ACCEL_FRAC so a fully-loaded
    // craft still flies.
    const massScalar = effectiveThrustFrac();
    const effectiveAccel = currentAcceleration * massScalar;

    velY += -effectiveGravity(GameState.level) * dt;
    velX += fwdX * effectiveAccel * dt;
    velY += fwdY * effectiveAccel * dt;
    velX += -velX * HORIZONTAL_DRAG_COEF * dt;

    lander.position.x += velX * dt;
    lander.position.y += velY * dt;

    // --- collision ---
    checkCollisions();

    // --- telemetry for HUD ---
    // Gauge colors are driven off the current effective tolerances so the
    // player can read "am I in the safe zone?" at a glance: green well
    // under, amber approaching, red over.
    const altitude = computeAltitude(lander.position.x, lander.position.y);
    const vTol = effectiveLandingVelocityTolerance(GameState.level);
    const aTol = LANDING_ANGLE_TOLERANCE;
    setLanderTelemetry({
      altitude,
      hSpeed:   velX,
      vSpeed:  -velY,
      angleDeg: -angle * 180 / Math.PI,
      vSpeedState: gaugeState(Math.abs(velY), vTol, 0.4, 0.8),
      hSpeedState: gaugeState(Math.abs(velX), vTol, 0.4, 0.8),
      angleState:  gaugeState(Math.abs(angle), aTol, 0.4, 0.85)
    });

    // --- camera zoom near ground (final-approach drama) ---
    updateCameraZoom(altitude);
    // Snapshot the post-zoom "rest" position so applyCameraShake can jitter
    // around it without drifting. Done every frame so shakes that arrive
    // at any moment have a fresh base.
    cameraBaseX = camera.position.x;
    cameraBaseY = camera.position.y;
    applyCameraShake(dt);

    // --- particle integration ---
    thrusterParticles?.update(dt);
    explosionParticles?.update(dt);

    // --- scrape banner cleanup ---
    if (scrapeBannerClearAt > 0 && modeElapsed >= scrapeBannerClearAt) {
      scrapeBannerClearAt = 0;
      setCenterMessage('');
    }

    // Notify subscribers for per-second-ish updates (score/fuel) less frequently.
    // For now, notify once per update — cheap enough at 60fps with small listeners.
    notify('frame');
  },

  render(renderer) {
    renderer.render(scene, camera);
  },

  getCamera() { return camera; },
  getScene()  { return scene; },
  getLander() { return lander; }   // exposed for the cinematic transition
};

// ---------- helpers ----------

function buildTerrain() {
  // Convert tblazevic's points (y-up from the screen bottom) into centered
  // world coords, build a single line-strip geometry, and cache segment data
  // for collision and pad-multiplier bookkeeping.
  const positions = [];
  for (let i = 0; i < terrainPoints.length; i++) {
    const [px, py] = terrainPoints[i];
    const wx = px - HALF_WIDTH;
    const wy = py - HALF_HEIGHT;
    positions.push(wx, wy, 0);
    if (i > 0) {
      const [prevPx, prevPy] = terrainPoints[i - 1];
      const lx = prevPx - HALF_WIDTH, ly = prevPy - HALF_HEIGHT;
      const slope = Math.abs(wy - ly);
      const width = wx - lx;
      const centerX = (lx + wx) / 2;
      const isFlat = slope < 0.001 && width >= MIN_PAD_WIDTH;
      // A pad is "beginner" if its center matches one of the curated
      // BEGINNER_PAD_CENTERS — those get a fuel drum sprite in 2D and
      // a drum next to the astronaut on disembark instead of a random
      // multiplier.
      const isBeginner = isFlat && BEGINNER_PAD_CENTERS.some(
        c => Math.abs(centerX - c) <= BEGINNER_PAD_TOLERANCE
      );
      const seg = {
        left:  new THREE.Vector2(lx, ly),
        right: new THREE.Vector2(wx, wy),
        slope,
        width,
        centerX,
        multiplier: 1,
        kind: isBeginner ? 'beginner' : (isFlat ? 'plain' : 'slope')
      };
      if (isFlat && !isBeginner) {
        seg.multiplier = rollMultiplier();
        if (seg.multiplier > 1) seg.kind = 'bonus';
      }
      terrainSegments.push(seg);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const line = new THREE.Line(geom, mat);
  scene.add(line);
  disposables.push({ geometry: geom, material: mat });

  // Pad adornments: X-multiplier labels on bonus pads, fuel-drum sprites
  // on beginner pads (advertising that a guaranteed fuel pickup awaits).
  for (const seg of terrainSegments) {
    if (seg.kind === 'bonus')    spawnMultiplierLabel(seg);
    if (seg.kind === 'beginner') spawnFuelDrumLabel(seg);
  }
}

function rollMultiplier() {
  const total = PAD_MULTIPLIER_WEIGHTS.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const entry of PAD_MULTIPLIER_WEIGHTS) {
    r -= entry.weight;
    if (r <= 0) return entry.value;
  }
  return 1;
}

function spawnMultiplierLabel(seg) {
  const text = 'X' + seg.multiplier;
  // Bigger multipliers get hotter colors so they pop against the terrain.
  const color = seg.multiplier >= 5 ? '#ff5a3d'
              : seg.multiplier >= 3 ? '#ffb84d'
                                    : '#ffee66';

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 44px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  const smat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(smat);
  sprite.scale.set(24, 12, 1);
  const cx = (seg.left.x + seg.right.x) / 2;
  const cy = (seg.left.y + seg.right.y) / 2;
  sprite.position.set(cx, cy + 14, 1);
  scene.add(sprite);
  disposables.push({ material: smat, texture: tex });
}

/**
 * Draw a pixel-art fuel drum above a beginner pad so the player sees a clear
 * incentive to aim there. The drum is rendered to a CanvasTexture so we
 * don't need another PNG asset, and pushed onto a THREE.Sprite so it stays
 * camera-facing (no surprise when we tilt the ortho camera).
 */
function spawnFuelDrumLabel(seg) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 96);

  // Drum body: yellow rectangle, slightly rounded
  ctx.fillStyle = '#ffb020';
  ctx.fillRect(14, 14, 36, 70);
  // Top + bottom caps
  ctx.fillStyle = '#8a8a90';
  ctx.fillRect(12, 10, 40, 8);
  ctx.fillRect(12, 80, 40, 8);
  // Hazard bands
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(14, 30, 36, 5);
  ctx.fillRect(14, 62, 36, 5);
  // "F" stencil
  ctx.fillStyle = '#2a2a30';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('F', 32, 49);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  const smat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(smat);
  // Size the drum ~40% of LANDER_SCALE so the player can see it from altitude
  // without it swallowing the pad visually.
  const drumW = LANDER_SCALE * 0.25;
  const drumH = drumW * 1.5;
  sprite.scale.set(drumW, drumH, 1);
  const cx = (seg.left.x + seg.right.x) / 2;
  const cy = (seg.left.y + seg.right.y) / 2;
  sprite.position.set(cx, cy + drumH * 0.55, 1);
  scene.add(sprite);
  disposables.push({ material: smat, texture: tex });
}

function buildLander() {
  lander = new THREE.Group();

  // Textured sprite: crisp/retro pixel look via NearestFilter. The texture
  // itself is shared via AssetCache so round-tripping lander→walk→lander
  // doesn't upload the same PNG to the GPU twice on a Chromebook.
  const tex = getSharedTexture('textures/lander.png');
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const geom = new THREE.PlaneGeometry(LANDER_SCALE, LANDER_SCALE);
  const mat  = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const mesh = new THREE.Mesh(geom, mat);
  lander.add(mesh);
  // Note: texture is NOT pushed to disposables — AssetCache owns it.
  disposables.push({ geometry: geom, material: mat });

  // Invisible collider anchors. Their world positions (which include the
  // lander's rotation) are what we test against terrain segments.
  mainCollider = new THREE.Object3D();
  footColliderLeft = new THREE.Object3D();
  footColliderRight = new THREE.Object3D();
  footColliderLeft.position.set(-FOOT_COLLIDER_OFFSET_X, FOOT_COLLIDER_OFFSET_Y, 0);
  footColliderRight.position.set( FOOT_COLLIDER_OFFSET_X, FOOT_COLLIDER_OFFSET_Y, 0);
  lander.add(mainCollider, footColliderLeft, footColliderRight);

  scene.add(lander);
}

function respawn() {
  velX = (Math.random() - 0.5) * effectiveSpawnVelocity(GameState.level);
  velY = 0;
  currentAcceleration = 0;
  lander.position.set(
    (Math.random() - 0.5) * (GAME_WIDTH * 0.6),
    HALF_HEIGHT - 60,
    0
  );
  lander.rotation.z = (Math.random() - 0.5) * 0.4;
  GameState.hasLanded = false;
  landingResolved = false;
}

function checkCollisions() {
  // Border check
  if (Math.abs(lander.position.x) > HALF_WIDTH || Math.abs(lander.position.y) > HALF_HEIGHT) {
    resolveCrash('OUT OF BOUNDS');
    return;
  }

  // 3-circle collision. Foot colliders are children of the lander Group, so
  // their world positions reflect the lander's current rotation. The body
  // collider sits at the lander's origin.
  mainCollider.getWorldPosition(_mainWorld);
  footColliderLeft.getWorldPosition(_leftWorld);
  footColliderRight.getWorldPosition(_rightWorld);

  let bodyContact = null;
  let leftHitIdx = -1;
  let rightHitIdx = -1;

  for (let i = 0; i < terrainSegments.length; i++) {
    const seg = terrainSegments[i];
    if (!bodyContact) {
      const hit = circleHitsSegment(_mainWorld, MAIN_COLLIDER_SCALE, seg);
      if (hit) bodyContact = hit;
    }
    if (leftHitIdx < 0 && circleHitsSegment(_leftWorld, SMALL_COLLIDER_SCALE, seg)) {
      leftHitIdx = i;
    }
    if (rightHitIdx < 0 && circleHitsSegment(_rightWorld, SMALL_COLLIDER_SCALE, seg)) {
      rightHitIdx = i;
    }
  }

  // Body-circle contact: a hard normal-aligned impact stays a full crash;
  // a glancing scrape (mostly tangential motion) emits sparks, bounces the
  // hull off, and takes a small HP bite without ending the run.
  if (bodyContact) {
    classifyBodyHit(bodyContact);
    return;
  }

  // Feet-first contact: evaluate as a landing attempt. We pick whichever foot
  // hit first as the "contact" segment and let evaluateLanding decide.
  if (leftHitIdx >= 0 || rightHitIdx >= 0) {
    const contactIdx = leftHitIdx >= 0 ? leftHitIdx : rightHitIdx;
    const contactSeg = terrainSegments[contactIdx];
    evaluateLanding(contactSeg, contactIdx);
  }
}

/**
 * Decide whether a body-circle contact is a hard impact (→ crash) or a
 * glancing scrape (→ sparks + HP nick). The discriminator is the velocity
 * component along the segment normal: a near-vertical nose-dive into a
 * wall has a large vNormal; sliding along a ridge has near-zero vNormal.
 */
function classifyBodyHit(contact) {
  const vNormal = velX * contact.nx + velY * contact.ny;
  if (Math.abs(vNormal) >= SCRAPE_VELOCITY_THRESHOLD) {
    resolveCrash('CRASHED ON UNEVEN TERRAIN');
    return;
  }
  if (modeElapsed - lastScrapeAt < SCRAPE_COOLDOWN_S) return;
  resolveScrape(contact, vNormal);
}

function resolveScrape(contact, vNormal) {
  lastScrapeAt = modeElapsed;
  // Push the lander back out of penetration plus a small bounce so the hit
  // reads as kinetic. vNormal is negative when moving INTO the terrain
  // (normal points outward), so subtracting it cancels the inward speed.
  const push = Math.max(0, -vNormal) + SCRAPE_BOUNCE;
  velX += contact.nx * push;
  velY += contact.ny * push;

  explosionParticles?.emit({
    count:        SCRAPE_PARTICLE_COUNT,
    colorStart:   SCRAPE_COLOR_START,
    colorEnd:     SCRAPE_COLOR_END,
    speedMin:     SCRAPE_SPEED_MIN,
    speedMax:     SCRAPE_SPEED_MAX,
    lifetimeMin:  SCRAPE_LIFETIME_MIN,
    lifetimeMax:  SCRAPE_LIFETIME_MAX,
    originX:      contact.cx,
    originY:      contact.cy,
    gravityScale: SCRAPE_GRAVITY
  });

  // Light HP loss; if it takes the last sliver of hull, escalate to crash
  // so the existing wrecked-game-over path still triggers.
  let wreckedNow = false;
  updateState(s => {
    s.lander.hp = Math.max(0, (s.lander.hp ?? s.lander.maxHp) - SCRAPE_DAMAGE_HP);
    if (s.lander.hp <= 0) { s.lander.wrecked = true; wreckedNow = true; }
  }, 'scraped');
  if (wreckedNow) {
    resolveCrash('HULL FAILED ON SCRAPE');
    return;
  }
  setCenterMessage(`HULL SCRAPE  -${SCRAPE_DAMAGE_HP} HP`);
  scrapeBannerClearAt = modeElapsed + 0.8;
}

/**
 * Returns null if the circle [pt, radius] doesn't touch the segment, or a
 * contact descriptor `{ cx, cy, nx, ny }` if it does:
 *   cx, cy — closest point on the segment to the circle center (world space)
 *   nx, ny — unit normal pointing from contact toward the circle center
 *            (so the body can be pushed back along it on a scrape)
 * Foot/body callers that only want a boolean still work via truthy check.
 */
function circleHitsSegment(pt, radius, seg) {
  const ax = seg.left.x,  ay = seg.left.y;
  const bx = seg.right.x, by = seg.right.y;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = ((pt.x - ax) * dx + (pt.y - ay) * dy) / lenSq;
    if (t < 0) t = 0; else if (t > 1) t = 1;
  }
  const cx = ax + t * dx, cy = ay + t * dy;
  const ex = pt.x - cx, ey = pt.y - cy;
  const distSq = ex * ex + ey * ey;
  if (distSq > radius * radius) return null;

  let nx, ny;
  const dist = Math.sqrt(distSq);
  if (dist > 1e-6) {
    nx = ex / dist; ny = ey / dist;
  } else {
    // Degenerate: circle center sits exactly on the segment. Fall back to
    // the segment's geometric normal, biased upward so it points away from
    // the terrain rather than into it.
    const segLen = Math.sqrt(lenSq) || 1;
    nx = -dy / segLen; ny = dx / segLen;
    if (ny < 0) { nx = -nx; ny = -ny; }
  }
  return { cx, cy, nx, ny };
}

function evaluateLanding(segment, segmentIndex /*, bothFeetOnSamePad */) {
  // The `bothFeetOnSamePad` flag from checkCollisions() used to be a crash
  // condition, but it fired false positives on the first-contact frame when
  // one foot touched a tick before the other. The center-based edge-margin
  // check below already prevents half-on/half-off landings, and the
  // `unevenPad` check prevents landing on slopes — so we don't need the
  // simultaneous-feet requirement on top.
  const level    = GameState.level;
  const speedMax = effectiveLandingVelocityTolerance(level);
  const speed2   = velX * velX + velY * velY;
  const tooFast    = speed2 > speedMax * speedMax;
  const tooTilted  = Math.abs(lander.rotation.z) > LANDING_ANGLE_TOLERANCE;
  const unevenPad  = segment.slope > 0.001;

  // Too close to either edge of the landing pad. Uses the lander's center x
  // against the pad's boundaries plus a small margin.
  const edgeMargin = LANDER_SCALE * effectiveEdgeMarginFrac(level);
  const tooCloseToEdge =
    lander.position.x < segment.left.x  + edgeMargin ||
    lander.position.x > segment.right.x - edgeMargin;

  if (tooFast || tooTilted || unevenPad || tooCloseToEdge) {
    const reason =
      tooFast   ? 'LANDING VELOCITY WAS TOO HIGH' :
      tooTilted ? 'LANDING ANGLE WAS TOO HIGH'    :
      unevenPad ? 'CRASHED ON UNEVEN TERRAIN'     :
                  'TOO CLOSE TO EDGE OF TERRAIN';
    resolveCrash(reason);
  } else {
    emitLandingDust();
    resolveLanding(segment, segmentIndex);
  }
}

/**
 * Soft landing → small dust puff at each foot. Reuses the explosion pool
 * with a gray, slow, short-lived configuration so it reads as moondust
 * lifting off the pad rather than a fire/explosion.
 */
function emitLandingDust() {
  if (!explosionParticles) return;
  footColliderLeft.getWorldPosition(_leftWorld);
  footColliderRight.getWorldPosition(_rightWorld);
  const dustOpts = {
    count:        DUST_PUFF_COUNT,
    colorStart:   DUST_PUFF_COLOR_START,
    colorEnd:     DUST_PUFF_COLOR_END,
    speedMin:     DUST_PUFF_SPEED_MIN,
    speedMax:     DUST_PUFF_SPEED_MAX,
    lifetimeMin:  DUST_PUFF_LIFETIME_MIN,
    lifetimeMax:  DUST_PUFF_LIFETIME_MAX,
    gravityScale: DUST_PUFF_GRAVITY
  };
  explosionParticles.emit({ ...dustOpts, originX: _leftWorld.x,  originY: _leftWorld.y  });
  explosionParticles.emit({ ...dustOpts, originX: _rightWorld.x, originY: _rightWorld.y });
}

function resolveLanding(segment, segmentIndex) {
  landingResolved = true;
  const multiplier = segment.multiplier || 1;
  const earned = SCORE_PER_LANDING * multiplier;
  // Snapshot fuel now — the hot-swap achievement compares it to post-refuel.
  const fuelAtLanding = GameState.fuel.current;

  // Perfect-landing check has to read the pre-mutation state to evaluate the
  // "full fuel" condition sensibly.
  const padCenter = (segment.left.x + segment.right.x) / 2;
  const padHalf   = (segment.right.x - segment.left.x) / 2;
  const perfect =
    multiplier > 1 &&
    fuelAtLanding >= GameState.fuel.capacity * PERFECT_FUEL_FRAC &&
    (velX * velX + velY * velY) <= PERFECT_VELOCITY_MAX * PERFECT_VELOCITY_MAX &&
    Math.abs(lander.position.x - padCenter) <= padHalf * PERFECT_CENTER_FRAC &&
    Math.abs(lander.rotation.z) <= PERFECT_ANGLE_MAX;

  updateState(s => {
    s.hasLanded = true;
    s.landingsCompleted += 1;
    s.level += 1;
    s.score += earned;
    // Re-arm the synthetic "return to the lander" objective for the next
    // walk session — it ticks again the moment the astronaut boards.
    if (s.flags) s.flags.boardedThisLevel = false;
    s.lastLanding.x = lander.position.x;
    s.lastLanding.terrainSegmentIndex = segmentIndex;
    s.lastLanding.surfaceNormal = new THREE.Vector2(0, 1);
    s.lastLanding.fuelAtLanding = fuelAtLanding;
    // Hand the pad's metadata to walk mode so it can seed the scene with
    // the matching loot (fuel drum on beginner pad, sample on bonus pad).
    s.lastLanding.padCenterX = (segment.left.x + segment.right.x) / 2;
    s.lastLanding.padWidth   = segment.right.x - segment.left.x;
    s.lastLanding.padKind    = segment.kind || 'plain';
    s.lastLanding.padMultiplier = multiplier;
  }, 'landed');

  // Achievement triggers.
  showAchievementToast(unlockAchievement('first-landing'));
  if (perfect)                              showAchievementToast(unlockAchievement('perfect-landing'));
  if (GameState.landingsCompleted >= 10)    showAchievementToast(unlockAchievement('marathon'));

  // Mission Control narrative beat — fires on the very first landing of
  // a run. landingsCompleted has already been incremented to 1 above.
  if (GameState.landingsCompleted === 1) {
    showMissionMessage('firstLanding');
  }
  // Story progression layer (Batch 4 #10) — fires the per-level outro beat
  // for the level the player just completed.
  Story.onLandingCompleted();

  const suffix = multiplier > 1 ? `  X${multiplier} +${earned}` : '';
  setCenterMessage('SUCCESSFULLY LANDED' + suffix);
  onLandedCallback({ segment, segmentIndex, multiplier, earned });
}

function resolveCrash(reason) {
  landingResolved = true;
  Sounds.rocket?.stop();
  Sounds.crash?.play();
  if (thrusterParticles) thrusterParticles.emitting = false;
  // A scrape that escalated may have set this; suppress the cleanup pass
  // so it doesn't blank the crash message a frame later.
  scrapeBannerClearAt = 0;
  // Velocity-scaled explosion + camera shake. Below SOFT, t≈0 → small
  // burst, gentle shake. Above HARD, t≈1 → full pool, big shake.
  const impactSpeed = Math.hypot(velX, velY);
  const t = clamp01(
    (impactSpeed - IMPACT_VELOCITY_SOFT) /
    Math.max(1, IMPACT_VELOCITY_HARD - IMPACT_VELOCITY_SOFT)
  );
  const burstCount       = Math.round(lerp(CRASH_EXPLOSION_COUNT_MIN,        CRASH_EXPLOSION_COUNT_MAX,        t));
  const burstSpeedMax    =            lerp(CRASH_EXPLOSION_SPEED_MAX_MIN,    CRASH_EXPLOSION_SPEED_MAX_MAX,    t);
  const burstLifetimeMax =            lerp(CRASH_EXPLOSION_LIFETIME_MAX_MIN, CRASH_EXPLOSION_LIFETIME_MAX_MAX, t);
  explosionParticles?.emit({
    count:       burstCount,
    speedMax:    burstSpeedMax,
    lifetimeMax: burstLifetimeMax
  });
  shakeAmplitude = CRASH_SHAKE_BASE * lerp(1, CRASH_SHAKE_PEAK_MUL, t);
  shakeT = CRASH_SHAKE_DURATION;
  // Hide the wreck so the explosion reads as "the lander is gone". A fresh
  // lander mesh is built when the next life enter()s.
  lander.visible = false;
  // Shave the lander's HP. Hitting zero flips wrecked → game-over (Main.js
  // handleCrashed also game-overs on fuel-empty; both conditions end the
  // run). Repair parts collected at Apollo sites and stowed at the lander
  // restore HP up to maxHp.
  let wrecked = false;
  updateState(s => {
    s.hasLanded = false;
    s.lander.hp = Math.max(0, (s.lander.hp ?? s.lander.maxHp) - LANDER_CRASH_DAMAGE);
    if (s.lander.hp <= 0) { s.lander.wrecked = true; wrecked = true; }
  }, 'crashed');
  const hpSuffix = wrecked
    ? '\nLANDER DESTROYED'
    : `\nLANDER HP: ${GameState.lander.hp}/${GameState.lander.maxHp}`;
  setCenterMessage(reason + hpSuffix);
  // Mission Control nudge when the hull is below 25%.
  if (!wrecked && GameState.lander.hp / GameState.lander.maxHp <= 0.25) {
    showMissionMessage('hullCritical');
  }
  onCrashedCallback({ reason, wrecked });
}

function updateCameraZoom(altitude) {
  // Two camera behaviors layered:
  //   1) Final-approach zoom: when altitude is low, we snap to CAMERA_ZOOM_FACTOR
  //      and follow the lander tightly so the touchdown reads.
  //   2) Portrait pan-follow: if the viewport is narrower than the world, the
  //      ortho frustum is narrower than GAME_WIDTH (set by Main.fitOrthoToViewport)
  //      and we slide the camera horizontally to keep the lander on-screen.
  const viewW = camera.userData.viewWidth || (camera.right - camera.left);
  const viewH = camera.userData.viewHeight || (camera.top - camera.bottom);
  const portraitFollow = viewW < GAME_WIDTH;

  if (altitude < CAMERA_ZOOM_ALTITUDE) {
    if (camera.zoom !== CAMERA_ZOOM_FACTOR) {
      camera.zoom = CAMERA_ZOOM_FACTOR;
      camera.updateProjectionMatrix();
    }
    camera.position.x = lander.position.x;
    camera.position.y = lander.position.y;
    return;
  }

  if (camera.zoom !== 1) {
    camera.zoom = 1;
    camera.updateProjectionMatrix();
  }

  if (portraitFollow) {
    // Pan horizontally to follow the lander, clamped to the world bounds so
    // we never reveal off-world space.
    const halfW = viewW / 2;
    const minX = -HALF_WIDTH + halfW;
    const maxX =  HALF_WIDTH - halfW;
    camera.position.x = Math.max(minX, Math.min(maxX, lander.position.x));
    // Vertical: keep the world centered. Frustum height matches GAME_HEIGHT.
    camera.position.y = 0;
    camera.position.z = 100;
  } else {
    camera.position.set(0, 0, 100);
  }
}

function computeAltitude(x, y) {
  // Find the terrain height directly below (x) and return (y - terrainY).
  for (const seg of terrainSegments) {
    if (x < seg.left.x || x > seg.right.x) continue;
    const t = (x - seg.left.x) / (seg.right.x - seg.left.x);
    const groundY = seg.left.y + t * (seg.right.y - seg.left.y);
    return Math.max(0, y - LANDER_SCALE/2 - groundY);
  }
  return 0;
}

/**
 * Apply decaying camera shake on top of `cameraBaseX/Y` (snapshotted by
 * the caller before this runs). Linear amplitude falloff over
 * CRASH_SHAKE_DURATION; on the last frame snap back to the base so the
 * camera doesn't park at a sub-pixel offset.
 */
function applyCameraShake(dt) {
  if (shakeT <= 0) return;
  const a = shakeAmplitude * (shakeT / CRASH_SHAKE_DURATION);
  camera.position.x = cameraBaseX + (Math.random() - 0.5) * 2 * a;
  camera.position.y = cameraBaseY + (Math.random() - 0.5) * 2 * a;
  shakeT = Math.max(0, shakeT - dt);
  if (shakeT <= 0) {
    camera.position.x = cameraBaseX;
    camera.position.y = cameraBaseY;
    shakeAmplitude = 0;
  }
}

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Stow a single carry item into the lander from the lander-mode inventory
 * overlay. Applies the item's effect immediately:
 *   - 'fuel' → adds amount to fuel.current (capped at capacity)
 *   - 'part' → adds amount to lander.hp (capped at maxHp)
 * Removes the item from GameState.carrying, which deflates the lander's
 * mass for the next physics step (effectiveThrustFrac re-reads it).
 */
function stowCarryItemInLander(idx) {
  const item = GameState.carrying?.[idx];
  if (!item) return;
  let summary = '';
  updateState(s => {
    if (item.type === 'fuel') {
      const room = s.fuel.capacity - s.fuel.current;
      const got  = Math.min(item.amount, room);
      s.fuel.current += got;
      summary = `+${got | 0} FUEL STOWED`;
      if (s.isAlerted && s.fuel.current >= s.fuel.capacity * 0.3) s.isAlerted = false;
    } else if (item.type === 'part') {
      const room = s.lander.maxHp - s.lander.hp;
      const got  = Math.min(item.amount, room);
      s.lander.hp += got;
      summary = `+${got | 0} HULL HP STOWED`;
      s.stats.partsStowed = (s.stats.partsStowed | 0) + 1;
    } else {
      // Unexpected payload — drop quietly so an unknown future item type
      // doesn't pile up in the carry list with no way out.
      summary = `${(item.type || 'ITEM').toUpperCase()} STOWED`;
    }
    s.carrying.splice(idx, 1);
  }, 'stow-from-inventory');
  if (summary) showComms(summary);
}

/**
 * Map a magnitude to a tri-state color flag used by HUD.js:
 *   value < tol * okFrac   → 'ok'     (green)
 *   value < tol * warnFrac → 'warn'   (amber)
 *   otherwise              → 'danger' (red / bold)
 */
function gaugeState(value, tol, okFrac, warnFrac) {
  if (value < tol * okFrac)   return 'ok';
  if (value < tol * warnFrac) return 'warn';
  return 'danger';
}
