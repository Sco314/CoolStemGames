// modes/WalkMode.js — v0.1.0
// Third-person 3D walking scene. Astronaut spawns next to the parked lander
// at the landing site, can walk around on a small terrain patch, and interact
// with objects (fuel cart, supply crates). When they return to the lander
// and press E, Main.js transitions back to LanderMode.
//
// STUBBED AREAS:
//   - Astronaut model (currently a capsule)
//   - Lander model re-use from LanderMode (currently a cube placeholder)
//   - Moon ground mesh (currently a flat plane)
//   - Fuel cart interaction (stub object + stub interact())
//   - Collision against terrain (currently just clamp to ground y=0)
//
// Mouse look uses PointerLockControls for pitch/yaw of the camera pivot, not
// the camera itself — giving a third-person orbit around the astronaut rather
// than first-person head. If you want pure first-person, swap the pivot
// for the camera directly.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import {
  PERSP_FOV, PERSP_NEAR, PERSP_FAR,
  WALK_SPEED, WALK_TURN_SPEED,
  WALK_CAMERA_DISTANCE, WALK_CAMERA_HEIGHT, WALK_INTERACT_RADIUS,
  MODE
} from '../Constants.js';
import { GameState, notify } from '../GameState.js';
import { Input } from '../Input.js';
import { setCenterMessage } from '../HUD.js';

let scene = null;
let camera = null;
let controls = null;
let astronaut = null;
let landerModel = null;     // visual reference to parked lander
let interactable = null;    // the fuel cart (stub)
let disposables = [];
let onReturnToLanderCallback = null;

export const WalkMode = {
  enter(context, callbacks = {}) {
    console.log('▶ WalkMode.enter');
    onReturnToLanderCallback = callbacks.onReturnToLander || (() => {});

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    scene.fog = new THREE.Fog(0x0a0a1a, 50, 300);

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(PERSP_FOV, aspect, PERSP_NEAR, PERSP_FAR);

    buildLighting();
    buildGround();
    buildAstronaut();
    buildParkedLander();
    buildFuelCart();

    // PointerLockControls for mouse-look. Attaches to document.body — click
    // the canvas to engage pointer lock.
    controls = new PointerLockControls(camera, context.canvas);
    context.canvas.addEventListener('click', () => controls.lock(), { once: false });

    GameState.mode = MODE.WALK;
    notify('mode');

    setCenterMessage('CLICK TO LOOK AROUND\nWASD TO MOVE · E TO INTERACT');
  },

  exit() {
    console.log('◀ WalkMode.exit');
    controls?.unlock();
    controls?.dispose?.();
    controls = null;

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
    astronaut = null;
    landerModel = null;
    interactable = null;
  },

  update(dt) {
    // Astronaut movement — tank controls (simple and predictable).
    // WASD: W forward, S back, A/D turn. Mouse handles camera look.
    if (Input.isDown('a') || Input.isDown('A')) astronaut.rotation.y += WALK_TURN_SPEED * dt;
    if (Input.isDown('d') || Input.isDown('D')) astronaut.rotation.y -= WALK_TURN_SPEED * dt;

    const forward = new THREE.Vector3(
      -Math.sin(astronaut.rotation.y), 0, -Math.cos(astronaut.rotation.y)
    );
    if (Input.isDown('w') || Input.isDown('W')) astronaut.position.addScaledVector(forward,  WALK_SPEED * dt);
    if (Input.isDown('s') || Input.isDown('S')) astronaut.position.addScaledVector(forward, -WALK_SPEED * dt);

    // Third-person chase camera: position behind astronaut, looking at head.
    // The PointerLockControls applies to the camera directly, so we only
    // snap the camera back into position if not locked. When locked, we let
    // the player orbit — simplest third-person approach.
    if (!controls.isLocked) {
      const camPos = astronaut.position.clone()
        .add(forward.clone().multiplyScalar(-WALK_CAMERA_DISTANCE))
        .add(new THREE.Vector3(0, WALK_CAMERA_HEIGHT, 0));
      camera.position.copy(camPos);
      camera.lookAt(astronaut.position.x, astronaut.position.y + 2, astronaut.position.z);
    }

    // Interaction prompt
    const distToCart = astronaut.position.distanceTo(interactable.position);
    if (distToCart < WALK_INTERACT_RADIUS) {
      setCenterMessage('PRESS E TO LOAD FUEL');
      if (Input.wasPressed('e') || Input.wasPressed('E')) loadFuelFromCart();
    } else {
      const distToLander = astronaut.position.distanceTo(landerModel.position);
      if (distToLander < WALK_INTERACT_RADIUS) {
        setCenterMessage('PRESS E TO BOARD LANDER');
        if (Input.wasPressed('e') || Input.wasPressed('E')) {
          onReturnToLanderCallback();
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
  getAstronaut() { return astronaut; }
};

// ---------- helpers ----------

function buildLighting() {
  const ambient = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambient);
  // Sunlight — harsh, moonlike. One directional light, no shadows for perf.
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(50, 80, 30);
  scene.add(sun);
}

function buildGround() {
  const geom = new THREE.PlaneGeometry(400, 400, 20, 20);
  const mat  = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);
  disposables.push({ geometry: geom, material: mat });
  // TODO: replace with heightmapped moon terrain, crater decals, etc.
}

function buildAstronaut() {
  // Placeholder: capsule. Replace with a GLTF astronaut when available.
  astronaut = new THREE.Group();
  const geom = new THREE.CapsuleGeometry(1.5, 2.5, 4, 8);
  const mat  = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const body = new THREE.Mesh(geom, mat);
  body.position.y = 2.5;
  astronaut.add(body);
  // Forward indicator so you can tell which way "front" is on the capsule.
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1, 6),
    new THREE.MeshLambertMaterial({ color: 0xff3030 })
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 3, -1.6);
  astronaut.add(nose);
  astronaut.position.set(5, 0, 5);
  scene.add(astronaut);
  disposables.push({ geometry: geom, material: mat });
  disposables.push({ geometry: nose.geometry, material: nose.material });
}

function buildParkedLander() {
  // Stub: small box at origin representing where the lander came down.
  // In a fuller implementation, LanderMode.getLander() could be re-parented
  // into this scene for visual continuity. For now, a separate model.
  const geom = new THREE.BoxGeometry(6, 8, 6);
  const mat  = new THREE.MeshLambertMaterial({ color: 0xbbbbbb });
  landerModel = new THREE.Mesh(geom, mat);
  landerModel.position.set(0, 4, 0);
  scene.add(landerModel);
  disposables.push({ geometry: geom, material: mat });
}

function buildFuelCart() {
  const geom = new THREE.BoxGeometry(4, 2, 2);
  const mat  = new THREE.MeshLambertMaterial({ color: 0xffaa00 });
  interactable = new THREE.Mesh(geom, mat);
  interactable.position.set(20, 1, 10);
  scene.add(interactable);
  disposables.push({ geometry: geom, material: mat });
}

function loadFuelFromCart() {
  // Example interaction: add fuel directly to GameState.
  // The lander will see the new total as soon as we return.
  const gained = 250;
  const cap = GameState.fuel.capacity - GameState.fuel.current;
  const actual = Math.min(gained, cap);
  GameState.fuel.current += actual;
  notify('fuel');
  setCenterMessage(`+${actual.toFixed(0)} FUEL LOADED`);
  console.log(`✅ Walk interaction: +${actual} fuel. Total: ${GameState.fuel.current}`);
  // Move the cart away so user can't spam (temporary — better: mark as used)
  interactable.position.set(1000, 1000, 1000);
}
