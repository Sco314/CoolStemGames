import * as THREE from 'three';

const INTRO_OFFSET = new THREE.Vector3(-1.4, 2.4, 5.2);
const FOLLOW_HEIGHT = 1.35;
const FOLLOW_BACK = 2.6;
const FOLLOW_SIDE = 0.55;
const TERMINAL_OFFSET = new THREE.Vector3(-0.9, 2.1, 5.6);

const FOLLOW_POS_STIFFNESS = 7.5;
const LOOK_STIFFNESS = 6.5;

const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempC = new THREE.Vector3();

function dampFactor(stiffness, dt) {
  return 1 - Math.exp(-Math.max(0, stiffness) * Math.max(0, dt));
}

export function createOrbRunCameraRig() {
  const state = {
    shooterPos: new THREE.Vector3(),
    introFocus: new THREE.Vector3(),
    funnelCenter: new THREE.Vector3(),
    terminalCenter: new THREE.Vector3(),
    terminalStartStep: Infinity,
    terminalHold: false,
    followAnchor: new THREE.Vector3(),
    followLook: new THREE.Vector3(),
    initialized: false,
  };

  function reset({ pathPositions, sequence, shooterPos }) {
    state.shooterPos.copy(shooterPos);

    const p0 = pathPositions?.[0] || tempA.set(0, 0, 0);
    const p3 = pathPositions?.[Math.min(3, Math.max(0, (pathPositions?.length || 1) - 1))] || p0;
    state.introFocus.copy(p0).lerp(p3, 0.65);

    state.funnelCenter.copy(computeFunnelCenter(pathPositions));

    const terminal = findTerminalSignature(sequence);
    if (terminal && pathPositions && pathPositions.length >= 3) {
      const a = pathPositions[Math.min(pathPositions.length - 1, terminal.startStep)] || p0;
      const b = pathPositions[Math.min(pathPositions.length - 1, terminal.startStep + 1)] || a;
      const c = pathPositions[Math.min(pathPositions.length - 1, terminal.startStep + 2)] || b;
      state.terminalCenter.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      state.terminalStartStep = terminal.startStep;
    } else {
      state.terminalCenter.copy(state.funnelCenter);
      state.terminalStartStep = Infinity;
    }

    state.terminalHold = false;
    state.followAnchor.copy(p0);
    state.followLook.copy(p0);
    state.initialized = true;
  }

  function getTarget({ dt, ballPos, currentStepFloat, totalSteps, pathSpline, playState, tacticalWeight = 0 }) {
    if (!state.initialized) {
      return { position: ballPos.clone().add(INTRO_OFFSET), lookAt: ballPos.clone() };
    }

    const inIntro = currentStepFloat < 0;
    const terminalBlend = getTerminalBlend(currentStepFloat, state.terminalStartStep, totalSteps, playState);

    if (inIntro) {
      const launchBias = Math.max(0, Math.min(1, currentStepFloat + 1));
      const introPos = state.shooterPos.clone().add(INTRO_OFFSET);
      const introLook = state.introFocus.clone().lerp(state.funnelCenter, 0.25);
      return {
        position: introPos,
        lookAt: introLook.lerp(ballPos, launchBias * 0.2),
      };
    }

    const tangent = sampleTangent(pathSpline, currentStepFloat, totalSteps);
    const side = tempB.set(0, 1, 0).cross(tangent).normalize();
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1);

    const desiredFollow = tempA.copy(ballPos)
      .addScaledVector(tangent, -FOLLOW_BACK)
      .addScaledVector(side, FOLLOW_SIDE);
    desiredFollow.y += FOLLOW_HEIGHT;

    const followAlpha = dampFactor(FOLLOW_POS_STIFFNESS, dt);
    state.followAnchor.lerp(desiredFollow, followAlpha);

    const lookAhead = sampleLookAhead(pathSpline, currentStepFloat, totalSteps);
    const compositionWeight = Math.max(0, 0.28 - terminalBlend * 0.18);
    const desiredLook = lookAhead.lerp(state.funnelCenter, compositionWeight);
    const lookAlpha = dampFactor(LOOK_STIFFNESS, dt);
    state.followLook.lerp(desiredLook, lookAlpha);

    const tacticalPos = ballPos.clone().add(new THREE.Vector3(0, 2.5, 4.0));
    const tacticalLook = ballPos.clone();

    const pos = state.followAnchor.clone().lerp(tacticalPos, tacticalWeight * (1 - terminalBlend));
    const lookAt = state.followLook.clone().lerp(tacticalLook, tacticalWeight * 0.6 * (1 - terminalBlend));

    if (terminalBlend > 0) {
      const terminalPos = state.terminalCenter.clone().add(TERMINAL_OFFSET);
      pos.lerp(terminalPos, terminalBlend);
      lookAt.lerp(state.terminalCenter, terminalBlend);
      if (playState === 'complete') state.terminalHold = true;
    }

    if (state.terminalHold) {
      return {
        position: state.terminalCenter.clone().add(TERMINAL_OFFSET),
        lookAt: state.terminalCenter.clone(),
      };
    }

    return { position: pos, lookAt };
  }

  return { reset, getTarget };
}

function sampleTangent(pathSpline, currentStepFloat, totalSteps) {
  if (!pathSpline || totalSteps <= 1) return tempC.set(1, 0, 0);
  const t = Math.min(1, Math.max(0, currentStepFloat / (totalSteps - 1)));
  const eps = 1 / Math.max(24, totalSteps * 2);
  const t0 = Math.max(0, t - eps);
  const t1 = Math.min(1, t + eps);
  const a = pathSpline.getPoint(t0);
  const b = pathSpline.getPoint(t1);
  const tangent = tempC.copy(b).sub(a).normalize();
  if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
  return tangent;
}

function sampleLookAhead(pathSpline, currentStepFloat, totalSteps) {
  if (!pathSpline || totalSteps <= 1) return tempA.set(0, 0, 0);
  const lookT = Math.min(1, Math.max(0, (currentStepFloat + 4) / (totalSteps - 1)));
  return tempA.copy(pathSpline.getPoint(lookT));
}

function computeFunnelCenter(pathPositions = []) {
  if (!pathPositions.length) return new THREE.Vector3();
  const start = Math.max(0, pathPositions.length - 16);
  const center = new THREE.Vector3();
  let count = 0;
  for (let i = start; i < pathPositions.length; i++) {
    center.add(pathPositions[i]);
    count++;
  }
  return count ? center.multiplyScalar(1 / count) : center;
}

function findTerminalSignature(sequence = []) {
  for (let i = sequence.length - 3; i >= 0; i--) {
    if (asNum(sequence[i]) === 4 && asNum(sequence[i + 1]) === 2 && asNum(sequence[i + 2]) === 1) {
      return { startStep: i };
    }
  }
  return null;
}

function getTerminalBlend(currentStepFloat, terminalStartStep, totalSteps, playState) {
  if (!Number.isFinite(terminalStartStep) || totalSteps <= 0) {
    return playState === 'complete' ? 1 : 0;
  }
  const blendStart = Math.max(0, terminalStartStep - 2);
  const t = (currentStepFloat - blendStart) / 3;
  const ramp = Math.max(0, Math.min(1, t));
  if (playState === 'complete') return 1;
  return ramp * ramp * (3 - 2 * ramp);
}

function asNum(v) {
  return typeof v === 'bigint' ? Number(v) : v;
}
