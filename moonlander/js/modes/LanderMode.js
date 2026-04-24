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
  CAMERA_ZOOM_ALTITUDE, CAMERA_ZOOM_FACTOR,
  PERFECT_FUEL_FRAC, PERFECT_VELOCITY_MAX, PERFECT_CENTER_FRAC, PERFECT_ANGLE_MAX,
  ORTHO_NEAR, ORTHO_FAR, MODE
} from '../Constants.js';
import { GameState, update as updateState, notify, unlockAchievement } from '../GameState.js';
import { Input } from '../Input.js';
import { setLanderTelemetry, setCenterMessage, showAchievementToast } from '../HUD.js';
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
  },

  exit() {
    console.log('◀ LanderMode.exit');
    Sounds.rocket?.stop();

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
    // Particles keep animating across landingResolved so the crash explosion
    // and any in-flight exhaust can finish their lifetime visibly.
    if (landingResolved) {
      if (thrusterParticles) thrusterParticles.emitting = false;
      thrusterParticles?.update(dt);
      explosionParticles?.update(dt);
      return;
    }

    // --- rotation ---
    if (Input.isDown('ArrowLeft'))  lander.rotation.z += ANGULAR_VELOCITY * dt;
    if (Input.isDown('ArrowRight')) lander.rotation.z -= ANGULAR_VELOCITY * dt;
    lander.rotation.z = Math.max(-Math.PI/2, Math.min(Math.PI/2, lander.rotation.z));

    // --- thrust (jerk-based, per tblazevic) ---
    const wantThrust = Input.isDown('ArrowUp') && GameState.fuel.current > 0;
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

    velY += -effectiveGravity(GameState.level) * dt;
    velX += fwdX * currentAcceleration * dt;
    velY += fwdY * currentAcceleration * dt;
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

    // --- particle integration ---
    thrusterParticles?.update(dt);
    explosionParticles?.update(dt);

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
      const seg = {
        left:  new THREE.Vector2(lx, ly),
        right: new THREE.Vector2(wx, wy),
        // Slope ~0 means this is a valid landing pad (matches tblazevic).
        slope,
        multiplier: 1
      };
      if (slope < 0.001) seg.multiplier = rollMultiplier();
      terrainSegments.push(seg);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const line = new THREE.Line(geom, mat);
  scene.add(line);
  disposables.push({ geometry: geom, material: mat });

  // Bonus-pad labels: a small X2/X3/X5 sprite floating above each flat pad
  // whose rolled multiplier is > 1.
  for (const seg of terrainSegments) {
    if (seg.multiplier > 1) spawnMultiplierLabel(seg);
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

  let bodyHit = false;
  let leftHitIdx = -1;
  let rightHitIdx = -1;

  for (let i = 0; i < terrainSegments.length; i++) {
    const seg = terrainSegments[i];
    if (!bodyHit && circleHitsSegment(_mainWorld, MAIN_COLLIDER_SCALE, seg)) {
      bodyHit = true;
    }
    if (leftHitIdx < 0 && circleHitsSegment(_leftWorld, SMALL_COLLIDER_SCALE, seg)) {
      leftHitIdx = i;
    }
    if (rightHitIdx < 0 && circleHitsSegment(_rightWorld, SMALL_COLLIDER_SCALE, seg)) {
      rightHitIdx = i;
    }
  }

  // Body-circle contact is always a crash — the hull has hit terrain.
  if (bodyHit) {
    resolveCrash('CRASHED ON UNEVEN TERRAIN');
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

function circleHitsSegment(pt, radius, seg) {
  // Closest point on segment [left→right] to pt, then squared-distance check.
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
  return (ex * ex + ey * ey) <= radius * radius;
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
    resolveLanding(segment, segmentIndex);
  }
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
    s.lastLanding.x = lander.position.x;
    s.lastLanding.terrainSegmentIndex = segmentIndex;
    s.lastLanding.surfaceNormal = new THREE.Vector2(0, 1);
    s.lastLanding.fuelAtLanding = fuelAtLanding;
  }, 'landed');

  // Achievement triggers.
  showAchievementToast(unlockAchievement('first-landing'));
  if (perfect)                              showAchievementToast(unlockAchievement('perfect-landing'));
  if (GameState.landingsCompleted >= 10)    showAchievementToast(unlockAchievement('marathon'));

  const suffix = multiplier > 1 ? `  X${multiplier} +${earned}` : '';
  setCenterMessage('SUCCESSFULLY LANDED' + suffix);
  onLandedCallback({ segment, segmentIndex, multiplier, earned });
}

function resolveCrash(reason) {
  landingResolved = true;
  Sounds.rocket?.stop();
  Sounds.crash?.play();
  if (thrusterParticles) thrusterParticles.emitting = false;
  explosionParticles?.emit();
  // Hide the wreck so the explosion reads as "the lander is gone". A fresh
  // lander mesh is built when the next life enter()s.
  lander.visible = false;
  updateState(s => { s.hasLanded = false; }, 'crashed');
  setCenterMessage(reason);
  onCrashedCallback({ reason });
}

function updateCameraZoom(altitude) {
  // Below the threshold, snap to a higher zoom and follow the lander; above,
  // restore the wide ortho framing so the player can plan their descent.
  if (altitude < CAMERA_ZOOM_ALTITUDE) {
    if (camera.zoom !== CAMERA_ZOOM_FACTOR) {
      camera.zoom = CAMERA_ZOOM_FACTOR;
      camera.updateProjectionMatrix();
    }
    camera.position.x = lander.position.x;
    camera.position.y = lander.position.y;
  } else if (camera.zoom !== 1) {
    camera.zoom = 1;
    camera.position.set(0, 0, 100);
    camera.updateProjectionMatrix();
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
