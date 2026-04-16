/**
 * 3D graph: node/edge management, layout modes, force-directed physics.
 * Each Collatz value gets one shared node. Edges connect value → successor.
 *
 * Layout modes:
 *   'particles'  – force-directed (organic clustering, no math meaning)
 *   'value'      – Y = log2(value), golden-angle spiral on XZ
 *   'parity'     – even left / odd right, Y = log2(value)
 *   'stopping'   – concentric rings by stopping time
 */

import * as THREE from 'three';
import { isClimber } from './collatz.js';
import { log2 } from './valueUtils.js';
import {
  NODE_BASE_RADIUS, NODE_SCALE_LOG_BASE, NODE_MIN_RADIUS, NODE_MAX_RADIUS,
  ANCHOR_RADIUS, ANCHOR_COLOR, EDGE_OPACITY,
  REPULSION_STRENGTH, SPRING_LENGTH, SPRING_STIFFNESS,
  GRAVITY_STRENGTH, LAYOUT_DAMPING, LAYOUT_MIN_VELOCITY,
  CLIMBER_EMISSIVE, FALLER_EMISSIVE,
  ANCHOR_PULSE_PERIOD, ANCHOR_PULSE_MIN, ANCHOR_PULSE_MAX,
  COLOR_RAMP,
} from './constants.js';

// ── State ────────────────────────────────────────────────
const nodes = new Map();   // value → node object (insertion order = age, oldest first)
const edges = new Map();   // "from-to" → edge object
let group = null;
let maxStoppingTime = 0;
let settled = true;

// ── Memory ceilings ──────────────────────────────────────
// Hardware safety cap: the rubberband slider cannot exceed this.
// Picked conservatively for mid-tier mobile GPUs.
export const MAX_VISIBLE_NODES = 5000;
let visibleMax = 100;   // current soft ceiling (user-controlled via slider)

// Recent-nodes ring buffer for raycast candidates (keeps tooltip O(small-N)).
const RECENT_RING_SIZE = 200;
const recentNodes = [];  // [value, value, ...] — most recent at end

// ── Layout mode ──────────────────────────────────────────
let currentMode = 'particles';
const MODE_TRANSITION_SPEED = 0.04;  // lerp factor per frame toward targets

export const MODES = ['particles', 'value', 'parity', 'stopping', 'stopping-value', 'stopping-parity', 'stopping-tree', 'numberline'];

export function getMode() { return currentMode; }

export function setMode(mode) {
  if (!MODES.includes(mode)) return;
  currentMode = mode;
  if (mode !== 'particles') {
    computeTargets(mode);
    // Clear velocities so force-sim doesn't fight the transition
    for (const node of nodes.values()) {
      node.vel.set(0, 0, 0);
    }
  }
  settled = false;
}

export function getGroup() { return group; }
export function getNodes() { return nodes; }
export function getEdges() { return edges; }
export function getMaxStoppingTime() { return maxStoppingTime; }
export function isSettled() { return settled; }

// ── Init ─────────────────────────────────────────────────
export function initGraph(scene) {
  group = new THREE.Group();
  scene.add(group);
  addNode(1, 0, true);
}

// ── Color ramp ───────────────────────────────────────────
function sampleRamp(t) {
  t = Math.max(0, Math.min(1, t));
  const n = COLOR_RAMP.length - 1;
  const i = Math.floor(t * n);
  const f = t * n - i;
  const a = COLOR_RAMP[Math.min(i, n)];
  const b = COLOR_RAMP[Math.min(i + 1, n)];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

export function colorForStoppingTime(st) {
  if (maxStoppingTime === 0) return new THREE.Color(...COLOR_RAMP[0]);
  const t = st / maxStoppingTime;
  const [r, g, b] = sampleRamp(t);
  return new THREE.Color(r, g, b);
}

export function colorHexForStoppingTime(st) {
  return '#' + colorForStoppingTime(st).getHexString();
}

// ── Node size ────────────────────────────────────────────
function radiusForValue(value) {
  if (value === 1) return ANCHOR_RADIUS;
  // Use log2 helper so BigInt values don't silently coerce to Infinity
  // through Number(v) above 2^53.
  const lg = log2(value);  // ≈ log2
  const r = NODE_BASE_RADIUS * (1 + (lg * Math.LN2) / Math.log(NODE_SCALE_LOG_BASE) * 0.012);
  return Math.max(NODE_MIN_RADIUS, Math.min(NODE_MAX_RADIUS, r));
}

// ── Create a label sprite ────────────────────────────────
function makeLabelSprite(text, radius) {
  const canvas = document.createElement('canvas');
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#e0e6f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontSize = Math.max(20, Math.min(56, 56 - text.length * 4));
  ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
  ctx.fillText(text, size / 2, size / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const scale = radius * 2.2;
  sprite.scale.set(scale, scale, 1);
  sprite.renderOrder = 1;
  return sprite;
}

// ── Add node ─────────────────────────────────────────────
export function addNode(value, stoppingTime, immediate = false) {
  if (nodes.has(value)) return nodes.get(value);

  const radius = radiusForValue(value);
  const geo = new THREE.SphereGeometry(radius, 24, 18);
  const isAnchor = value === 1;
  const color = isAnchor
    ? new THREE.Color(...ANCHOR_COLOR)
    : colorForStoppingTime(stoppingTime);
  const emissiveIntensity = isAnchor ? ANCHOR_PULSE_MIN
    : (isClimber(value) ? CLIMBER_EMISSIVE : FALLER_EMISSIVE);

  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color.clone(),
    emissiveIntensity,
    metalness: 0.25,
    roughness: 0.55,
  });
  const mesh = new THREE.Mesh(geo, mat);

  if (isAnchor) {
    mesh.position.set(0, 0, 0);
  } else {
    const angle = Math.random() * Math.PI * 2;
    const dist = SPRING_LENGTH * 0.8;
    mesh.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, (Math.random() - 0.5) * 2);
  }

  if (!immediate) {
    mesh.scale.setScalar(0.001);
  }

  mesh.userData.collatzValue = value;
  group.add(mesh);

  const label = makeLabelSprite(String(value), radius);
  mesh.add(label);

  const node = {
    value,
    stoppingTime,
    mesh,
    label,
    radius,
    vel: new THREE.Vector3(),
    target: null,         // target position for deterministic modes
    pinned: isAnchor,
    targetScale: 1,
    currentScale: immediate ? 1 : 0.001,
    popStartTime: -1,
  };

  if (stoppingTime > maxStoppingTime) {
    maxStoppingTime = stoppingTime;
  }

  nodes.set(value, node);
  pushRecent(value);
  settled = false;

  // If we're in a deterministic mode, compute target for the new node
  if (currentMode !== 'particles') {
    computeTargets(currentMode);
  }

  // Evict oldest (LRU) if we've exceeded the soft ceiling. The anchor
  // (value === 1) is pinned and never evicted.
  evictOldestIfOverCap();

  return node;
}

// ── LRU eviction ─────────────────────────────────────────
function evictOldestIfOverCap() {
  if (nodes.size <= visibleMax) return;
  // Map preserves insertion order. Walk oldest first, skip anchor.
  const iter = nodes.keys();
  while (nodes.size > visibleMax) {
    const next = iter.next();
    if (next.done) break;
    const val = next.value;
    if (val === 1) continue;   // never evict anchor
    removeNode(val);
  }
}

function pushRecent(value) {
  recentNodes.push(value);
  if (recentNodes.length > RECENT_RING_SIZE) {
    recentNodes.splice(0, recentNodes.length - RECENT_RING_SIZE);
  }
}

/**
 * Remove a node and all its edges. Disposes GPU resources.
 */
export function removeNode(value) {
  const node = nodes.get(value);
  if (!node) return;
  if (node.mesh) {
    group.remove(node.mesh);
    // Label is a child sprite on the mesh
    if (node.label) {
      node.mesh.remove(node.label);
      node.label.material.map?.dispose();
      node.label.material.dispose();
    }
    node.mesh.geometry.dispose();
    node.mesh.material.dispose();
  }
  // Dispose edges touching this node
  for (const [key, edge] of edges) {
    if (edge.fromVal === value || edge.toVal === value) {
      group.remove(edge.line);
      edge.line.geometry.dispose();
      edge.line.material.dispose();
      edges.delete(key);
    }
  }
  treeArcs.delete(value);
  nodes.delete(value);
  // Remove from recent ring buffer if present
  for (let i = recentNodes.length - 1; i >= 0; i--) {
    if (recentNodes[i] === value) recentNodes.splice(i, 1);
  }
}

/**
 * Set the soft ceiling on visible nodes. Capped at MAX_VISIBLE_NODES
 * for hardware safety. Evicts oldest nodes immediately if over cap.
 */
export function setGraphVisibleMax(n) {
  visibleMax = Math.max(1, Math.min(n | 0, MAX_VISIBLE_NODES));
  evictOldestIfOverCap();
}

export function getGraphVisibleMax() { return visibleMax; }

/**
 * Raycast candidate list. Returns the most recently added meshes so
 * hover tooltip work is O(recent) not O(all-nodes).
 */
export function getRaycastCandidates() {
  const out = [];
  for (const v of recentNodes) {
    const n = nodes.get(v);
    if (n && n.mesh) out.push(n.mesh);
  }
  return out;
}

// ── Add edge ─────────────────────────────────────────────
export function addEdge(fromVal, toVal) {
  const key = `${fromVal}-${toVal}`;
  if (edges.has(key)) return edges.get(key);

  const fromNode = nodes.get(fromVal);
  const toNode = nodes.get(toVal);
  if (!fromNode || !toNode) return null;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(6);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const colors = new Float32Array(6);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: EDGE_OPACITY,
    depthTest: true,
  });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = -1;
  group.add(line);

  const edge = { line, fromVal, toVal, visible: true };
  edges.set(key, edge);
  settled = false;

  updateEdgePositions(edge);
  updateEdgeColors(edge);

  return edge;
}

// ── Update helpers ───────────────────────────────────────
function updateEdgePositions(edge) {
  const fromNode = nodes.get(edge.fromVal);
  const toNode = nodes.get(edge.toVal);
  if (!fromNode || !toNode) return;

  const pos = edge.line.geometry.attributes.position;
  pos.setXYZ(0, fromNode.mesh.position.x, fromNode.mesh.position.y, fromNode.mesh.position.z);
  pos.setXYZ(1, toNode.mesh.position.x, toNode.mesh.position.y, toNode.mesh.position.z);
  pos.needsUpdate = true;
}

function updateEdgeColors(edge) {
  const fromNode = nodes.get(edge.fromVal);
  const toNode = nodes.get(edge.toVal);
  if (!fromNode || !toNode) return;

  const fc = fromNode.mesh.material.color;
  const tc = toNode.mesh.material.color;
  const col = edge.line.geometry.attributes.color;
  col.setXYZ(0, fc.r, fc.g, fc.b);
  col.setXYZ(1, tc.r, tc.g, tc.b);
  col.needsUpdate = true;
}

// ═══════════════════════════════════════════════════════════
// ── TARGET POSITION COMPUTATION PER MODE ─────────────────
// ═══════════════════════════════════════════════════════════

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.5°

function computeTargets(mode) {
  // Tree sub-mode needs a pre-pass to compute arc assignments
  if (mode === 'stopping-tree') {
    computeTreeArcs();
  }

  for (const node of nodes.values()) {
    if (node.value === 1) {
      node.target = new THREE.Vector3(0, 0, 0);
      continue;
    }
    switch (mode) {
      case 'value':          node.target = targetValue(node); break;
      case 'parity':         node.target = targetParity(node); break;
      case 'stopping':       node.target = targetStopping(node); break;
      case 'stopping-value': node.target = targetStoppingValue(node); break;
      case 'stopping-parity':node.target = targetStoppingParity(node); break;
      case 'stopping-tree':  node.target = targetStoppingTree(node); break;
    }
  }
}

/**
 * Mode: Value
 * Y = log2(value) — height encodes magnitude.
 * XZ = golden-angle spiral — spreads nodes at similar heights apart.
 * Creates a vertical "tower" showing how values climb and fall.
 */
function targetValue(node) {
  const y = Math.log2(node.value) * 2.0;
  const angle = node.value * GOLDEN_ANGLE;
  const spread = 1.2 + Math.log2(node.value) * 0.3;
  const x = Math.cos(angle) * spread;
  const z = Math.sin(angle) * spread;
  return new THREE.Vector3(x, y, z);
}

/**
 * Mode: Parity
 * Even nodes on the left (X < 0), odd nodes on the right (X > 0).
 * Y = log2(value) for vertical spread.
 * Within each side, Z spreads nodes using golden angle.
 * Shows how edges constantly cross between even/odd columns.
 */
function targetParity(node) {
  const even = node.value % 2 === 0;
  const side = even ? -1 : 1;
  const y = Math.log2(node.value) * 2.0;
  // Spread within each column using golden angle
  const angle = node.value * GOLDEN_ANGLE;
  const spread = 0.8 + Math.log2(node.value) * 0.15;
  const x = side * (3.0 + Math.abs(Math.cos(angle)) * spread);
  const z = Math.sin(angle) * spread;
  return new THREE.Vector3(x, y, z);
}

/**
 * Mode: Stopping Time
 * Concentric rings: radius = stoppingTime, angle = golden angle by value.
 * Y = small offset per ring so they separate vertically.
 * Node 1 sits at center (stopping time 0).
 * Shows how far each number is from reaching 1.
 */
function targetStopping(node) {
  const st = node.stoppingTime;
  const ringRadius = st * 0.8 + 0.5;
  const angle = node.value * GOLDEN_ANGLE;
  const x = Math.cos(angle) * ringRadius;
  const z = Math.sin(angle) * ringRadius;
  const y = st * 0.3;  // gentle rise so rings separate in 3D
  return new THREE.Vector3(x, y, z);
}

/**
 * Sub-mode: Stopping Time + Value angle
 * Same rings as stopping time, but angle = log2(value) normalized to [0, 2π].
 * Small numbers cluster on one side of each ring, large numbers on the other.
 * Both distance AND angle now encode real math.
 */
function targetStoppingValue(node) {
  const st = node.stoppingTime;
  const ringRadius = st * 0.8 + 0.5;
  // Angle from log2(value), scaled so the full range of values in the graph
  // spans roughly 0 to 2π. Using log2 keeps it readable.
  const maxLog = Math.log2(getMaxValueInGraph() || 2);
  const angle = (Math.log2(node.value) / maxLog) * Math.PI * 2;
  const x = Math.cos(angle) * ringRadius;
  const z = Math.sin(angle) * ringRadius;
  const y = st * 0.3;
  return new THREE.Vector3(x, y, z);
}

/**
 * Sub-mode: Stopping Time + Parity angle
 * Even nodes on the left semicircle (π to 2π), odd on the right (0 to π).
 * Within each semicircle, spread by golden angle.
 * Shows the even/odd split on every ring.
 */
function targetStoppingParity(node) {
  const st = node.stoppingTime;
  const ringRadius = st * 0.8 + 0.5;
  const even = node.value % 2 === 0;
  // Map into a semicircle: even = [π, 2π], odd = [0, π]
  const baseAngle = even ? Math.PI : 0;
  // Spread within the semicircle using golden angle, but constrained to π range
  const withinHalf = ((node.value * GOLDEN_ANGLE) % Math.PI + Math.PI) % Math.PI;
  const angle = baseAngle + withinHalf;
  const x = Math.cos(angle) * ringRadius;
  const z = Math.sin(angle) * ringRadius;
  const y = st * 0.3;
  return new THREE.Vector3(x, y, z);
}

/**
 * Sub-mode: Stopping Time + Tree Position angle
 * Angle is inherited from parent in the Collatz tree (sunburst layout).
 * Node 1 owns the full circle [0, 2π]. Each parent divides its arc
 * among its children. The result is a radial tree where connected
 * nodes always sit in the same angular wedge.
 */

// Pre-computed arc assignments: value → { arcStart, arcEnd }
const treeArcs = new Map();

function computeTreeArcs() {
  treeArcs.clear();
  treeArcs.set(1, { arcStart: 0, arcEnd: Math.PI * 2 });

  // Build reverse Collatz tree: for each node, find its children
  // (nodes whose Collatz successor is this node)
  const children = new Map(); // parent value → [child values]
  for (const node of nodes.values()) {
    if (node.value === 1) continue;
    // Parent in the tree = this node's Collatz successor (next step toward 1)
    const parent = findCollatzSuccessor(node.value);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node.value);
  }

  // BFS from node 1, assigning arcs
  const queue = [1];
  while (queue.length > 0) {
    const parentVal = queue.shift();
    const parentArc = treeArcs.get(parentVal);
    if (!parentArc) continue;

    const kids = children.get(parentVal);
    if (!kids || kids.length === 0) continue;

    // Sort children for deterministic layout (smaller values first)
    kids.sort((a, b) => a - b);

    // Divide the parent's arc among children
    const arcWidth = parentArc.arcEnd - parentArc.arcStart;
    const childArc = arcWidth / kids.length;

    for (let i = 0; i < kids.length; i++) {
      const start = parentArc.arcStart + i * childArc;
      treeArcs.set(kids[i], { arcStart: start, arcEnd: start + childArc });
      queue.push(kids[i]);
    }
  }
}

// Find the Collatz successor of a value (next step toward 1)
function findCollatzSuccessor(value) {
  if (value === 1) return 1;
  return value % 2 === 0 ? value / 2 : 3 * value + 1;
}

function targetStoppingTree(node) {
  const st = node.stoppingTime;
  const ringRadius = st * 0.8 + 0.5;
  const arc = treeArcs.get(node.value);
  // Place at the midpoint of the arc
  const angle = arc
    ? (arc.arcStart + arc.arcEnd) / 2
    : node.value * GOLDEN_ANGLE; // fallback
  const x = Math.cos(angle) * ringRadius;
  const z = Math.sin(angle) * ringRadius;
  const y = st * 0.3;
  return new THREE.Vector3(x, y, z);
}

// Helper: find max value among all nodes in graph.
// Compare via log2 to avoid Number/BigInt direct comparison issues.
function getMaxValueInGraph() {
  let max = 1;
  let maxLg = 0;
  for (const node of nodes.values()) {
    const lg = log2(node.value);
    if (lg > maxLg) { maxLg = lg; max = node.value; }
  }
  return max;
}

// ═══════════════════════════════════════════════════════════
// ── LAYOUT STEP (runs every frame) ───────────────────────
// ═══════════════════════════════════════════════════════════

export function layoutStep(dt) {
  if (nodes.size < 2) { settled = true; return; }

  if (currentMode === 'particles') {
    layoutStepForceDirected(dt);
  } else {
    layoutStepTargeted(dt);
  }

  // Always update edges after positions move
  for (const edge of edges.values()) {
    updateEdgePositions(edge);
  }
}

// ── Force-directed (particles mode) ──────────────────────
function layoutStepForceDirected(dt) {
  const nodeArr = Array.from(nodes.values());
  let maxVel = 0;

  for (const node of nodeArr) {
    if (node.pinned) continue;

    const force = new THREE.Vector3();
    const p = node.mesh.position;

    // Repulsion from nearby nodes. Spatial cutoff at 5× SPRING_LENGTH
    // turns O(N²) into O(N·k) where k = average nodes within the cutoff.
    const REPULSION_CUTOFF = SPRING_LENGTH * 5;
    const CUTOFF_SQ = REPULSION_CUTOFF * REPULSION_CUTOFF;
    for (const other of nodeArr) {
      if (other === node) continue;
      const dx = p.x - other.mesh.position.x;
      const dy = p.y - other.mesh.position.y;
      const dz = p.z - other.mesh.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > CUTOFF_SQ) continue;
      const dist = Math.sqrt(distSq) || 0.01;
      const strength = REPULSION_STRENGTH / (distSq || 0.01);
      force.addScaledVector(new THREE.Vector3(dx, dy, dz).normalize(), strength);
    }

    // Spring attraction to connected nodes
    for (const edge of edges.values()) {
      let other = null;
      if (edge.fromVal === node.value) other = nodes.get(edge.toVal);
      else if (edge.toVal === node.value) other = nodes.get(edge.fromVal);
      if (!other) continue;

      const diff = new THREE.Vector3().subVectors(other.mesh.position, p);
      const dist = diff.length() || 0.01;
      const displacement = dist - SPRING_LENGTH;
      force.add(diff.normalize().multiplyScalar(displacement * SPRING_STIFFNESS));
    }

    // Gravity toward origin
    force.add(p.clone().negate().multiplyScalar(GRAVITY_STRENGTH));

    node.vel.add(force.multiplyScalar(dt));
    node.vel.multiplyScalar(LAYOUT_DAMPING);
  }

  for (const node of nodeArr) {
    if (node.pinned) continue;
    node.mesh.position.add(node.vel.clone().multiplyScalar(dt * 60));
    const speed = node.vel.length();
    if (speed > maxVel) maxVel = speed;
  }

  settled = maxVel < LAYOUT_MIN_VELOCITY;
}

// ── Targeted lerp (value / parity / stopping modes) ──────
function layoutStepTargeted(dt) {
  let maxDist = 0;

  for (const node of nodes.values()) {
    if (!node.target) continue;
    const p = node.mesh.position;
    const dist = p.distanceTo(node.target);
    p.lerp(node.target, MODE_TRANSITION_SPEED);
    if (dist > maxDist) maxDist = dist;
  }

  settled = maxDist < 0.01;
}

// ── Recolor all nodes against current maxStoppingTime ────
export function recolorAll(progress = 1) {
  for (const node of nodes.values()) {
    if (node.value === 1) continue;

    const targetColor = colorForStoppingTime(node.stoppingTime);
    if (progress >= 1) {
      node.mesh.material.color.copy(targetColor);
      node.mesh.material.emissive.copy(targetColor);
    } else {
      node.mesh.material.color.lerp(targetColor, progress);
      node.mesh.material.emissive.lerp(targetColor, progress);
    }
  }
  for (const edge of edges.values()) {
    updateEdgeColors(edge);
  }
}

// ── Update just edge colors (used during animated rescale) ──
export function updateAllEdgeColors() {
  for (const edge of edges.values()) {
    updateEdgeColors(edge);
  }
}

// ── Update the anchor "1" pulse ──────────────────────────
export function updateAnchorPulse(time) {
  const anchor = nodes.get(1);
  if (!anchor) return;
  const t = (Math.sin(time * Math.PI * 2 / ANCHOR_PULSE_PERIOD) + 1) / 2;
  anchor.mesh.material.emissiveIntensity = ANCHOR_PULSE_MIN + (ANCHOR_PULSE_MAX - ANCHOR_PULSE_MIN) * t;
}

// ── Check if a value exists in the graph ─────────────────
export function hasNode(value) {
  return nodes.has(value);
}

// ── Get node position (for camera fly-to) ────────────────
export function getNodePosition(value) {
  const node = nodes.get(value);
  return node ? node.mesh.position.clone() : null;
}

// ── Get the bounding sphere of all nodes ─────────────────
export function getBounds() {
  if (nodes.size === 0) return { center: new THREE.Vector3(), radius: 5 };
  const box = new THREE.Box3();
  for (const node of nodes.values()) {
    box.expandByPoint(node.mesh.position);
  }
  const center = new THREE.Vector3();
  box.getCenter(center);
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 5);
  return { center, radius };
}
