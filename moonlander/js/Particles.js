// Particles.js — v0.2.0
// Two particle systems used in lander mode:
//   - ParticleSystemCone: thruster exhaust streaming opposite the lander's
//     thrust axis while emitting=true. Yellow→red lerp, falls slightly with
//     gravity, slows with drag.
//   - ParticleSystemExplosion: one-shot radial burst on crash. emit() activates
//     all particles simultaneously with random radial velocities.
//
// Each system pre-allocates a fixed-size pool of plane meshes with shared
// PlaneGeometry but per-particle MeshBasicMaterial (so we can tween color and
// opacity per particle). All meshes live in the scene at all times; inactive
// particles are hidden via mesh.visible = false.

import * as THREE from 'three';
import { getQualityFactor } from './Quality.js';
import { scalePool, LOW_END } from './Device.js';
import { getSharedTexture } from './AssetCache.js';
import {
  GRAVITY,
  CONE_PS_MAX_PARTICLES, CONE_PS_PER_SEC_MIN, CONE_PS_PER_SEC_MAX,
  CONE_PS_LIFETIME_MIN, CONE_PS_LIFETIME_MAX,
  CONE_PS_HALF_ANGLE, CONE_PS_SPAWN_WIDTH, CONE_PS_SPAWN_OFFSET,
  CONE_PS_SPEED_MIN, CONE_PS_SPEED_MAX,
  CONE_PS_DRAG, CONE_PS_GRAVITY_FACTOR,
  CONE_PS_COLOR_START, CONE_PS_COLOR_END,
  CONE_PS_OPACITY_START, CONE_PS_OPACITY_END,
  CONE_PS_SCALE_START, CONE_PS_SCALE_END,
  CONE_PS_PARTICLE_SIZE,
  EXPLOSION_PS_MAX_PARTICLES,
  EXPLOSION_PS_LIFETIME_MIN, EXPLOSION_PS_LIFETIME_MAX,
  EXPLOSION_PS_SPEED_MIN, EXPLOSION_PS_SPEED_MAX,
  EXPLOSION_PS_DRAG, EXPLOSION_PS_GRAVITY_FACTOR,
  EXPLOSION_PS_COLOR_START, EXPLOSION_PS_COLOR_END,
  EXPLOSION_PS_OPACITY_START, EXPLOSION_PS_OPACITY_END,
  EXPLOSION_PS_SCALE_START, EXPLOSION_PS_SCALE_END,
  EXPLOSION_PS_PARTICLE_SIZE
} from './Constants.js';

const _scratchVec = new THREE.Vector3();
const _scratchColor = new THREE.Color();
const _colorStartCone = new THREE.Color(CONE_PS_COLOR_START);
const _colorEndCone   = new THREE.Color(CONE_PS_COLOR_END);
const _colorStartExp  = new THREE.Color(EXPLOSION_PS_COLOR_START);
const _colorEndExp    = new THREE.Color(EXPLOSION_PS_COLOR_END);

function rand(min, max) { return min + Math.random() * (max - min); }

// ------------------------------------------------------------------
// Internal pool helper — both systems share the same mesh-pool shape.

// Soft-glow PNG shared by every particle material. Optional — if the file
// is missing the loader's onError silently leaves `map` null, which renders
// as a solid colored quad (the original look).
const _particleTex = getSharedTexture('textures/particle.png');

function buildPool(scene, size, particleSize) {
  const geom = new THREE.PlaneGeometry(particleSize, particleSize);
  const pool = new Array(size);
  for (let i = 0; i < size; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: _particleTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.visible = false;
    scene.add(mesh);
    pool[i] = {
      mesh, mat,
      vx: 0, vy: 0,
      life: 0, lifeMax: 0,
      active: false,
      // Per-particle overrides (used by emit(opts)). null → fall back to
      // the system's module-level constants in update().
      colorStart: null,
      colorEnd: null,
      gravityScale: 1
    };
  }
  return { geom, pool };
}

function disposePool(pool, geom, scene) {
  for (const p of pool) {
    scene.remove(p.mesh);
    p.mat.dispose();
  }
  geom.dispose();
}

// ------------------------------------------------------------------

export class ParticleSystemCone {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Object3D} targetObject — particles spawn at its world position,
   *        in the direction opposite its local +Y axis (i.e. behind the thrust).
   */
  constructor(scene, targetObject) {
    this.scene = scene;
    this.target = targetObject;
    this.emitting = false;
    this._emitBacklog = 0;

    // Low-end devices (Chromebooks, older phones) get a smaller pool so we
    // don't thrash the GPU or run out of memory. The adaptive-quality path
    // still scales emit rate on top of this.
    const poolSize = scalePool(CONE_PS_MAX_PARTICLES);
    const built = buildPool(scene, poolSize, CONE_PS_PARTICLE_SIZE);
    this._geom = built.geom;
    this._pool = built.pool;
  }

  update(dt) {
    // Spawn new particles based on emit rate (only while emitting). Adaptive
    // quality scales the rate so low-FPS devices emit fewer per second;
    // low-end devices additionally get a baseline rate cut.
    if (this.emitting) {
      const qf = getQualityFactor() * (LOW_END ? 0.55 : 1);
      const rate = rand(CONE_PS_PER_SEC_MIN, CONE_PS_PER_SEC_MAX) * qf;
      this._emitBacklog += rate * dt;
      const toSpawn = Math.floor(this._emitBacklog);
      this._emitBacklog -= toSpawn;
      for (let i = 0; i < toSpawn; i++) this._spawnOne();
    } else {
      this._emitBacklog = 0;
    }

    // Integrate every active particle.
    const dragMul = Math.exp(-CONE_PS_DRAG * dt);
    const gPerStep = -GRAVITY * CONE_PS_GRAVITY_FACTOR * dt;
    for (const p of this._pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vy += gPerStep;
      p.vx *= dragMul;
      p.vy *= dragMul;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;

      // Lerp color/opacity/scale by life-progress (1 = newborn, 0 = dead).
      const t = 1 - (p.life / p.lifeMax);
      _scratchColor.copy(_colorStartCone).lerp(_colorEndCone, t);
      p.mat.color.copy(_scratchColor);
      p.mat.opacity = CONE_PS_OPACITY_START + (CONE_PS_OPACITY_END - CONE_PS_OPACITY_START) * t;
      const s = CONE_PS_SCALE_START + (CONE_PS_SCALE_END - CONE_PS_SCALE_START) * t;
      p.mesh.scale.set(s, s, 1);
    }
  }

  _spawnOne() {
    // Find a free slot. With backlog rate ≤ MAX, the pool should have one.
    let p = null;
    for (let i = 0; i < this._pool.length; i++) {
      if (!this._pool[i].active) { p = this._pool[i]; break; }
    }
    if (!p) return;

    // The lander's local +Y is the thrust direction. Exhaust shoots out -Y in
    // local space, then rotated into world via the lander's rotation.
    const angleZ = this.target.rotation.z;
    const fwdX = -Math.sin(angleZ); // lander forward (thrust direction) in world
    const fwdY =  Math.cos(angleZ);
    const sideX =  fwdY;            // perpendicular, used for the spawn rectangle
    const sideY = -fwdX;

    // World position of the lander.
    this.target.getWorldPosition(_scratchVec);

    // Spawn point: offset behind the lander by SPAWN_OFFSET, jittered along the
    // perpendicular axis by SPAWN_WIDTH.
    const sideJitter = (Math.random() - 0.5) * CONE_PS_SPAWN_WIDTH;
    p.mesh.position.set(
      _scratchVec.x - fwdX * CONE_PS_SPAWN_OFFSET + sideX * sideJitter,
      _scratchVec.y - fwdY * CONE_PS_SPAWN_OFFSET + sideY * sideJitter,
      0
    );

    // Velocity: shoot opposite to thrust (-fwd), within a cone half-angle.
    const halfAngle = (Math.random() - 0.5) * 2 * CONE_PS_HALF_ANGLE;
    const cos = Math.cos(halfAngle), sin = Math.sin(halfAngle);
    const dirX = -fwdX * cos + sideX * sin;
    const dirY = -fwdY * cos + sideY * sin;
    const speed = rand(CONE_PS_SPEED_MIN, CONE_PS_SPEED_MAX);
    p.vx = dirX * speed;
    p.vy = dirY * speed;

    // Reset lifetime + visuals.
    p.lifeMax = rand(CONE_PS_LIFETIME_MIN, CONE_PS_LIFETIME_MAX);
    p.life = p.lifeMax;
    p.active = true;
    p.mesh.visible = true;
    p.mat.color.copy(_colorStartCone);
    p.mat.opacity = CONE_PS_OPACITY_START;
    p.mesh.scale.set(CONE_PS_SCALE_START, CONE_PS_SCALE_START, 1);
  }

  dispose() {
    disposePool(this._pool, this._geom, this.scene);
    this._pool = [];
  }
}

// ------------------------------------------------------------------

export class ParticleSystemExplosion {
  constructor(scene, targetObject) {
    this.scene = scene;
    this.target = targetObject;

    const poolSize = scalePool(EXPLOSION_PS_MAX_PARTICLES);
    const built = buildPool(scene, poolSize, EXPLOSION_PS_PARTICLE_SIZE);
    this._geom = built.geom;
    this._pool = built.pool;
  }

  /**
   * Activate particles with random radial velocities. The default (no opts)
   * matches the original crash burst — every particle in the pool fires at
   * once with the EXPLOSION_PS_* constants. Per-call overrides let callers
   * tune the same pool for smaller, differently-colored bursts (dust puff
   * on landing, sparks on terrain scrape) without a second particle system.
   *
   * @param {object} [opts]
   * @param {number} [opts.count]        Cap on particles activated this call.
   * @param {number} [opts.colorStart]   Hex color (0xRRGGBB) replacing module default.
   * @param {number} [opts.colorEnd]     Hex color end of the per-particle lerp.
   * @param {number} [opts.speedMin]
   * @param {number} [opts.speedMax]
   * @param {number} [opts.lifetimeMin]
   * @param {number} [opts.lifetimeMax]
   * @param {number} [opts.originX]      World x; defaults to target world pos.
   * @param {number} [opts.originY]      World y; defaults to target world pos.
   * @param {number} [opts.gravityScale] Multiplier on EXPLOSION_PS_GRAVITY_FACTOR.
   */
  emit(opts) {
    const o = opts || {};
    const speedMin    = (o.speedMin    != null) ? o.speedMin    : EXPLOSION_PS_SPEED_MIN;
    const speedMax    = (o.speedMax    != null) ? o.speedMax    : EXPLOSION_PS_SPEED_MAX;
    const lifetimeMin = (o.lifetimeMin != null) ? o.lifetimeMin : EXPLOSION_PS_LIFETIME_MIN;
    const lifetimeMax = (o.lifetimeMax != null) ? o.lifetimeMax : EXPLOSION_PS_LIFETIME_MAX;
    const gravityScale = (o.gravityScale != null) ? o.gravityScale : 1;
    const colorStart = (o.colorStart != null) ? new THREE.Color(o.colorStart) : null;
    const colorEnd   = (o.colorEnd   != null) ? new THREE.Color(o.colorEnd)   : null;
    const startColor = colorStart || _colorStartExp;

    let ox, oy;
    if (o.originX != null && o.originY != null) {
      ox = o.originX; oy = o.originY;
    } else {
      this.target.getWorldPosition(_scratchVec);
      ox = (o.originX != null) ? o.originX : _scratchVec.x;
      oy = (o.originY != null) ? o.originY : _scratchVec.y;
    }

    // Default behavior (no count): activate every particle, matching the
    // legacy emit() that callers expect on a full crash. With count, prefer
    // inactive slots so a follow-up burst doesn't yank a still-flying one.
    const limited = (o.count != null);
    const cap = limited ? Math.min(o.count, this._pool.length) : this._pool.length;
    let activated = 0;
    for (const p of this._pool) {
      if (activated >= cap) break;
      if (limited && p.active) continue;
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(speedMin, speedMax);
      p.mesh.position.set(ox, oy, 0);
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.lifeMax = rand(lifetimeMin, lifetimeMax);
      p.life = p.lifeMax;
      p.active = true;
      p.mesh.visible = true;
      p.colorStart = colorStart;
      p.colorEnd   = colorEnd;
      p.gravityScale = gravityScale;
      p.mat.color.copy(startColor);
      p.mat.opacity = EXPLOSION_PS_OPACITY_START;
      p.mesh.scale.set(EXPLOSION_PS_SCALE_START, EXPLOSION_PS_SCALE_START, 1);
      activated++;
    }
  }

  update(dt) {
    const dragMul = Math.exp(-EXPLOSION_PS_DRAG * dt);
    const baseGStep = -GRAVITY * EXPLOSION_PS_GRAVITY_FACTOR * dt;
    for (const p of this._pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        // Drop per-call overrides so the slot is clean for the next burst.
        p.colorStart = null;
        p.colorEnd = null;
        p.gravityScale = 1;
        continue;
      }
      p.vy += baseGStep * (p.gravityScale != null ? p.gravityScale : 1);
      p.vx *= dragMul;
      p.vy *= dragMul;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;

      const t = 1 - (p.life / p.lifeMax);
      const cs = p.colorStart || _colorStartExp;
      const ce = p.colorEnd   || _colorEndExp;
      _scratchColor.copy(cs).lerp(ce, t);
      p.mat.color.copy(_scratchColor);
      p.mat.opacity = EXPLOSION_PS_OPACITY_START + (EXPLOSION_PS_OPACITY_END - EXPLOSION_PS_OPACITY_START) * t;
      const s = EXPLOSION_PS_SCALE_START + (EXPLOSION_PS_SCALE_END - EXPLOSION_PS_SCALE_START) * t;
      p.mesh.scale.set(s, s, 1);
    }
  }

  dispose() {
    disposePool(this._pool, this._geom, this.scene);
    this._pool = [];
  }
}
