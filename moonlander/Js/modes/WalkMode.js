// modes/WalkMode.js — v0.2.0
// Third-person 3D walking scene. The astronaut spawns next to the parked
// lander at the landing site, can walk around a small moon-surface patch, and
// interact with the fuel cart or the lander. Pressing E next to the lander
// hands control back to Main.js, which cinematic-swaps to LanderMode.
//
// Phase 3 changes:
//   - Procedural humanoid astronaut (helmet / torso / pack / arms / legs)
//     with a sin-driven walk cycle, replacing the capsule placeholder.
//   - Displaced moon surface via a deterministic sin-sum heightmap; the
//     astronaut's y locks to the ground via the same heightmap lookup.
//   - Crater ring decals scattered across the playable radius.
//   - Parked lander rendered with the same textures/lander.png sprite used
//     in LanderMode, for visual continuity.
//   - Strict chase camera: mouse X rotates the astronaut (and camera with
//     it); mouse Y orbits the camera's pitch around the astronaut. No more
//     hybrid snap-vs-orbit awkwardness.
//   - Playable-area clamp: x/z bounded by WALK_PLAY_RADIUS.

import * as THREE from 'three';
import {
  PERSP_FOV, PERSP_NEAR, PERSP_FAR,
  LANDER_SCALE,
  WALK_SPEED, WALK_CAMERA_DISTANCE, WALK_CAMERA_HEIGHT, WALK_INTERACT_RADIUS,
  WALK_PLAY_RADIUS, WALK_MOUSE_SENSITIVITY,
  WALK_PITCH_MIN, WALK_PITCH_MAX,
  WALK_GROUND_AMPLITUDE, WALK_CRATER_COUNT,
  MODE
} from '../Constants.js';
import { GameState, notify } from '../GameState.js';
import { Input } from '../Input.js';
import { setCenterMessage } from '../HUD.js';

let scene = null;
let camera = null;
let canvasEl = null;
let astronaut = null;
let astronautParts = null;     // references to animated bones
let landerModel = null;
let interactable = null;
let disposables = [];
let onReturnToLanderCallback = null;

// Camera-orbit state — yaw also rotates the astronaut (strict chase cam).
let yawRad = 0;
let pitchRad = 0.55;
let pointerLocked = false;
let walkPhase = 0;             // drives the leg/arm cycle

// Mouse-move handler bound in enter(), unbound in exit().
let onMouseMove = null;
let onPointerLockChange = null;
let onCanvasClick = null;

export const WalkMode = {
  enter(context, callbacks = {}) {
    console.log('▶ WalkMode.enter');
    onReturnToLanderCallback = callbacks.onReturnToLander || (() => {});
    canvasEl = context.canvas;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    scene.fog = new THREE.Fog(0x0a0a1a, 60, 320);

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(PERSP_FOV, aspect, PERSP_NEAR, PERSP_FAR);

    buildLighting();
    buildGround();
    buildCraters();
    buildAstronaut();
    buildParkedLander();
    buildFuelCart();

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
    if (document.pointerLockElement) document.exitPointerLock();

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
    interactable = null;
    pointerLocked = false;
  },

  update(dt) {
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

    // --- strict chase camera around the astronaut's chest ---
    updateChaseCamera();

    // --- interaction prompts ---
    const distToCart = astronaut.position.distanceTo(interactable.position);
    if (distToCart < WALK_INTERACT_RADIUS) {
      setCenterMessage('PRESS E TO LOAD FUEL');
      if (Input.wasPressed('e') || Input.wasPressed('E')) loadFuelFromCart();
    } else {
      const distToLander = astronaut.position.distanceTo(landerModel.position);
      if (distToLander < WALK_INTERACT_RADIUS) {
        setCenterMessage('PRESS E TO BOARD LANDER');
        if (Input.wasPressed('e') || Input.wasPressed('E')) onReturnToLanderCallback();
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
  getAstronaut() { return astronaut; }
};

// ---------- helpers ----------

function bindMouse() {
  onMouseMove = (e) => {
    if (!pointerLocked) return;
    yawRad   -= e.movementX * WALK_MOUSE_SENSITIVITY;
    pitchRad += e.movementY * WALK_MOUSE_SENSITIVITY;
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
  // Visual continuity: reuse the same texture as the flying lander. Rendered
  // as a billboard sprite so it reads the same no matter which angle the
  // astronaut views it from.
  const tex = new THREE.TextureLoader().load('textures/lander.png');
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const size = LANDER_SCALE * 1.6;
  landerModel = new THREE.Sprite(mat);
  landerModel.scale.set(size, size, 1);
  const lx = 0, lz = 0;
  landerModel.position.set(lx, groundHeight(lx, lz) + size * 0.5, lz);
  scene.add(landerModel);
  disposables.push({ material: mat, texture: tex });
}

function buildFuelCart() {
  const geom = new THREE.BoxGeometry(4, 2, 2);
  const mat  = new THREE.MeshLambertMaterial({ color: 0xffaa00 });
  interactable = new THREE.Mesh(geom, mat);
  const cx = 20, cz = 10;
  interactable.position.set(cx, groundHeight(cx, cz) + 1, cz);
  scene.add(interactable);
  disposables.push({ geometry: geom, material: mat });
}

function loadFuelFromCart() {
  const gained = 250;
  const cap = GameState.fuel.capacity - GameState.fuel.current;
  const actual = Math.min(gained, cap);
  GameState.fuel.current += actual;
  notify('fuel');
  setCenterMessage(`+${actual.toFixed(0)} FUEL LOADED`);
  console.log(`✅ Walk interaction: +${actual} fuel. Total: ${GameState.fuel.current}`);
  // Move the cart out of play so the user can't spam it.
  interactable.position.set(1000, 1000, 1000);
}
