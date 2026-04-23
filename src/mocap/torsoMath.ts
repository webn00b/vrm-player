import * as THREE from 'three';
import { computeAdaptiveLateralGain } from './solverHeuristics';

const _shoulderAligned = new THREE.Vector3();

export function stabilizeTorsoCrossAxis(
  hipAxis: THREE.Vector3,
  shoulderAxis: THREE.Vector3,
  maxDivergenceDeg: number,
  out: THREE.Vector3,
): void {
  out.copy(hipAxis);
  if (out.lengthSq() < 1e-6 || shoulderAxis.lengthSq() < 1e-6) return;

  _shoulderAligned.copy(shoulderAxis);
  if (out.dot(_shoulderAligned) < 0) _shoulderAligned.multiplyScalar(-1);

  const angle = out.angleTo(_shoulderAligned);
  const maxAngle = THREE.MathUtils.degToRad(maxDivergenceDeg);
  if (angle <= maxAngle) return;

  const blend = THREE.MathUtils.clamp(
    (angle - maxAngle) / THREE.MathUtils.degToRad(25),
    0,
    1,
  );
  out.lerp(_shoulderAligned, blend).normalize();
}

export interface TorsoLeanResult {
  forwardLeanRaw: number;
  forwardLean: number;
  lateralLean: number;
  nextForwardBaseline: number | null;
}

export function computeTorsoLean(
  torsoMidpointInHipsLocal: THREE.Vector3,
  forwardBaseline: number | null,
): TorsoLeanResult {
  if (torsoMidpointInHipsLocal.lengthSq() <= 1e-6) {
    return {
      forwardLeanRaw: 0,
      forwardLean: 0,
      lateralLean: 0,
      nextForwardBaseline: forwardBaseline,
    };
  }

  const forwardLeanRaw = Math.atan2(
    torsoMidpointInHipsLocal.z,
    Math.max(1e-6, torsoMidpointInHipsLocal.y),
  );
  const nextForwardBaseline = forwardBaseline ?? forwardLeanRaw;
  let forwardLean = forwardLeanRaw - nextForwardBaseline;

  // Keep a small absolute forward component so clips that are globally
  // shot with the performer already leaning slightly forward do not get
  // completely flattened by the session baseline.
  if (forwardLeanRaw > 0) forwardLean += forwardLeanRaw * 0.25;

  return {
    forwardLeanRaw,
    forwardLean,
    lateralLean: Math.atan2(
      torsoMidpointInHipsLocal.x,
      Math.max(1e-6, torsoMidpointInHipsLocal.y),
    ),
    nextForwardBaseline,
  };
}

export interface AppliedLateralLeanResult {
  gain: number;
  applied: number;
}

export function computeAppliedLateralLean(
  lateralLean: number,
  baseScale: number,
  maxScale: number,
): AppliedLateralLeanResult {
  const gain = computeAdaptiveLateralGain(baseScale, maxScale, Math.abs(lateralLean));
  return {
    gain,
    applied: THREE.MathUtils.clamp(
      -lateralLean * gain,
      THREE.MathUtils.degToRad(-28),
      THREE.MathUtils.degToRad(28),
    ),
  };
}
