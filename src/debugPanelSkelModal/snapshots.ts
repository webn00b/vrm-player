import * as THREE from 'three';
import type { TorsoSolverDiagnostics } from '../mocap/diagnostics/mocapDiagnostics';
import type { PoseFrame } from '../mocap/pipeline/poseDetector';
import { angleVecDeg, avgVec, deltaAxis, distLm, distVec, vecBetween } from './geometry';
import type { ArmDebugTargets, ArmSide, AvatarJointPositions, LimbScales } from './types';

export const computePerformerAvatarSpacePoint = (
  frame: PoseFrame | null,
  avatarHips: THREE.Vector3,
  bodyScale: number,
  scales: LimbScales,
  idx: number,
): THREE.Vector3 | null => {
  if (!frame) return null;
  const lms = frame.worldLandmarks;
  const lm = lms[idx];
  if (!lm) return null;

  const lh = lms[23];
  const rh = lms[24];
  const hipMpX = lh && rh ? (lh.x + rh.x) * 0.5 : 0;
  const hipMpY = lh && rh ? (lh.y + rh.y) * 0.5 : 0;
  const hipMpZ = lh && rh ? (lh.z + rh.z) * 0.5 : 0;

  const scaleOf = (landmarkIdx: number): number => {
    switch (landmarkIdx) {
      case 13: case 15: case 17: case 19: case 21: return scales.armR;
      case 14: case 16: case 18: case 20: case 22: return scales.armL;
      case 25: case 27: case 29: case 31: return scales.legR;
      case 26: case 28: case 30: case 32: return scales.legL;
      default: return bodyScale;
    }
  };

  const anchorMpOf = (landmarkIdx: number): [number, number, number] | null => {
    if ([13, 15, 17, 19, 21].includes(landmarkIdx) && lms[11]) return [lms[11].x, lms[11].y, lms[11].z];
    if ([14, 16, 18, 20, 22].includes(landmarkIdx) && lms[12]) return [lms[12].x, lms[12].y, lms[12].z];
    if ([25, 27, 29, 31].includes(landmarkIdx) && lms[23]) return [lms[23].x, lms[23].y, lms[23].z];
    if ([26, 28, 30, 32].includes(landmarkIdx) && lms[24]) return [lms[24].x, lms[24].y, lms[24].z];
    return [hipMpX, hipMpY, hipMpZ];
  };

  const anchorMp = anchorMpOf(idx);
  if (!anchorMp) return null;

  const anchorX = avatarHips.x - (anchorMp[0] - hipMpX) * bodyScale;
  const anchorY = avatarHips.y - (anchorMp[1] - hipMpY) * bodyScale;
  const anchorZ = avatarHips.z - (anchorMp[2] - hipMpZ) * bodyScale;

  const scale = scaleOf(idx);
  const sx = -(lm.x - anchorMp[0]);
  const sy = -(lm.y - anchorMp[1]);
  const sz = -(lm.z - anchorMp[2]);
  return new THREE.Vector3(anchorX + sx * scale, anchorY + sy * scale, anchorZ + sz * scale);
};

export const buildArmSnapshot = (
  side: ArmSide,
  frame: PoseFrame | null,
  normalizedAvatar: AvatarJointPositions,
  rawAvatar: AvatarJointPositions,
  bodyScale: number,
  scales: LimbScales,
  armDebug: ArmDebugTargets,
  target: THREE.Vector3 | null,
  reachPercent: number,
) => {
  const source = side === 'left'
    ? { shoulder: 12, elbow: 14, wrist: 16, mapping: 'Avatar LEFT ← performer RIGHT (12/14/16)' }
    : { shoulder: 11, elbow: 13, wrist: 15, mapping: 'Avatar RIGHT ← performer LEFT (11/13/15)' };

  const rawShoulder = frame?.worldLandmarks[source.shoulder] ?? null;
  const rawElbow    = frame?.worldLandmarks[source.elbow] ?? null;
  const rawWrist    = frame?.worldLandmarks[source.wrist] ?? null;

  const performerAvatarShoulder = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, source.shoulder);
  const performerAvatarElbow    = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, source.elbow);
  const performerAvatarWrist    = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, source.wrist);

  const actualNormShoulder = side === 'left' ? normalizedAvatar.leftUpperArm  : normalizedAvatar.rightUpperArm;
  const actualNormElbow    = side === 'left' ? normalizedAvatar.leftLowerArm  : normalizedAvatar.rightLowerArm;
  const actualNormWrist    = side === 'left' ? normalizedAvatar.leftHand      : normalizedAvatar.rightHand;
  const actualRawShoulder  = side === 'left' ? rawAvatar.leftUpperArm         : rawAvatar.rightUpperArm;
  const actualRawElbow     = side === 'left' ? rawAvatar.leftLowerArm         : rawAvatar.rightLowerArm;
  const actualRawWrist     = side === 'left' ? rawAvatar.leftHand             : rawAvatar.rightHand;

  return {
    side,
    mapping: source.mapping,
    raw: { shoulder: rawShoulder, elbow: rawElbow, wrist: rawWrist },
    performerAvatar: {
      shoulder: performerAvatarShoulder,
      elbow: performerAvatarElbow,
      wrist: performerAvatarWrist,
    },
    actualNormalized: {
      shoulder: actualNormShoulder,
      elbow: actualNormElbow,
      wrist: actualNormWrist,
    },
    actualRaw: {
      shoulder: actualRawShoulder,
      elbow: actualRawElbow,
      wrist: actualRawWrist,
    },
    elbowTarget: armDebug.elbowTarget,
    target,
    poleRaw: armDebug.poleRaw,
    poleSmoothed: armDebug.poleSmoothed,
    solver: armDebug,
    reachPercent,
    errors: {
      shoulderGreenToNorm:   distVec(performerAvatarShoulder, actualNormShoulder),
      shoulderGreenToRaw:    distVec(performerAvatarShoulder, actualRawShoulder),
      elbowGreenToBlue:      distVec(performerAvatarElbow, armDebug.elbowTarget),
      elbowBlueToNorm:       distVec(armDebug.elbowTarget, actualNormElbow),
      elbowBlueToRaw:        distVec(armDebug.elbowTarget, actualRawElbow),
      elbowGreenToNorm:      distVec(performerAvatarElbow, actualNormElbow),
      elbowGreenToRaw:       distVec(performerAvatarElbow, actualRawElbow),
      wristGreenToBlue:      distVec(performerAvatarWrist, target),
      wristBlueToNorm:       distVec(target, actualNormWrist),
      wristBlueToRaw:        distVec(target, actualRawWrist),
      wristGreenToNorm:      distVec(performerAvatarWrist, actualNormWrist),
      wristGreenToRaw:       distVec(performerAvatarWrist, actualRawWrist),
      wristNormToRaw:        distVec(actualNormWrist, actualRawWrist),
    },
    lengths: {
      performerRawUpper:    distLm(rawShoulder, rawElbow),
      performerRawLower:    distLm(rawElbow, rawWrist),
      performerAvatarUpper: distVec(performerAvatarShoulder, performerAvatarElbow),
      performerAvatarLower: distVec(performerAvatarElbow, performerAvatarWrist),
      actualNormUpper:      distVec(actualNormShoulder, actualNormElbow),
      actualNormLower:      distVec(actualNormElbow, actualNormWrist),
      actualRawUpper:       distVec(actualRawShoulder, actualRawElbow),
      actualRawLower:       distVec(actualRawElbow, actualRawWrist),
    },
    feasibility: {
      upperDelta: distVec(performerAvatarShoulder, performerAvatarElbow) - distVec(actualNormShoulder, actualNormElbow),
      lowerDelta: distVec(performerAvatarElbow, performerAvatarWrist) - distVec(actualNormElbow, actualNormWrist),
    },
  };
};

export const buildTorsoSnapshot = (
  frame: PoseFrame | null,
  normalizedAvatar: AvatarJointPositions,
  rawAvatar: AvatarJointPositions,
  bodyScale: number,
  scales: LimbScales,
  torsoDebug: TorsoSolverDiagnostics,
) => {
  const projectedLeftShoulder  = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 12);
  const projectedRightShoulder = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 11);
  const projectedLeftHip       = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 24);
  const projectedRightHip      = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 23);

  const projectedShoulderMid = avgVec(projectedLeftShoulder, projectedRightShoulder);
  const projectedHipMid      = avgVec(projectedLeftHip, projectedRightHip);
  const projectedShoulderAxis = vecBetween(projectedLeftShoulder, projectedRightShoulder);
  const projectedHipAxis      = vecBetween(projectedLeftHip, projectedRightHip);

  const normLeftShoulder   = normalizedAvatar.leftUpperArm;
  const normRightShoulder  = normalizedAvatar.rightUpperArm;
  const normLeftHip        = normalizedAvatar.leftUpperLeg;
  const normRightHip       = normalizedAvatar.rightUpperLeg;
  const normShoulderMid    = avgVec(normLeftShoulder, normRightShoulder);
  const normHipMid         = avgVec(normLeftHip, normRightHip);
  const normShoulderAxis   = vecBetween(normLeftShoulder, normRightShoulder);
  const normHipAxis        = vecBetween(normLeftHip, normRightHip);

  const rawLeftShoulder    = rawAvatar.leftUpperArm;
  const rawRightShoulder   = rawAvatar.rightUpperArm;
  const rawLeftHip         = rawAvatar.leftUpperLeg;
  const rawRightHip        = rawAvatar.rightUpperLeg;
  const rawShoulderMid     = avgVec(rawLeftShoulder, rawRightShoulder);
  const rawHipMid          = avgVec(rawLeftHip, rawRightHip);
  const rawShoulderAxis    = vecBetween(rawLeftShoulder, rawRightShoulder);
  const rawHipAxis         = vecBetween(rawLeftHip, rawRightHip);

  return {
    projected: {
      leftShoulder: projectedLeftShoulder,
      rightShoulder: projectedRightShoulder,
      shoulderMid: projectedShoulderMid,
      leftHip: projectedLeftHip,
      rightHip: projectedRightHip,
      hipMid: projectedHipMid,
      shoulderAxis: projectedShoulderAxis,
      hipAxis: projectedHipAxis,
    },
    actualNormalized: {
      leftShoulder: normLeftShoulder,
      rightShoulder: normRightShoulder,
      shoulderMid: normShoulderMid,
      leftHip: normLeftHip,
      rightHip: normRightHip,
      hipMid: normHipMid,
      shoulderAxis: normShoulderAxis,
      hipAxis: normHipAxis,
    },
    actualRaw: {
      leftShoulder: rawLeftShoulder,
      rightShoulder: rawRightShoulder,
      shoulderMid: rawShoulderMid,
      leftHip: rawLeftHip,
      rightHip: rawRightHip,
      hipMid: rawHipMid,
      shoulderAxis: rawShoulderAxis,
      hipAxis: rawHipAxis,
    },
    errors: {
      shoulderMidGreenToNorm: distVec(projectedShoulderMid, normShoulderMid),
      shoulderMidGreenToRaw:  distVec(projectedShoulderMid, rawShoulderMid),
      hipMidGreenToNorm:      distVec(projectedHipMid, normHipMid),
      hipMidGreenToRaw:       distVec(projectedHipMid, rawHipMid),
      shoulderAxisGreenToNorm: angleVecDeg(projectedShoulderAxis, normShoulderAxis),
      shoulderAxisGreenToRaw:  angleVecDeg(projectedShoulderAxis, rawShoulderAxis),
      hipAxisGreenToNorm:      angleVecDeg(projectedHipAxis, normHipAxis),
      hipAxisGreenToRaw:       angleVecDeg(projectedHipAxis, rawHipAxis),
      shoulderWidthGreenToNorm: distVec(projectedLeftShoulder, projectedRightShoulder) - distVec(normLeftShoulder, normRightShoulder),
      shoulderWidthGreenToRaw:  distVec(projectedLeftShoulder, projectedRightShoulder) - distVec(rawLeftShoulder, rawRightShoulder),
      torsoHeightGreenToNorm:   deltaAxis(projectedShoulderMid, projectedHipMid, 'y') - deltaAxis(normShoulderMid, normHipMid, 'y'),
      torsoHeightGreenToRaw:    deltaAxis(projectedShoulderMid, projectedHipMid, 'y') - deltaAxis(rawShoulderMid, rawHipMid, 'y'),
      torsoDepthGreenToNorm:    deltaAxis(projectedShoulderMid, projectedHipMid, 'z') - deltaAxis(normShoulderMid, normHipMid, 'z'),
      torsoDepthGreenToRaw:     deltaAxis(projectedShoulderMid, projectedHipMid, 'z') - deltaAxis(rawShoulderMid, rawHipMid, 'z'),
    },
    lengths: {
      shoulderWidthGreen: distVec(projectedLeftShoulder, projectedRightShoulder),
      shoulderWidthNorm:  distVec(normLeftShoulder, normRightShoulder),
      shoulderWidthRaw:   distVec(rawLeftShoulder, rawRightShoulder),
      hipWidthGreen:      distVec(projectedLeftHip, projectedRightHip),
      hipWidthNorm:       distVec(normLeftHip, normRightHip),
      hipWidthRaw:        distVec(rawLeftHip, rawRightHip),
      torsoHeightGreen:   deltaAxis(projectedShoulderMid, projectedHipMid, 'y'),
      torsoHeightNorm:    deltaAxis(normShoulderMid, normHipMid, 'y'),
      torsoHeightRaw:     deltaAxis(rawShoulderMid, rawHipMid, 'y'),
      torsoDepthGreen:    deltaAxis(projectedShoulderMid, projectedHipMid, 'z'),
      torsoDepthNorm:     deltaAxis(normShoulderMid, normHipMid, 'z'),
      torsoDepthRaw:      deltaAxis(rawShoulderMid, rawHipMid, 'z'),
    },
    solver: torsoDebug,
  };
};
