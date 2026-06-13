import * as THREE from 'three';
import type { Landmark3D } from '../pipeline/poseDetector';
import {
  createTorsoSolverDiagnostics,
  type TorsoSolverDiagnostics,
} from '../diagnostics/mocapDiagnostics';
import { mpDeltaToVrm, mpDirToVrm, mpDirToVrmTorso } from './motionSpace';
import {
  computeAppliedLateralLean,
  computeTorsoLean,
  stabilizeTorsoCrossAxis,
} from './torsoMath';

export interface HipsOrientationTargetInput {
  mirrorX: boolean;
  leftHip: Landmark3D;
  rightHip: Landmark3D;
  leftShoulder: Landmark3D;
  rightShoulder: Landmark3D;
  hipsBaseWorld: THREE.Quaternion;
  hipsParentWorldQuaternion: THREE.Quaternion;
  torsoAxisMaxDivergenceDeg: number;
  /** Z damping of torso directions. 1 = honest depth (trusted/lifted input),
   *  3 = legacy live-webcam damping. */
  torsoDepthDamping?: number;
}

export interface HipPositionTargetInput {
  mirrorX: boolean;
  depthScale: number;
  perfCenterX: number;
  perfCenterY: number;
  perfCenterZ: number;
  perfBaseline: THREE.Vector3;
  avatarBaselineWorld: THREE.Vector3;
  hipsParentWorldPosition: THREE.Vector3;
  hipsParentWorldQuaternion: THREE.Quaternion;
  scale: number;
  /**
   * When set, the WORLD Y of the target is replaced by this absolute height
   * (already in avatar metres). The image-based Y delta tracks lateral motion
   * well but underestimates vertical amplitude (crouches barely lower the
   * pelvis); the caller supplies a metric height — the avatar's own straight-leg
   * height when standing, or performer hip-above-ankle scaled to avatar metres
   * when crouching.
   */
  absoluteHeight?: {
    /** Absolute world Y to pin the hips to (avatar metres). */
    worldY: number;
  };
}

export interface SpineTargetSolverInput {
  mirrorX: boolean;
  leftShoulder: Landmark3D;
  rightShoulder: Landmark3D;
  leftHip: Landmark3D | null;
  rightHip: Landmark3D | null;
  hipsWorldQuaternion: THREE.Quaternion;
  avatarShoulderRestLocal: THREE.Vector3;
  torsoAxisMaxDivergenceDeg: number;
  torsoForwardBaseline: number | null;
  forwardBendScale: number;
  lateralBendScale: number;
  lateralBendScaleMax: number;
  spineNodeCount: number;
  /** Z damping of torso directions (see HipsOrientationTargetInput). */
  torsoDepthDamping?: number;
  /** Hard cap on the absolute torso yaw, degrees. */
  torsoTwistMaxDeg: number;
  /** Max per-frame change of the torso yaw, degrees (rate limit). */
  torsoTwistMaxStepDeg: number;
  /** Soft-deadband half-width on the torso yaw, degrees. Suppresses near-frontal
   *  depth-noise jitter; 0 disables. */
  torsoTwistDeadbandDeg: number;
  /** Previous frame's applied torso yaw (radians), or null on first frame. */
  prevTwistYaw: number | null;
}

export interface SpineTargetSolverResult {
  halfTwist: THREE.Quaternion;
  nextForwardBaseline: number | null;
  /** This frame's applied torso yaw (radians) — feed back as prevTwistYaw. */
  nextTwistYaw: number;
  diagnostics: TorsoSolverDiagnostics;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _e1 = new THREE.Euler(0, 0, 0, 'YXZ');

export function solveHipsOrientationTarget(
  input: HipsOrientationTargetInput,
): THREE.Quaternion | null {
  const {
    mirrorX,
    leftHip,
    rightHip,
    leftShoulder,
    rightShoulder,
    hipsBaseWorld,
    hipsParentWorldQuaternion,
    torsoAxisMaxDivergenceDeg,
  } = input;

  const damping = input.torsoDepthDamping ?? 3;
  const spineDir = _v1;
  mpDirToVrmTorso(
    mirrorX,
    (leftShoulder.x + rightShoulder.x) * 0.5 - (leftHip.x + rightHip.x) * 0.5,
    (leftShoulder.y + rightShoulder.y) * 0.5 - (leftHip.y + rightHip.y) * 0.5,
    (leftShoulder.z + rightShoulder.z) * 0.5 - (leftHip.z + rightHip.z) * 0.5,
    spineDir,
    damping,
  );
  if (spineDir.lengthSq() < 1e-6) return null;
  spineDir.normalize();

  const shoulderAxis = _v2;
  mpDirToVrmTorso(
    mirrorX,
    rightShoulder.x - leftShoulder.x,
    rightShoulder.y - leftShoulder.y,
    rightShoulder.z - leftShoulder.z,
    shoulderAxis,
    damping,
  );
  if (shoulderAxis.lengthSq() < 1e-6) return null;
  shoulderAxis.normalize();

  const hipAxis = _v3;
  mpDirToVrmTorso(
    mirrorX,
    rightHip.x - leftHip.x,
    rightHip.y - leftHip.y,
    rightHip.z - leftHip.z,
    hipAxis,
    damping,
  );
  if (hipAxis.lengthSq() < 1e-6) return null;
  hipAxis.normalize();
  stabilizeTorsoCrossAxis(hipAxis, shoulderAxis, torsoAxisMaxDivergenceDeg, hipAxis);

  const zAxis = _v4.crossVectors(hipAxis, spineDir);
  if (zAxis.lengthSq() < 1e-6) return null;
  zAxis.normalize();
  const xAxis = _v2.crossVectors(spineDir, zAxis).normalize();

  _m1.makeBasis(xAxis, spineDir, zAxis);
  _q1.setFromRotationMatrix(_m1);
  _q1.premultiply(hipsBaseWorld);

  _q2.copy(hipsParentWorldQuaternion).invert();
  _q1.premultiply(_q2);

  _e1.setFromQuaternion(_q1, 'YXZ');
  _e1.z = 0;
  _q1.setFromEuler(_e1);
  return _q1.clone();
}

export function solveHipPositionTarget(
  input: HipPositionTargetInput,
): THREE.Vector3 {
  const {
    mirrorX,
    depthScale,
    perfCenterX,
    perfCenterY,
    perfCenterZ,
    perfBaseline,
    avatarBaselineWorld,
    hipsParentWorldPosition,
    hipsParentWorldQuaternion,
    scale,
  } = input;

  mpDeltaToVrm(
    mirrorX,
    perfCenterX - perfBaseline.x,
    perfCenterY - perfBaseline.y,
    perfCenterZ - perfBaseline.z,
    _v1,
    depthScale,
  );
  _v1.multiplyScalar(scale);

  _v2.copy(avatarBaselineWorld).add(_v1);
  if (input.absoluteHeight) {
    _v2.y = input.absoluteHeight.worldY;
  }
  _q1.copy(hipsParentWorldQuaternion).invert();
  _v3.subVectors(_v2, hipsParentWorldPosition).applyQuaternion(_q1);
  return _v3.clone();
}

export function solveSpineTarget(
  input: SpineTargetSolverInput,
): SpineTargetSolverResult | null {
  const {
    mirrorX,
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    hipsWorldQuaternion,
    avatarShoulderRestLocal,
    torsoAxisMaxDivergenceDeg,
    torsoForwardBaseline,
    forwardBendScale,
    lateralBendScale,
    lateralBendScaleMax,
    spineNodeCount,
    torsoTwistMaxDeg,
    torsoTwistMaxStepDeg,
    torsoTwistDeadbandDeg,
    prevTwistYaw,
  } = input;

  const diagnostics = createTorsoSolverDiagnostics();
  const hipsVisible = !!leftHip && !!rightHip;

  const damping = input.torsoDepthDamping ?? 3;
  const shoulderAxis = _v1;
  mpDirToVrmTorso(
    mirrorX,
    rightShoulder.x - leftShoulder.x,
    rightShoulder.y - leftShoulder.y,
    rightShoulder.z - leftShoulder.z,
    shoulderAxis,
    damping,
  );
  if (shoulderAxis.lengthSq() < 1e-6) return null;

  const hipAxis = _v2;
  if (hipsVisible) {
    mpDirToVrmTorso(
      mirrorX,
      rightHip!.x - leftHip!.x,
      rightHip!.y - leftHip!.y,
      rightHip!.z - leftHip!.z,
      hipAxis,
      damping,
    );
    if (hipAxis.lengthSq() < 1e-6) return null;
    stabilizeTorsoCrossAxis(hipAxis, shoulderAxis, torsoAxisMaxDivergenceDeg, hipAxis);
  }

  _q2.copy(hipsWorldQuaternion).invert();
  shoulderAxis.applyQuaternion(_q2);
  shoulderAxis.y = 0;
  if (shoulderAxis.lengthSq() < 1e-6) return null;
  shoulderAxis.normalize();

  if (hipsVisible) {
    hipAxis.applyQuaternion(_q2);
    hipAxis.y = 0;
    if (hipAxis.lengthSq() < 1e-6) return null;
    hipAxis.normalize();
  } else {
    hipAxis.copy(avatarShoulderRestLocal);
  }

  // Both axes lie in the hips-local XZ plane (y was zeroed), so the twist that
  // takes hipAxis → shoulderAxis is a pure yaw about +Y. Compute it as a signed
  // scalar via atan2 instead of setFromUnitVectors: this is well-defined even
  // when the axes are anti-parallel (P3 — setFromUnitVectors would pick an
  // arbitrary perpendicular rotation axis there, tipping the torso), and gives
  // a scalar we can hard-cap and rate-limit (P1 — bounds depth-noise spikes).
  const crossY = hipAxis.z * shoulderAxis.x - hipAxis.x * shoulderAxis.z;
  const dotXZ = hipAxis.x * shoulderAxis.x + hipAxis.z * shoulderAxis.z;
  let twistYaw = Math.atan2(crossY, dotXZ);
  const maxYaw = THREE.MathUtils.degToRad(torsoTwistMaxDeg);
  twistYaw = THREE.MathUtils.clamp(twistYaw, -maxYaw, maxYaw);
  // P5 — frontal soft-deadband. Facing the camera, the projected shoulder/hip
  // axes are near-parallel and the yaw degenerates to (ε_hip − ε_shoulder), the
  // difference of two depth-noise terms — a few degrees of pure jitter the rate
  // limiter can't catch. smoothstep scales the yaw 0→1 across [dead, 2·dead]:
  // sub-deadband jitter is killed, real twists past 2·dead keep full amplitude,
  // and the ramp avoids a visible snap at the threshold.
  if (torsoTwistDeadbandDeg > 1e-4) {
    const dead = THREE.MathUtils.degToRad(torsoTwistDeadbandDeg);
    twistYaw *= THREE.MathUtils.smoothstep(Math.abs(twistYaw), dead, dead * 2);
  }
  if (prevTwistYaw != null) {
    const maxStep = THREE.MathUtils.degToRad(torsoTwistMaxStepDeg);
    const step = THREE.MathUtils.clamp(twistYaw - prevTwistYaw, -maxStep, maxStep);
    twistYaw = prevTwistYaw + step;
  }
  const fullTwist = _q1.setFromAxisAngle(_v3.set(0, 1, 0), twistYaw);

  let forwardLeanRaw = 0;
  let forwardLean = 0;
  let lateralLean = 0;
  let nextForwardBaseline = torsoForwardBaseline;

  if (hipsVisible) {
    mpDirToVrm(
      mirrorX,
      (rightShoulder.x + leftShoulder.x) * 0.5 - (rightHip!.x + leftHip!.x) * 0.5,
      (rightShoulder.y + leftShoulder.y) * 0.5 - (rightHip!.y + leftHip!.y) * 0.5,
      (rightShoulder.z + leftShoulder.z) * 0.5 - (rightHip!.z + leftHip!.z) * 0.5,
      _v3,
    );
    if (_v3.lengthSq() > 1e-6) {
      _v3.applyQuaternion(_q2);
      const lean = computeTorsoLean(_v3, torsoForwardBaseline);
      nextForwardBaseline = lean.nextForwardBaseline;
      forwardLeanRaw = lean.forwardLeanRaw;
      forwardLean = lean.forwardLean;
      lateralLean = lean.lateralLean;
    }
  }

  diagnostics.forwardLeanRaw = forwardLeanRaw;
  diagnostics.forwardLeanApplied = forwardLean;
  diagnostics.lateralLeanRaw = lateralLean;

  if (Math.abs(forwardLean) > 1e-4 && forwardBendScale > 1e-4) {
    _q3.setFromAxisAngle(
      _v3.set(1, 0, 0),
      THREE.MathUtils.clamp(
        forwardLean * forwardBendScale,
        THREE.MathUtils.degToRad(-35),
        THREE.MathUtils.degToRad(35),
      ),
    );
    fullTwist.multiply(_q3);
  }

  if (Math.abs(lateralLean) > 1e-4 && lateralBendScale > 1e-4) {
    const lateralResult = computeAppliedLateralLean(
      lateralLean,
      lateralBendScale,
      lateralBendScaleMax,
    );
    diagnostics.lateralLeanGain = lateralResult.gain;
    diagnostics.lateralLeanApplied = lateralResult.applied;
    _q3.setFromAxisAngle(_v3.set(0, 0, 1), lateralResult.applied);
    fullTwist.multiply(_q3);
  }

  const halfTwist = _q2.identity().slerp(fullTwist, 1 / spineNodeCount);

  return {
    halfTwist: halfTwist.clone(),
    nextForwardBaseline,
    nextTwistYaw: twistYaw,
    diagnostics,
  };
}
