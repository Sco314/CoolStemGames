/**
 * Orb Run phase controller — single owner of hop phase logic.
 *
 * Architecture decision (Option B, see PR #40 / PR #41 thread):
 * Phase state lives HERE, not in numberline.js. numberline.js is a
 * renderer/adapter that queries orbRunController.update(dt) for the
 * current orb position and phase name, then renders accordingly.
 *
 * Do not reintroduce an inline phase machine in numberline.js. If a new
 * phase is needed (e.g. hop_settle split, terminal emphasis), add it to
 * the PHASE_* constants below and the state transition table in update().
 */

import * as THREE from 'three';

const PHASE_APPROACH = 'approach';
const PHASE_IMPACT = 'impact';
const PHASE_ORB_GROW = 'orbGrow';
const PHASE_LAUNCH = 'launch';
const PHASE_SETTLE = 'settle';

const LAUNCH_DURATION_RATIO = 0.35;
const SETTLE_DURATION_RATIO = 0.25;
const MIN_PHASE_DURATION = 0.05;

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export function createOrbRunController(config = {}) {
  const points = [];
  const weights = [];

  let hopIndex = 0;
  let phase = PHASE_APPROACH;
  let phaseElapsed = 0;
  let phaseDuration = MIN_PHASE_DURATION;
  let complete = true;

  const currentPos = new THREE.Vector3();
  const launchDir = new THREE.Vector3(1, 0, 0);

  function setHopContext() {
    if (hopIndex >= points.length - 1) {
      complete = true;
      return;
    }

    const start = points[hopIndex];
    const end = points[hopIndex + 1];
    const distance = start.distanceTo(end);
    const weight = weights[hopIndex] ?? 1;

    const base = config.travelDurationBase ?? 0.14;
    const perDistance = config.travelDurationPerDistance ?? 0.24;
    phaseDuration = Math.max(
      MIN_PHASE_DURATION,
      (base + perDistance * distance) * Math.max(0.25, weight),
    );

    if (hopIndex + 2 < points.length) {
      launchDir.copy(points[hopIndex + 2]).sub(end).normalize();
    } else {
      launchDir.copy(end).sub(start).normalize();
    }
    if (!Number.isFinite(launchDir.x)) launchDir.set(1, 0, 0);
  }

  function transitionTo(nextPhase) {
    phase = nextPhase;
    phaseElapsed = 0;

    if (phase === PHASE_IMPACT) {
      phaseDuration = Math.max(MIN_PHASE_DURATION, (config.impactPauseMs ?? 60) / 1000);
    } else if (phase === PHASE_ORB_GROW) {
      phaseDuration = Math.max(MIN_PHASE_DURATION, config.orbGrowthDuration ?? 0.12);
    } else if (phase === PHASE_LAUNCH) {
      phaseDuration = Math.max(MIN_PHASE_DURATION, (config.orbGrowthDuration ?? 0.12) * LAUNCH_DURATION_RATIO + 0.06);
    } else if (phase === PHASE_SETTLE) {
      phaseDuration = Math.max(MIN_PHASE_DURATION, (config.orbGrowthDuration ?? 0.12) * SETTLE_DURATION_RATIO + 0.04);
    } else if (phase === PHASE_APPROACH) {
      setHopContext();
    }
  }

  function setPositionForPhase() {
    if (points.length === 0) return;
    const start = points[Math.min(hopIndex, points.length - 1)];
    const end = points[Math.min(hopIndex + 1, points.length - 1)];

    const t = smoothstep(phaseElapsed / phaseDuration);

    if (phase === PHASE_APPROACH) {
      currentPos.lerpVectors(start, end, t);
      return;
    }

    currentPos.copy(end);
    if (phase === PHASE_LAUNCH || phase === PHASE_SETTLE) {
      const impulse = config.launchImpulseStrength ?? 0.14;
      const amp = phase === PHASE_LAUNCH ? t : (1 - t);
      currentPos.addScaledVector(launchDir, impulse * amp);
    }
  }

  return {
    setPath(pathPoints, pathWeights = []) {
      points.length = 0;
      weights.length = 0;
      for (const p of pathPoints) points.push(p.clone ? p.clone() : new THREE.Vector3(p.x, p.y, p.z));
      for (const w of pathWeights) weights.push(w);
      this.reset();
    },

    reset() {
      hopIndex = 0;
      phase = PHASE_APPROACH;
      phaseElapsed = 0;
      complete = points.length < 2;
      if (points[0]) currentPos.copy(points[0]);
      setHopContext();
    },

    update(dt) {
      const result = {
        position: currentPos,
        phase,
        hopIndex,
        arrivedStep: phase === PHASE_APPROACH ? hopIndex : hopIndex + 1,
        justImpactedStep: null,
        complete,
      };

      if (complete) {
        if (points.length > 0) currentPos.copy(points[points.length - 1]);
        result.position = currentPos;
        result.arrivedStep = Math.max(0, points.length - 1);
        return result;
      }

      phaseElapsed += dt;
      while (phaseElapsed >= phaseDuration && !complete) {
        phaseElapsed -= phaseDuration;

        if (phase === PHASE_APPROACH) {
          transitionTo(PHASE_IMPACT);
          result.justImpactedStep = hopIndex + 1;
          result.arrivedStep = hopIndex + 1;
        } else if (phase === PHASE_IMPACT) {
          transitionTo(PHASE_ORB_GROW);
        } else if (phase === PHASE_ORB_GROW) {
          transitionTo(PHASE_LAUNCH);
        } else if (phase === PHASE_LAUNCH) {
          transitionTo(PHASE_SETTLE);
        } else if (phase === PHASE_SETTLE) {
          hopIndex += 1;
          if (hopIndex >= points.length - 1) {
            complete = true;
            break;
          }
          transitionTo(PHASE_APPROACH);
        }
      }

      setPositionForPhase();
      result.position = currentPos;
      result.phase = phase;
      result.hopIndex = hopIndex;
      result.complete = complete;
      result.arrivedStep = complete ? points.length - 1 : (phase === PHASE_APPROACH ? hopIndex : hopIndex + 1);
      return result;
    },
  };
}

export const ORB_RUN_PHASES = {
  approach: PHASE_APPROACH,
  impact: PHASE_IMPACT,
  orbGrow: PHASE_ORB_GROW,
  launch: PHASE_LAUNCH,
  settle: PHASE_SETTLE,
};
