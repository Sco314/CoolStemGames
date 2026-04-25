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
  INTERACTABLE_TYPES, LANDING_SITE_LOOT, DEFAULT_LOOT,
  DISEMBARK_DURATION_S, DISEMBARK_STEP_UNITS, EMBARK_DURATION_S,
  TRANSITION_WIND_VOL,
  HOT_SWAP_LOW_FUEL, HOT_SWAP_HIGH_FUEL,
  MODE
} from '../Constants.js';
import {
  GameState, update as updateState, notify, refreshObjectives,
  unlockAchievement
} from '../GameState.js';
import { Input } from '../Input.js';
import {
  setCenterMessage, showComms, showAchievementToast,
  showWalkTutorial, hideWalkTutorial
} from '../HUD.js';
import { Sounds } from '../Sound.js';
import { effectiveFuelGain } from '../Progression.js';
import { getQuality, onQualityChange } from '../Quality.js';
import { getSharedTexture } from '../AssetCache.js';

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

// Mouse-move handler bound in enter(), unbound in exit().
let onMouseMove = null;
let onPointerLockChange = null;
let onCanvasClick = null;
let unsubQuality = null;

export const WalkMode = {
  enter(context, callbacks = {}) {
    console.log('▶ WalkMode.enter');
    onReturnToLanderCallback = callbacks.onReturnToLander || (() => {});
    canvasEl = context.canvas;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
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
    buildAstronaut();
    buildParkedLander();
    spawnInteractables();
    buildFootprintPool();

    // Spawn next to the parked lander, facing away from it.
    astronaut.position.set(6, 0, 6);
    astronaut.position.y = groundHeight(astronaut.position.x, astronaut.position.z);
    yawRad = Math.PI * 0.25;
    pitchRad = 0.55;

    bindMouse();

    GameState.mode = MODE.WALK;
    notify('mode');
    setCenterMessage('CLICK TO LOOK AROUND\nWASD TO MOVE · E TO INTERACT');
  },

  exit() {
    console.log('◀ WalkMode.exit');
    unbindMouse();
    if (unsubQuality) { unsubQuality(); unsubQuality = null; }
    if (document.pointerLockElement) document.exitPointerLock();
    // Tear down the first-time tutorial if it was still open — we don't
    // want it hovering over lander mode.
    hideWalkTutorial();

    for (const d of disposables) {
      if (d.geometry) d.geometry.dispose();
      if (d.material) {
        if (Array.isArray(d.material)) d.material.forEach(m => m.dispose());
        else d.material.dispose();
      }
      if (d.texture) d.texture.dispose();
    }
    disposables = [];

    scene = null;
    camera = null;
    canvasEl = null;
    astronaut = null;
    astronautParts = null;
    landerModel = null;
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
      astronaut.position.x = lerp(scripted.startPos.x, scripted.endPos.x, t);
      astronaut.position.z = lerp(scripted.startPos.z, scripted.endPos.z, t);
      astronaut.position.y = groundHeight(astronaut.position.x, astronaut.position.z);
      yawRad = lerpAngle(scripted.startYaw, scripted.endYaw, t);
      astronaut.rotation.y = yawRad;
      updateWalkAnim(dt, true);
      updateChaseCamera();
      if (t >= 1) {
        const done = scripted.onDone;
        scripted = null;
        done();
      }
      return;
    }

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

    // --- footprint trail ---
    if (isMoving) dropFootprintIfMoved();
    updateFootprints(dt);

    // --- strict chase camera around the astronaut's chest ---
    updateChaseCamera();

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
        setCenterMessage('PRESS E TO BOARD LANDER');
        if (ePressed) onReturnToLanderCallback();
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
  }
};

// ---------- helpers ----------

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
    if (!pointerLocked) canvasEl.requestPointerLock?.();
  };
  window.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  canvasEl.addEventListener('click', onCanvasClick);
}

function unbindMouse() {
  if (onMouseMove) window.removeEventListener('mousemove', onMouseMove);
  if (onPointerLockChange) document.removeEventListener('pointerlockchange', onPointerLockChange);
  if (onCanvasClick && canvasEl) canvasEl.removeEventListener('click', onCanvasClick);
  onMouseMove = onPointerLockChange = onCanvasClick = null;
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
}

// ---------- Boot-print trail ----------
//
// A small pooled set of dark prints laid flat on the surface every time the
// astronaut walks ~1.6 units. Alternates left/right offset to read as a
// proper boot trail. Each print fades over FOOTPRINT_LIFETIME seconds; the
// pool overwrites oldest-first so the trail length is bounded.

const FOOTPRINT_POOL_SIZE = 32;
const FOOTPRINT_INTERVAL  = 1.6;   // world units between prints
const FOOTPRINT_LIFETIME  = 30;    // seconds before fully faded
const FOOTPRINT_BASE_OPAC = 0.55;

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
    footprints.push({ mesh, mat, age: FOOTPRINT_LIFETIME });
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
  fp.mat.opacity = FOOTPRINT_BASE_OPAC;
  fp.mesh.visible = true;
  fp.age = 0;

  lastFootprintPos.copy(astronaut.position);
}

function updateFootprints(dt) {
  for (const fp of footprints) {
    if (!fp.mesh.visible) continue;
    fp.age += dt;
    if (fp.age >= FOOTPRINT_LIFETIME) {
      fp.mesh.visible = false;
      continue;
    }
    fp.mat.opacity = FOOTPRINT_BASE_OPAC * (1 - fp.age / FOOTPRINT_LIFETIME);
  }
}

function buildCraters() {
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x3a3a42, transparent: true, opacity: 0.65, side: THREE.DoubleSide
  });
  disposables.push({ material: ringMat });

  for (let i = 0; i < WALK_CRATER_COUNT; i++) {
    const cx = (Math.random() * 2 - 1) * WALK_PLAY_RADIUS * 0.9;
    const cz = (Math.random() * 2 - 1) * WALK_PLAY_RADIUS * 0.9;
    const outer = 3 + Math.random() * 8;
    const inner = outer * (0.55 + Math.random() * 0.2);
    const ringGeom = new THREE.RingGeometry(inner, outer, 24);
    ringGeom.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.set(cx, groundHeight(cx, cz) + 0.05, cz);
    scene.add(ring);
    disposables.push({ geometry: ringGeom });
  }
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
}

function updateWalkAnim(dt, moving) {
  if (moving) walkPhase += dt * 7;
  const swing = moving ? Math.sin(walkPhase) * 0.7 : Math.sin(walkPhase) * 0; // 0 when stopped
  astronautParts.leftLeg.rotation.x  =  swing;
  astronautParts.rightLeg.rotation.x = -swing;
  astronautParts.leftArm.rotation.x  = -swing * 0.6;
  astronautParts.rightArm.rotation.x =  swing * 0.6;
}

function buildParkedLander() {
  // Visual continuity: reuse the same texture as the flying lander, shared
  // via AssetCache so we don't upload the PNG twice on low-memory devices.
  const tex = getSharedTexture('textures/lander.png');
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  // Sprite size 0.8 × LANDER_SCALE — at scale 24 that's 19.2 world units,
  // about 4–5× astronaut height which feels right next to a humanoid.
  // Previous 1.6× looked like a 38-unit colossus floating overhead.
  const size = LANDER_SCALE * 0.8;
  landerModel = new THREE.Sprite(mat);
  landerModel.scale.set(size, size, 1);
  const lx = 0, lz = 0;
  // Y offset accounts for the lander.png's transparent bottom margin: the
  // visible foot pads end at pixel y=122 of 128, so the visible bottom is
  // at sprite_center_y - size * (122/128 - 0.5) = sprite_center_y - size *
  // 0.453. Setting center_y = ground + size * 0.453 puts the visible feet
  // exactly on the surface instead of floating above it.
  landerModel.position.set(lx, groundHeight(lx, lz) + size * 0.453, lz);
  scene.add(landerModel);
  // Note: the cached texture is NOT disposed — AssetCache owns it.
  disposables.push({ material: mat });
}

// ---------- Phase-4 interactable system ----------

/**
 * Walk scene loot is seeded by the landing segment index stashed on
 * GameState.lastLanding. Unknown or crashed segments (-1) fall through to
 * DEFAULT_LOOT so there's always something to do.
 */
function spawnInteractables() {
  const segIdx = GameState.lastLanding.terrainSegmentIndex;
  const spawns = LANDING_SITE_LOOT[segIdx] || DEFAULT_LOOT;
  for (const [type, x, z] of spawns) {
    const it = buildInteractable(type, x, z);
    if (it) interactables.push(it);
  }
  // Breadcrumb rings from the parked lander to each interactable so the
  // player has cues on where to walk. Built after both the lander and the
  // loot exist so we know start and end points.
  for (const it of interactables) {
    it.trailMarkers = buildTrailMarkers(landerModel.position, it.object3d.position, it.type);
  }
  console.log(`ℹ️ Spawned ${interactables.length} interactables for segment ${segIdx}`);
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

  // ~one marker every 3 world units, capped between 4 and 9 markers per trail.
  const count = Math.max(4, Math.min(9, Math.round(dist / 3)));
  const ringGeom = new THREE.RingGeometry(0.55, 0.95, 18);
  ringGeom.rotateX(-Math.PI / 2);
  const color = INTERACTABLE_TYPES[type]?.color ?? 0xffee88;
  const ringMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.55,
    side: THREE.DoubleSide, depthWrite: false
  });
  // Geometry + material are shared by every ring on this trail and disposed
  // together when WalkMode.exit() walks the disposables list.
  disposables.push({ geometry: ringGeom, material: ringMat });

  const markers = [];
  // Place markers between (not at) the endpoints — start at fraction 1/(count+1),
  // end at count/(count+1). That keeps the trail clear of the lander base
  // and the interactable itself.
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const mx = start.x + dx * t;
    const mz = start.z + dz * t;
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.set(mx, groundHeight(mx, mz) + 0.05, mz);
    scene.add(ring);
    markers.push(ring);
  }
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
  const spec = INTERACTABLE_TYPES[it.type];
  let justDone = [];

  switch (it.type) {
    case 'fuel': {
      const scaled = effectiveFuelGain(GameState.level, spec.amount);
      const room = GameState.fuel.capacity - GameState.fuel.current;
      const gained = Math.min(scaled, room);
      updateState(s => {
        s.fuel.current += gained;
        if (s.isAlerted && s.fuel.current >= s.fuel.capacity * 0.3) s.isAlerted = false;
        justDone = refreshObjectives();
      }, 'pickup-fuel');
      showComms(`+${gained | 0} FUEL — TANKS TOPPED UP`);
      // Hot-swap achievement: landed with critically low fuel, refueled past
      // the high threshold.
      if ((GameState.lastLanding.fuelAtLanding ?? Infinity) < HOT_SWAP_LOW_FUEL &&
          GameState.fuel.current >= HOT_SWAP_HIGH_FUEL) {
        showAchievementToast(unlockAchievement('hot-swap-refuel'));
      }
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

  if (justDone.length) {
    setTimeout(() => showComms(`OBJECTIVE COMPLETE: ${firstObjectiveLabel(justDone[0])}`), 1100);
  }
}

function firstObjectiveLabel(id) {
  const o = GameState.objectives.find(x => x.id === id);
  return o ? o.label.toUpperCase() : id;
}
