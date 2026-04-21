import * as THREE from 'three';

// Baseline intro/follow/terminal offsets. For the 3D anomalous-cone
// layout these get scaled up at reset() time based on the scene's
// bounding sphere so the camera actually frames the whole cone.
// _UNIT vectors are normalized — direction only, multiplied by a
// scene-radius-based distance.
const INTRO_OFFSET_UNIT = new THREE.Vector3(-0.2, 0.5, 1.0).normalize();
const FOLLOW_DIST = 4.0;
const FOLLOW_HEIGHT = 2.0;
const TERMINAL_OFFSET_UNIT = new THREE.Vector3(-0.15, 0.4, 1.0).normalize();

const FOLLOW_POS_STIFFNESS = 5.0;
const LOOK_STIFFNESS = 4.5;

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
    sceneCenter: new THREE.Vector3(),
    sceneRadius: 1,           // bounding-sphere radius of the full cone
    introPos: new THREE.Vector3(),
    introLookAt: new THREE.Vector3(),
    followScale: 1,
    terminalPos: new THREE.Vector3(),
    initialized: false,
  };

  function reset({ pathPositions, sequence, shooterPos }) {
    state.shooterPos.copy(shooterPos);

    const p0 = pathPositions?.[0] || tempA.set(0, 0, 0);
    const p3 = pathPositions?.[Math.min(3, Math.max(0, (pathPositions?.length || 1) - 1))] || p0;
    state.introFocus.copy(p0).lerp(p3, 0.65);

    state.funnelCenter.copy(computeFunnelCenter(pathPositions));

    // Compute bounding sphere of the full cone so all three camera modes
    // (intro, follow, terminal) scale with scene size. Otherwise small
    // runs look from across the map and big ones (like 27) clip off-screen.
    const bounds = computeBoundingSphere(pathPositions);
    state.sceneCenter.copy(bounds.center);
    state.sceneRadius = Math.max(1, bounds.radius);

    // Intro camera: wide shot of the full cone, framed from above-and-behind.
    const introDist = state.sceneRadius * 1.6 + 2.0;
    state.introPos.copy(state.sceneCenter).addScaledVector(INTRO_OFFSET_UNIT, introDist);
    state.introLookAt.copy(state.sceneCenter);

    // Follow: scale the chase distance with the local cone size so the ball
    // stays at a readable apparent size on long runs.
    state.followScale = Math.max(1, Math.log2(state.sceneRadius + 1) * 0.8);

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

    // Terminal camera holds tight on the 4/2/1 cluster; distance is a small
    // fraction of scene size so the three orbs fill the frame.
    const terminalDist = Math.max(3, state.sceneRadius * 0.35);
    state.terminalPos.copy(state.terminalCenter).addScaledVector(TERMINAL_OFFSET_UNIT, terminalDist);

    state.terminalHold = false;
    state.followAnchor.copy(p0);
    state.followLook.copy(p0);
    state.initialized = true;
  }

  function getTarget({ dt, ballPos, currentStepFloat, totalSteps, pathSpline, pathPositions, playState, tacticalWeight = 0 }) {
    if (!state.initialized) {
      return { position: ballPos.clone().addScaledVector(INTRO_OFFSET_UNIT, 4), lookAt: ballPos.clone() };
    }

    const inIntro = currentStepFloat < 0;
    const terminalBlend = getTerminalBlend(currentStepFloat, state.terminalStartStep, totalSteps, playState);

    if (inIntro) {
      const launchBias = Math.max(0, Math.min(1, currentStepFloat + 1));
      const introLook = state.introLookAt.clone().lerp(ballPos, launchBias * 0.25);
      return {
        position: state.introPos.clone(),
        lookAt: introLook,
      };
    }

    // Use the ball's actual hop direction (current→next orb) instead of
    // the spline tangent. The spline through scattered 3D cone positions
    // creates wild curves; the hop vector is what the player sees.
    const curStep = Math.max(0, Math.floor(currentStepFloat));
    const nextStep = Math.min((pathPositions?.length || 1) - 1, curStep + 1);
    const hopDir = tempC.set(0, 0, -1);
    if (pathPositions && pathPositions[curStep] && pathPositions[nextStep]) {
      hopDir.copy(pathPositions[nextStep]).sub(pathPositions[curStep]);
      if (hopDir.lengthSq() > 1e-6) hopDir.normalize();
      else hopDir.set(0, 0, -1);
    }

    // Camera sits behind + above the ball relative to its travel direction.
    const desiredFollow = tempA.copy(ballPos)
      .addScaledVector(hopDir, -FOLLOW_DIST);
    desiredFollow.y += FOLLOW_HEIGHT;

    const followAlpha = dampFactor(FOLLOW_POS_STIFFNESS, dt);
    state.followAnchor.lerp(desiredFollow, followAlpha);

    // Look slightly ahead of the ball along its hop direction
    const desiredLook = tempB.copy(ballPos).addScaledVector(hopDir, 1.5);
    const lookAlpha = dampFactor(LOOK_STIFFNESS, dt);
    state.followLook.lerp(desiredLook, lookAlpha);

    const pos = state.followAnchor.clone();
    const lookAt = state.followLook.clone();

    if (terminalBlend > 0) {
      pos.lerp(state.terminalPos, terminalBlend);
      lookAt.lerp(state.terminalCenter, terminalBlend);
      if (playState === 'complete') state.terminalHold = true;
    }

    if (state.terminalHold) {
      return {
        position: state.terminalPos.clone(),
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

// Rough bounding sphere — good enough for camera framing. Uses the mean
// point as the center and the max distance from that center as radius.
function computeBoundingSphere(pathPositions = []) {
  const center = new THREE.Vector3();
  if (!pathPositions.length) return { center, radius: 1 };
  for (const p of pathPositions) center.add(p);
  center.multiplyScalar(1 / pathPositions.length);
  let r2 = 0;
  for (const p of pathPositions) {
    const dx = p.x - center.x, dy = p.y - center.y, dz = p.z - center.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) r2 = d2;
  }
  return { center, radius: Math.sqrt(r2) };
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
