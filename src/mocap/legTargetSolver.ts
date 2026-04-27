import * as THREE from 'three';
import type { Landmark3D } from './poseDetector';
import { mpDeltaToVrm } from './motionSpace';
interface LegLockState {
  locked: boolean;
  lockedPosition: THREE.Vector3;
  prevTarget: THREE.Vector3;
  smoothedPole: THREE.Vector3;
}

export interface LegTargetSolverInput {
  mirrorX: boolean;
  hip: Landmark3D;
  knee: Landmark3D;
  ankle: Landmark3D;
  hipWorld: THREE.Vector3;
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
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

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
    if (state.locked) {
      const shouldUnlock =
        velocity > footVelocityUnlockThreshold ||
        target.y > groundY + footLiftThreshold;
      if (!shouldUnlock) {
        target.copy(state.lockedPosition);
      } else {
        state.locked = false;
      }
    }
    if (!state.locked) {
      const nearGround = target.y <= groundY + footLiftThreshold * 0.4;
      if (velocity < footVelocityLockThreshold && nearGround) {
        state.locked = true;
        state.lockedPosition.copy(target);
      }
    }
  }

  mpDeltaToVrm(mirrorX, knee.x - hip.x, knee.y - hip.y, knee.z - hip.z, _v1);
  if (_v1.lengthSq() < 1e-6) _v1.set(0, -1, 0);
  if (state.smoothedPole.lengthSq() < 1e-6) state.smoothedPole.copy(_v1);
  else state.smoothedPole.lerp(_v1, poleAlpha);

  return {
    target: target.clone(),
    poleDirection: state.smoothedPole.clone(),
    locked: state.locked,
  };
}
