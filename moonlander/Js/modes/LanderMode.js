// modes/LanderMode.js — v0.1.0
// The classic lunar-lander side-view, now rendered with a 3D scene and an
// ORTHOGRAPHIC camera locked to the x/y plane. Visually indistinguishable
// from the tblazevic 2D version, but the lander itself is a THREE.Object3D
// whose position/rotation we can hand off seamlessly to the walk mode.
//
// STUBBED AREAS (marked with TODO) are left as clean insertion points:
//   - Terrain mesh generation from TerrainData points
//   - 3-circle collision approximation (see tblazevic for algorithm)
//   - Particle systems (reuse Particles.js stubs)
//   - Starfield background
//
// The jerk-based thrust physics from tblazevic IS implemented below — that's
// the piece with subtle feel we didn't want to lose.

import * as THREE from 'three';
import {
  GAME_WIDTH, GAME_HEIGHT, HALF_WIDTH, HALF_HEIGHT,
  LANDER_SCALE, GRAVITY, THRUSTER_ACCEL_MAX, THRUSTER_JERK,
  ACCEL_FALLOFF_MULT, ANGULAR_VELOCITY, HORIZONTAL_DRAG_COEF,
  FUEL_CONSUMPTION_MIN, FUEL_CONSUMPTION_MAX, FUEL_ALERT_THRESHOLD,
  LANDING_ANGLE_TOLERANCE, LANDING_VELOCITY_TOLERANCE,
  ORTHO_NEAR, ORTHO_FAR, MODE
} from '../Constants.js';
import { GameState, update as updateState, notify } from '../GameState.js';
import { Input } from '../Input.js';
import { setLanderTelemetry, setCenterMessage } from '../HUD.js';
import { points as terrainPoints } from '../TerrainData.js';
import { Sounds } from '../Sound.js';

// ----- mode-local state (reset in enter(), cleared in exit()) -----
let scene = null;
let camera = null;
let lander = null;               // THREE.Group — the visible craft
let terrainSegments = [];        // [{ left: Vec2, right: Vec2, slope: number }]
let disposables = [];            // geometries/materials to dispose on exit

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
    // TODO: initParticles();   — thruster cone + explosion (see Particles.js stub)

    // Initial spawn
    respawn();

    GameState.mode = MODE.LANDER;
    notify('mode');
  },

  exit() {
    console.log('◀ LanderMode.exit');
    Sounds.rocket?.stop();

    // Dispose every geometry and material we created.
    // Textures are disposed here too if added later.
    for (const d of disposables) {
      if (d.geometry) d.geometry.dispose();
      if (d.material) {
        if (Array.isArray(d.material)) d.material.forEach(m => m.dispose());
        else d.material.dispose();
      }
    }
    disposables = [];
    terrainSegments = [];

    // Detach lander from scene but DO NOT dispose its meshes — the transition
    // and walk mode may want to render the parked lander visually. Main.js
    // will hand it off via the sharedScene mechanism.
    scene = null;
    camera = null;
    lander = null;
  },

  update(dt) {
    if (landingResolved) return;

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

    // --- integrate ---
    // Forward vector points "up" from the lander, rotated by lander.rotation.z.
    const angle = lander.rotation.z;
    const fwdX = -Math.sin(angle);
    const fwdY =  Math.cos(angle);

    velY += -GRAVITY * dt;
    velX += fwdX * currentAcceleration * dt;
    velY += fwdY * currentAcceleration * dt;
    velX += -velX * HORIZONTAL_DRAG_COEF * dt;

    lander.position.x += velX * dt;
    lander.position.y += velY * dt;

    // --- collision ---
    checkCollisions();

    // --- telemetry for HUD ---
    const altitude = computeAltitude(lander.position.x, lander.position.y);
    setLanderTelemetry({
      altitude,
      hSpeed:   velX,
      vSpeed:  -velY,
      angleDeg: -angle * 180 / Math.PI
    });

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
  // Convert tblazevic's top-left-origin points into centered world coords,
  // build a single line-strip geometry, and cache segment data for collision.
  const positions = [];
  for (let i = 0; i < terrainPoints.length; i++) {
    const [px, py] = terrainPoints[i];
    const wx = px - HALF_WIDTH;
    const wy = py - HALF_HEIGHT;
    positions.push(wx, wy, 0);
    if (i > 0) {
      const [prevPx, prevPy] = terrainPoints[i - 1];
      const lx = prevPx - HALF_WIDTH, ly = prevPy - HALF_HEIGHT;
      terrainSegments.push({
        left:  new THREE.Vector2(lx, ly),
        right: new THREE.Vector2(wx, wy),
        // Slope ~0 means this is a valid landing pad (matches tblazevic).
        slope: Math.abs(wy - ly)
      });
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const line = new THREE.Line(geom, mat);
  scene.add(line);
  disposables.push({ geometry: geom, material: mat });

  // TODO: also add invisible colliders / mark bonus pads with x2/x5 labels
}

function buildLander() {
  // Stub lander: white triangle-ish quad so you see something before you wire
  // textures. Replace with a textured plane or a GLTF model as desired.
  lander = new THREE.Group();
  const geom = new THREE.PlaneGeometry(LANDER_SCALE, LANDER_SCALE);
  const mat  = new THREE.MeshBasicMaterial({ color: 0xcccccc });
  const mesh = new THREE.Mesh(geom, mat);
  lander.add(mesh);
  scene.add(lander);
  disposables.push({ geometry: geom, material: mat });

  // TODO: replace with textured mesh using textures/lander.png
  // TODO: add 3-circle colliders as child Object3Ds (mainScale, smallScale*2)
}

function respawn() {
  velX = (Math.random() - 0.5) * 60;
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
  // TODO: 3-circle vs segment check from tblazevic (Main.js:terrainCheck).
  //       For now, naive segment-vs-point check so the skeleton runs.
  for (let i = 0; i < terrainSegments.length; i++) {
    const seg = terrainSegments[i];
    if (lander.position.x < seg.left.x || lander.position.x > seg.right.x) continue;
    const t = (lander.position.x - seg.left.x) / (seg.right.x - seg.left.x);
    const groundY = seg.left.y + t * (seg.right.y - seg.left.y);
    if (lander.position.y - LANDER_SCALE/2 <= groundY) {
      evaluateLanding(seg, i);
      return;
    }
  }
}

function evaluateLanding(segment, segmentIndex) {
  const speed2 = velX*velX + velY*velY;
  const tooFast = speed2 > LANDING_VELOCITY_TOLERANCE * LANDING_VELOCITY_TOLERANCE;
  const tooTilted = Math.abs(lander.rotation.z) > LANDING_ANGLE_TOLERANCE;
  const unevenPad = segment.slope > 0.001;

  if (tooFast || tooTilted || unevenPad) {
    const reason =
      tooFast   ? 'LANDING VELOCITY WAS TOO HIGH' :
      tooTilted ? 'LANDING ANGLE WAS TOO HIGH'    :
                  'CRASHED ON UNEVEN TERRAIN';
    resolveCrash(reason);
  } else {
    resolveLanding(segment, segmentIndex);
  }
}

function resolveLanding(segment, segmentIndex) {
  landingResolved = true;
  updateState(s => {
    s.hasLanded = true;
    s.landingsCompleted += 1;
    s.lastLanding.x = lander.position.x;
    s.lastLanding.terrainSegmentIndex = segmentIndex;
    s.lastLanding.surfaceNormal = new THREE.Vector2(0, 1); // flat pad
  }, 'landed');
  setCenterMessage('SUCCESSFULLY LANDED');
  onLandedCallback({ segment, segmentIndex });
}

function resolveCrash(reason) {
  landingResolved = true;
  Sounds.crash?.play();
  // TODO: trigger explosion particle system
  updateState(s => { s.hasLanded = false; }, 'crashed');
  setCenterMessage(reason);
  onCrashedCallback({ reason });
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
