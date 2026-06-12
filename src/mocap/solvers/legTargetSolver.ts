import * as THREE from 'three';
import type { Landmark3D } from '../pipeline/poseDetector';
import { mpDeltaToVrm } from './motionSpace';
interface LegLockState {
  locked: boolean;
  lockedPosition: THREE.Vector3;
  prevTarget: THREE.Vector3;
  smoothedPole: THREE.Vector3;
  stableFrames?: number;
  airborneFrames?: number;
  /** 0..1 blend toward lockedPosition; ramps so lock/unlock never pops. */
  lockBlend?: number;
}

export interface LegTargetSolverInput {
  mirrorX: boolean;
  hip: Landmark3D;
  knee: Landmark3D;
  ankle: Landmark3D;
  hipWorld: THREE.Vector3;
  /**
   * Character's forward direction in world space (unit). When set, the knee
   * pole is clamped into the forward hemisphere — knees are hinges and can
   * only bend forward; a noisy knee-landmark depth must never flip the bend
   * direction backward.
   */
  characterForward?: THREE.Vector3;
  legScale: number;
  /** Multiplier on the X-component of the foot offset from hip. 1.0 = no
   *  change. >1 fans feet outward (compensates avatars whose rest hips are
   *  wider than the performer's projected hip width in MediaPipe metres). */
  legSpreadX: number;
  groundY: number;
  poleAlpha: number;
  footLockEnabled: boolean;
  footVelocityLockThreshold: number;
  footVelocityUnlockThreshold: number;
  footLiftThreshold: number;
  state: LegLockState;
}

export interface LegTargetSolverResult {
  target: THREE.Vector3;
  poleDirection: THREE.Vector3;
  locked: boolean;
  stableFrames: number;
  airborneFrames: number;
  lockBlend: number;
}

// Lock engages over ~3 frames and releases over ~2 (fast kicks shouldn't be
// held back). Replaces the previous instant snap, which recorded a visible
// pop into the BVH every time a foot locked or released.
const LOCK_BLEND_IN_RATE = 0.34;
const LOCK_BLEND_OUT_RATE = 0.5;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// Minimum forward component of the knee pole (unit-vector dot). 0.25 keeps a
// solid forward bias while letting the knee splay sideways naturally.
const KNEE_FORWARD_MIN = 0.25;

export function solveLegTarget(input: LegTargetSolverInput): LegTargetSolverResult {
  const {
    mirrorX,
    hip,
    knee,
    ankle,
    hipWorld,
    legScale,
    legSpreadX,
    groundY,
    poleAlpha,
    footLockEnabled,
    footVelocityLockThreshold,
    footVelocityUnlockThreshold,
    footLiftThreshold,
    state,
  } = input;

  mpDeltaToVrm(mirrorX, ankle.x - hip.x, ankle.y - hip.y, ankle.z - hip.z, _v1);
  _v1.multiplyScalar(legScale);
  // Avatar rest hips are typically wider than the performer's projected hip
  // width, so a length-only scale leaves the foot too close to the centerline.
  // legSpreadX fans the feet outward without changing the leg length.
  _v1.x *= legSpreadX;
  const target = _v2.copy(hipWorld).add(_v1);
  if (target.y < groundY) target.y = groundY;

  const velocity = state.prevTarget.distanceTo(target);
  state.prevTarget.copy(target);

  if (footLockEnabled) {
    const nearGround = target.y <= groundY + footLiftThreshold * 0.4;
    const lowVelocity = velocity < footVelocityLockThreshold;
    const highVelocity = velocity > footVelocityUnlockThreshold;
    if (nearGround && lowVelocity) state.stableFrames = (state.stableFrames ?? 0) + 1;
    else state.stableFrames = 0;
    if (target.y > groundY + footLiftThreshold) state.airborneFrames = (state.airborneFrames ?? 0) + 1;
    else state.airborneFrames = 0;

    if (state.locked) {
      const shouldUnlock =
        highVelocity ||
        (state.airborneFrames ?? 0) >= 2;
      if (shouldUnlock) {
        state.locked = false;
        state.stableFrames = 0;
      }
    }
    if (!state.locked) {
      if ((state.stableFrames ?? 0) >= 3) {
        state.locked = true;
        state.lockedPosition.copy(target);
      }
    }

    // Ramp the blend toward the lock state and apply it; full lock still pins
    // the target exactly, but transitions take a few frames instead of one.
    const goal = state.locked ? 1 : 0;
    const blend = state.lockBlend ?? 0;
    const rate = goal > blend ? LOCK_BLEND_IN_RATE : LOCK_BLEND_OUT_RATE;
    state.lockBlend = blend + Math.sign(goal - blend) * Math.min(rate, Math.abs(goal - blend));
    if (state.lockBlend > 0) target.lerp(state.lockedPosition, state.lockBlend);
  } else {
    state.lockBlend = 0;
  }

  mpDeltaToVrm(mirrorX, knee.x - hip.x, knee.y - hip.y, knee.z - hip.z, _v1);
  if (_v1.lengthSq() < 1e-6) _v1.set(0, -1, 0);
  if (state.smoothedPole.lengthSq() < 1e-6) state.smoothedPole.copy(_v1);
  else state.smoothedPole.lerp(_v1, poleAlpha);

  // Anatomical hinge guard: keep the pole's forward component above a floor
  // so the knee can never be told to bend backward by depth noise.
  if (input.characterForward) {
    const fwd = input.characterForward;
    const fwdComp = state.smoothedPole.dot(fwd);
    if (fwdComp < KNEE_FORWARD_MIN) {
      state.smoothedPole.addScaledVector(fwd, KNEE_FORWARD_MIN - fwdComp);
      if (state.smoothedPole.lengthSq() < 1e-6) state.smoothedPole.copy(fwd);
      state.smoothedPole.normalize();
    }
  }

  return {
    target: target.clone(),
    poleDirection: state.smoothedPole.clone(),
    locked: state.locked,
    stableFrames: state.stableFrames ?? 0,
    airborneFrames: state.airborneFrames ?? 0,
    lockBlend: state.lockBlend ?? 0,
  };
}
