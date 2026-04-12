/**
 * Animation controller for sequence draw-in, merge flares,
 * color rescale transitions, and path pulses.
 */

import { collatzValues, stoppingTime } from './collatz.js';
import {
  addNode, addEdge, hasNode, getNodes, getMaxStoppingTime,
  recolorAll, colorForStoppingTime, getNodePosition, updateAllEdgeColors,
} from './graph.js';
import {
  NODE_POP_DURATION, MAX_SEQUENCE_DRAW_TIME,
  MERGE_FLARE_DURATION, COLOR_RESCALE_DURATION, PATH_PULSE_DURATION,
  CLIMBER_EMISSIVE, FALLER_EMISSIVE,
  SPRING_LENGTH,
} from './constants.js';
import { isClimber } from './collatz.js';

// ── Active animations ────────────────────────────────────
const activeAnims = [];     // Array of { update(now) → bool (true = done) }

/**
 * Add a number to the graph with animated draw-in.
 * Returns { isNew, mergeValue, newMaxDepth }
 */
export function addNumber(n) {
  const values = collatzValues(n);

  // Walk from 1 upward to find the merge point
  // values is [n, ..., 1], so reverse to go from 1 outward
  const reversed = [...values].reverse(); // [1, ..., n]

  let mergeIndex = -1; // index in reversed where we first hit an existing node
  let mergeValue = null;
  const newValues = [];

  for (let i = 0; i < reversed.length; i++) {
    if (hasNode(reversed[i])) {
      mergeIndex = i;
      mergeValue = reversed[i];
    } else {
      break;
    }
  }

  // If all nodes exist, it's a duplicate — do path pulse
  if (mergeIndex === reversed.length - 1) {
    animatePathPulse(values);
    return { isNew: false, mergeValue: null, newMaxDepth: false };
  }

  // Collect new values (from merge point outward toward n)
  for (let i = mergeIndex + 1; i < reversed.length; i++) {
    newValues.push(reversed[i]);
  }

  // Check if this raises max depth
  const oldMax = getMaxStoppingTime();
  let willRaiseMax = false;
  for (const v of newValues) {
    if (stoppingTime(v) > oldMax) {
      willRaiseMax = true;
      break;
    }
  }

  // Animate: draw in new nodes one by one from merge outward
  animateSequenceDrawIn(newValues, mergeValue, willRaiseMax);

  return {
    isNew: true,
    mergeValue: mergeValue !== null && mergeValue !== 1 ? mergeValue : null,
    newMaxDepth: willRaiseMax,
  };
}

// ── Sequence draw-in animation ───────────────────────────
function animateSequenceDrawIn(newValues, mergeValue, willRescale) {
  const popTime = Math.min(NODE_POP_DURATION, MAX_SEQUENCE_DRAW_TIME / Math.max(newValues.length, 1));
  const totalDuration = popTime * newValues.length;
  let startTime = -1;
  let nodesCreated = 0;

  const anim = {
    update(now) {
      if (startTime < 0) startTime = now;
      const elapsed = now - startTime;

      // Create nodes that should have appeared by now
      while (nodesCreated < newValues.length && elapsed >= nodesCreated * popTime) {
        const value = newValues[nodesCreated];
        const st = stoppingTime(value);

        // Determine position near the predecessor (previous in chain toward 1)
        const predecessorVal = nodesCreated === 0 ? mergeValue : newValues[nodesCreated - 1];
        const predecessorPos = getNodePosition(predecessorVal || 1);

        const node = addNode(value, st, false);
        node.popStartTime = now;

        // Position near predecessor
        if (predecessorPos) {
          const angle = Math.random() * Math.PI * 2;
          node.mesh.position.set(
            predecessorPos.x + Math.cos(angle) * SPRING_LENGTH * 0.6,
            predecessorPos.y + Math.sin(angle) * SPRING_LENGTH * 0.6,
            predecessorPos.z + (Math.random() - 0.5) * 1.5,
          );
        }

        // Add edge from this node to its Collatz successor
        const successorVal = value % 2 === 0 ? value / 2 : 3 * value + 1;
        // But in the chain, the successor is the previous value in reversed order
        const edgeTarget = nodesCreated === 0
          ? (mergeValue || 1)
          : newValues[nodesCreated - 1];
        addEdge(value, edgeTarget);

        nodesCreated++;
      }

      // Animate pop-in scale for each node
      for (let i = 0; i < nodesCreated; i++) {
        const node = getNodes().get(newValues[i]);
        if (!node || node.currentScale >= 1) continue;
        const nodeElapsed = now - node.popStartTime;
        const t = Math.min(1, nodeElapsed / NODE_POP_DURATION);
        // Ease-out bounce
        const eased = t < 0.7
          ? (t / 0.7) * (t / 0.7) * (3 - 2 * t / 0.7) * 1.15
          : 1 + (1 - t) / 0.3 * 0.15 * Math.sin((t - 0.7) * 10);
        const scale = Math.max(0.001, Math.min(1.15, eased));
        node.mesh.scale.setScalar(scale);
        node.currentScale = scale;
      }

      // When all nodes created and popped in, trigger merge flare and rescale
      if (nodesCreated >= newValues.length) {
        const allPopped = newValues.every(v => {
          const n = getNodes().get(v);
          return n && n.currentScale >= 0.99;
        });
        if (allPopped || elapsed > totalDuration + NODE_POP_DURATION * 2) {
          // Finalize scales
          for (const v of newValues) {
            const n = getNodes().get(v);
            if (n) { n.mesh.scale.setScalar(1); n.currentScale = 1; }
          }
          // Merge flare on the merge point
          if (mergeValue && mergeValue !== 1) {
            animateMergeFlare(mergeValue);
          }
          // Color rescale if max depth changed
          if (willRescale) {
            animateColorRescale();
          }
          return true; // done
        }
      }

      return false;
    }
  };

  activeAnims.push(anim);
}

// ── Merge flare animation ────────────────────────────────
function animateMergeFlare(value) {
  const node = getNodes().get(value);
  if (!node) return;

  let startTime = -1;
  const origEmissive = node.mesh.material.emissiveIntensity;
  const origScale = 1;

  activeAnims.push({
    update(now) {
      if (startTime < 0) startTime = now;
      const t = Math.min(1, (now - startTime) / MERGE_FLARE_DURATION);

      // Quick flash up then ease back down
      const flash = t < 0.3
        ? t / 0.3
        : 1 - (t - 0.3) / 0.7;
      node.mesh.material.emissiveIntensity = origEmissive + flash * 0.8;
      node.mesh.scale.setScalar(origScale + flash * 0.3);

      if (t >= 1) {
        node.mesh.material.emissiveIntensity = origEmissive;
        node.mesh.scale.setScalar(origScale);
        return true;
      }
      return false;
    }
  });
}

// ── Color rescale animation ──────────────────────────────
function animateColorRescale() {
  let startTime = -1;

  // Snapshot current colors
  const snapshots = new Map();
  for (const [val, node] of getNodes()) {
    if (val === 1) continue;
    snapshots.set(val, {
      color: node.mesh.material.color.clone(),
      emissive: node.mesh.material.emissive.clone(),
    });
  }

  activeAnims.push({
    update(now) {
      if (startTime < 0) startTime = now;
      const t = Math.min(1, (now - startTime) / COLOR_RESCALE_DURATION);

      // Smooth ease
      const eased = t * t * (3 - 2 * t);

      for (const [val, snap] of snapshots) {
        const node = getNodes().get(val);
        if (!node) continue;
        const target = colorForStoppingTime(node.stoppingTime);

        node.mesh.material.color.copy(snap.color).lerp(target, eased);
        node.mesh.material.emissive.copy(snap.emissive).lerp(target, eased);
      }
      updateAllEdgeColors();

      if (t >= 1) {
        recolorAll(1);
        return true;
      }
      return false;
    }
  });
}

// ── Path pulse ("already exists") ────────────────────────
function animatePathPulse(values) {
  // values is [n, ..., 1] — pulse travels from n down to 1
  let startTime = -1;
  const pulsePerNode = PATH_PULSE_DURATION / values.length;

  activeAnims.push({
    update(now) {
      if (startTime < 0) startTime = now;
      const elapsed = now - startTime;

      for (let i = 0; i < values.length; i++) {
        const node = getNodes().get(values[i]);
        if (!node) continue;

        const nodeStart = i * pulsePerNode;
        const nodeEnd = nodeStart + pulsePerNode;
        const origEmissive = values[i] === 1
          ? 0.3
          : (isClimber(values[i]) ? CLIMBER_EMISSIVE : FALLER_EMISSIVE);

        if (elapsed >= nodeStart && elapsed < nodeEnd) {
          const t = (elapsed - nodeStart) / pulsePerNode;
          const flash = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
          node.mesh.material.emissiveIntensity = origEmissive + flash * 0.6;
        } else if (elapsed >= nodeEnd) {
          node.mesh.material.emissiveIntensity = origEmissive;
        }
      }

      if (elapsed >= PATH_PULSE_DURATION + pulsePerNode) {
        // Reset all
        for (const v of values) {
          const node = getNodes().get(v);
          if (!node || v === 1) continue;
          node.mesh.material.emissiveIntensity =
            isClimber(v) ? CLIMBER_EMISSIVE : FALLER_EMISSIVE;
        }
        return true;
      }
      return false;
    }
  });
}

// ── Animate anchor pulse on input "1" ────────────────────
export function pulseAnchor() {
  const node = getNodes().get(1);
  if (!node) return;
  let startTime = -1;

  activeAnims.push({
    update(now) {
      if (startTime < 0) startTime = now;
      const t = Math.min(1, (now - startTime) / 600);
      const flash = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
      node.mesh.material.emissiveIntensity = 0.3 + flash * 0.5;
      node.mesh.scale.setScalar(1 + flash * 0.2);
      if (t >= 1) {
        node.mesh.scale.setScalar(1);
        return true;
      }
      return false;
    }
  });
}

// ── Tick all active animations ───────────────────────────
export function updateAnimations(now) {
  for (let i = activeAnims.length - 1; i >= 0; i--) {
    const done = activeAnims[i].update(now);
    if (done) activeAnims.splice(i, 1);
  }
}

export function hasActiveAnimations() {
  return activeAnims.length > 0;
}
