/**
 * 3D graph: node/edge management and force-directed layout.
 * Each Collatz value gets one shared node. Edges connect value → successor.
 */

import * as THREE from 'three';
import { isClimber } from './collatz.js';
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
const nodes = new Map();   // value → { mesh, labelSprite, vel, stoppingTime, value }
const edges = new Map();   // "from-to" → { line, fromVal, toVal }
let group = null;          // THREE.Group containing all graph objects
let maxStoppingTime = 0;
let settled = true;

export function getGroup() { return group; }
export function getNodes() { return nodes; }
export function getEdges() { return edges; }
export function getMaxStoppingTime() { return maxStoppingTime; }
export function isSettled() { return settled; }

// ── Init ─────────────────────────────────────────────────
export function initGraph(scene) {
  group = new THREE.Group();
  scene.add(group);

  // Create anchor node "1"
  addNode(1, 0, true);
}

// ── Color ramp ───────────────────────────────────────────
function sampleRamp(t) {
  // t in [0,1], interpolate through COLOR_RAMP
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
  const r = NODE_BASE_RADIUS * (1 + Math.log(value) / Math.log(NODE_SCALE_LOG_BASE) * 0.012);
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

  // Position: anchor at origin, others get a random offset near their successor
  if (isAnchor) {
    mesh.position.set(0, 0, 0);
  } else {
    // Will be repositioned by the caller near the successor
    const angle = Math.random() * Math.PI * 2;
    const dist = SPRING_LENGTH * 0.8;
    mesh.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, (Math.random() - 0.5) * 2);
  }

  // Start at scale 0 unless immediate
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
    pinned: isAnchor,
    targetScale: 1,
    currentScale: immediate ? 1 : 0.001,
    popStartTime: -1,
  };

  if (stoppingTime > maxStoppingTime) {
    maxStoppingTime = stoppingTime;
  }

  nodes.set(value, node);
  settled = false;
  return node;
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

// ── Force-directed layout step ───────────────────────────
export function layoutStep(dt) {
  if (nodes.size < 2) { settled = true; return; }

  const nodeArr = Array.from(nodes.values());
  let maxVel = 0;

  // Accumulate forces
  for (const node of nodeArr) {
    if (node.pinned) continue;

    const force = new THREE.Vector3();
    const p = node.mesh.position;

    // Repulsion from all other nodes
    for (const other of nodeArr) {
      if (other === node) continue;
      const diff = new THREE.Vector3().subVectors(p, other.mesh.position);
      const dist = diff.length() || 0.01;
      const minDist = node.radius + other.radius + 0.5;
      if (dist < minDist * 5) {
        const strength = REPULSION_STRENGTH / (dist * dist);
        force.add(diff.normalize().multiplyScalar(strength));
      }
    }

    // Spring attraction to connected nodes (edges)
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

    // Apply force to velocity
    node.vel.add(force.multiplyScalar(dt));
    node.vel.multiplyScalar(LAYOUT_DAMPING);
  }

  // Update positions
  for (const node of nodeArr) {
    if (node.pinned) continue;
    node.mesh.position.add(node.vel.clone().multiplyScalar(dt * 60));
    const speed = node.vel.length();
    if (speed > maxVel) maxVel = speed;
  }

  // Update all edges
  for (const edge of edges.values()) {
    updateEdgePositions(edge);
  }

  settled = maxVel < LAYOUT_MIN_VELOCITY;
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
  // Update edge colors too
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
