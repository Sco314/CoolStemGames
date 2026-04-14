/**
 * Collatz Spiral mode.
 * Each step in a sequence is a unit segment. The heading turns by
 * a fixed angle depending on parity — odd and even turn opposite
 * directions. Multiple sequences draw overlapping curves that
 * reveal the fractal structure of Collatz trajectories.
 *
 * All sequences end at 1 and share the same 4→2→1 tail, so they
 * converge on a common "home" point at the end.
 */

import * as THREE from 'three';
import { collatzValues } from './collatz.js';
import { isEven, valueKey, formatValue } from './valueUtils.js';

// ── Constants ────────────────────────────────────────────
const SEGMENT_LENGTH = 0.4;
const TURN_EVEN = 0.20;   // radians, turn right on even steps (n/2)
const TURN_ODD = -0.32;   // radians, turn left on odd steps (3n+1)
const LINE_RADIUS = 0.045;
const DRAW_DURATION = 2.2;

const COLORS = [
  0xff6b4a, 0x4a9aff, 0xffd866, 0x4fb06f,
  0xaa66cc, 0xff9a4a, 0x6ad4e0, 0xd04a88,
];

// ── State ────────────────────────────────────────────────
let group = null;
let active = false;
let sequences = [];   // { startValue, color, mesh, drawProgress, points }

// ── Public API ───────────────────────────────────────────
export function initSpiral(scene) {
  group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // Small marker at origin (the "home" anchor for all sequences)
  const anchorGeo = new THREE.SphereGeometry(0.18, 16, 12);
  const anchorMat = new THREE.MeshStandardMaterial({
    color: 0xd4a84a,
    emissive: 0xd4a84a,
    emissiveIntensity: 0.6,
    metalness: 0.3,
    roughness: 0.4,
  });
  const anchor = new THREE.Mesh(anchorGeo, anchorMat);
  group.add(anchor);
}

export function showSpiral() {
  if (group) group.visible = true;
  active = true;
}

export function hideSpiral() {
  if (group) group.visible = false;
  active = false;
}

export function isSpiralActive() { return active; }
export function getSpiralGroup() { return group; }

export function clearSpiral() {
  for (const seq of sequences) {
    if (seq.mesh) {
      group.remove(seq.mesh);
      seq.mesh.geometry.dispose();
      seq.mesh.material.dispose();
    }
  }
  sequences = [];
}

/**
 * Add a Collatz sequence to the spiral visualization.
 * The path is drawn from the starting number, turning at each step,
 * and terminating at the origin (value 1).
 */
export function addSpiralNumber(n) {
  const nKey = valueKey(n);
  if (sequences.some(s => valueKey(s.startValue) === nKey)) return;

  const values = collatzValues(n);
  if (values.length < 2) return;

  // Compute points: start at origin going up, accumulate positions
  // by taking a segment and turning based on parity.
  // We build the path BACKWARDS (from 1 outward) so all sequences
  // share the same initial direction and the tail anchors at origin.
  const reversed = [...values].reverse(); // [1, ..., n]

  const pts = [];
  let x = 0, y = 0;
  let heading = Math.PI / 2; // start pointing "up"
  pts.push(new THREE.Vector3(x, y, 0));

  for (let i = 0; i < reversed.length - 1; i++) {
    const cur = reversed[i];
    const next = reversed[i + 1];
    // Turn based on the parity of the next value in the reversed walk
    // (equivalent: parity of this step's transition)
    // When walking backwards, going from 1 → 2 was a "even step" (2 was the predecessor via n/2)
    // Use parity of `next` to decide turn direction
    heading += isEven(next) ? TURN_EVEN : TURN_ODD;

    x += Math.cos(heading) * SEGMENT_LENGTH;
    y += Math.sin(heading) * SEGMENT_LENGTH;
    pts.push(new THREE.Vector3(x, y, 0));
  }

  const color = COLORS[sequences.length % COLORS.length];
  const seq = {
    startValue: n,
    color,
    points: pts,
    mesh: null,
    drawProgress: 0,
  };
  sequences.push(seq);

  buildMesh(seq);
}

/**
 * Update frame: animate draw-in of new sequences.
 */
export function updateSpiral(dt) {
  if (!active) return;
  for (const seq of sequences) {
    if (seq.drawProgress < 1) {
      seq.drawProgress = Math.min(1, seq.drawProgress + dt / DRAW_DURATION);
      updateReveal(seq);
    }
  }
}

/**
 * Suggested camera position based on the current spiral extents.
 */
export function getSpiralCameraTarget() {
  const box = new THREE.Box3();
  for (const seq of sequences) {
    for (const p of seq.points) box.expandByPoint(p);
  }
  if (box.isEmpty()) {
    return {
      center: new THREE.Vector3(0, 0, 0),
      position: new THREE.Vector3(0, 0, 15),
    };
  }
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = box.getSize(new THREE.Vector3());
  const dist = Math.max(size.x, size.y) * 1.3 + 4;
  return {
    center,
    position: new THREE.Vector3(center.x, center.y, dist),
  };
}

// ── Internal ─────────────────────────────────────────────
function buildMesh(seq) {
  if (seq.points.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(seq.points, false, 'catmullrom', 0.3);
  const segments = Math.min(Math.max(seq.points.length * 2, 24), 300);
  const geo = new THREE.TubeGeometry(curve, segments, LINE_RADIUS, 4, false);
  geo.setDrawRange(0, 0);

  const mat = new THREE.MeshStandardMaterial({
    color: seq.color,
    emissive: seq.color,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.85,
    metalness: 0.2,
    roughness: 0.5,
  });
  seq.mesh = new THREE.Mesh(geo, mat);
  group.add(seq.mesh);
}

function updateReveal(seq) {
  if (!seq.mesh) return;
  const totalIdx = seq.mesh.geometry.index.count;
  seq.mesh.geometry.setDrawRange(0, Math.floor(seq.drawProgress * totalIdx));
}
