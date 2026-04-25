import * as THREE from 'three';
import type { HandFrame, Landmark3D } from './poseDetector';
import type { ArmSolverDiagnostics } from './mocapDiagnostics';
import { FACE, LM } from './directPoseConfig';
import { mpDeltaToVrm, mpDirToVrm } from './motionSpace';
import {
  computeFaceNearBlend,
  computeFrontPoseBlendBase,
  computeHandsTogetherBlend,
  computeMidpointBlend,
  computePrayerBlend,
} from './solverHeuristics';

export interface ArmTargetSolverInput {
  side: 'left' | 'right';
  mirrorX: boolean;
  perfLeftShoulder: Landmark3D;
  perfRightShoulder: Landmark3D;
  perfShoulder: Landmark3D;
  perfElbow: Landmark3D;
  perfWrist: Landmark3D;
  otherWrist: Landmark3D | null;
  perfLeftHip: Landmark3D | null;
  perfRightHip: Landmark3D | null;
  bodyLandmarks: Landmark3D[];
  faceLandmarks: Landmark3D[];
  hand: HandFrame | undefined;
  hasBothHandsDetected: boolean;
  shoulderWorld: THREE.Vector3;
  midAvatarShoulder: THREE.Vector3;
  chestWorld: THREE.Vector3 | null;
  neckWorld: THREE.Vector3 | null;
  headWorld: THREE.Vector3 | null;
  rawArmScale: number;
  armScale: number;
  shoulderScale: number;
  bodyScale: number;
  avatarArmLen: number;
  avatarShoulderWidth: number;
  armZAttenuation: number;
  armPoleZ: number;
}

export interface ArmTargetSolverResult {
  target: THREE.Vector3;
  elbowTarget: THREE.Vector3;
  rawPoleDirection: THREE.Vector3;
  frontPoseBlendBase: number;
  diagnostics: ArmSolverDiagnostics;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();

export function solveArmTarget(input: ArmTargetSolverInput): ArmTargetSolverResult {
  const {
    side,
    mirrorX,
    perfLeftShoulder,
    perfRightShoulder,
    perfShoulder,
    perfElbow,
    perfWrist,
    otherWrist,
    perfLeftHip,
    perfRightHip,
    bodyLandmarks,
    faceLandmarks,
    hand,
    hasBothHandsDetected,
    shoulderWorld,
    midAvatarShoulder,
    chestWorld,
    neckWorld,
    headWorld,
    rawArmScale,
    armScale,
    shoulderScale,
    bodyScale,
    avatarArmLen,
    avatarShoulderWidth,
    armZAttenuation,
    armPoleZ,
  } = input;

  const perfMidX = (perfLeftShoulder.x + perfRightShoulder.x) * 0.5;
  const perfMidY = (perfLeftShoulder.y + perfRightShoulder.y) * 0.5;
  const perfMidZ = (perfLeftShoulder.z + perfRightShoulder.z) * 0.5;
  const shoulderDx = perfRightShoulder.x - perfLeftShoulder.x;
  const shoulderDy = perfRightShoulder.y - perfLeftShoulder.y;
  const shoulderDz = perfRightShoulder.z - perfLeftShoulder.z;
  const shoulderSpan = Math.hypot(shoulderDx, shoulderDy, shoulderDz);
  const shoulderCenterOffset = perfShoulder.x - perfMidX;
  const wristCenterOffset = perfWrist.x - perfMidX;
  const midpointBlend = computeMidpointBlend(shoulderCenterOffset, wristCenterOffset);

  mpDeltaToVrm(mirrorX, perfWrist.x - perfMidX, perfWrist.y - perfMidY, perfWrist.z - perfMidZ, _v1);
  _v1.x *= shoulderScale;
  _v1.y *= armScale;
  _v1.z *= armScale * armZAttenuation;
  const midpointTarget = _v4.copy(midAvatarShoulder).add(_v1);

  mpDeltaToVrm(mirrorX, perfWrist.x - perfShoulder.x, perfWrist.y - perfShoulder.y, perfWrist.z - perfShoulder.z, _v2);
  _v2.multiplyScalar(armScale);
  _v2.z *= armZAttenuation;
  const target = _v3.copy(shoulderWorld).add(_v2);
  target.lerp(midpointTarget, midpointBlend);

  let handsTogetherBlend = 0;
  if (hasBothHandsDetected && otherWrist) {
    const wristDx = perfWrist.x - otherWrist.x;
    const wristDy = perfWrist.y - otherWrist.y;
    const wristDz = perfWrist.z - otherWrist.z;
    const wristGap = Math.hypot(wristDx, wristDy, wristDz);

    if (shoulderSpan > 1e-4) {
      handsTogetherBlend = computeHandsTogetherBlend(shoulderSpan, wristGap, perfWrist.y - otherWrist.y);
      if (handsTogetherBlend > 1e-4) {
        const wristMidX = (perfWrist.x + otherWrist.x) * 0.5;
        const wristMidY = (perfWrist.y + otherWrist.y) * 0.5;
        const wristMidZ = (perfWrist.z + otherWrist.z) * 0.5;
        mpDeltaToVrm(mirrorX, wristMidX - perfMidX, wristMidY - perfMidY, wristMidZ - perfMidZ, _v1);
        _v1.x *= shoulderScale;
        _v1.y *= armScale;
        _v1.z *= armScale * armZAttenuation;
        _v2.copy(midAvatarShoulder).add(_v1);
        target.lerp(_v2, handsTogetherBlend);

        _v4.copy(shoulderWorld).sub(midAvatarShoulder);
        if (_v4.lengthSq() > 1e-6) _v4.normalize();
        else _v4.set(side === 'left' ? -1 : 1, 0, 0);
        const desiredWristGap = THREE.MathUtils.clamp(
          wristGap * shoulderScale,
          avatarShoulderWidth * 0.12,
          avatarShoulderWidth * 0.22,
        );
        target.addScaledVector(_v4, desiredWristGap * 0.5 * handsTogetherBlend);
      }
    }
  }

  const perfHipMidZ = perfLeftHip && perfRightHip ? (perfLeftHip.z + perfRightHip.z) * 0.5 : perfMidZ;
  const perfUpperLen = Math.hypot(
    perfElbow.x - perfShoulder.x,
    perfElbow.y - perfShoulder.y,
    perfElbow.z - perfShoulder.z,
  );
  const perfLowerLen = Math.hypot(
    perfWrist.x - perfElbow.x,
    perfWrist.y - perfElbow.y,
    perfWrist.z - perfElbow.z,
  );
  const perfSegmentLen = perfUpperLen + perfLowerLen;
  const wristDirectLen = Math.hypot(
    perfWrist.x - perfShoulder.x,
    perfWrist.y - perfShoulder.y,
    perfWrist.z - perfShoulder.z,
  );
  const armBendRatio = perfSegmentLen > 1e-4
    ? THREE.MathUtils.clamp(1 - wristDirectLen / perfSegmentLen, 0, 1)
    : 0;
  const wristBelowShoulders = shoulderSpan > 1e-4
    ? THREE.MathUtils.clamp((perfWrist.y - perfMidY) / (shoulderSpan * 0.45), 0, 1)
    : 0;
  const chestPrayerBlend = computePrayerBlend(handsTogetherBlend, armBendRatio, wristBelowShoulders);
  if (chestPrayerBlend > 1e-4) {
    const prayerYRatio = THREE.MathUtils.lerp(
      1,
      THREE.MathUtils.clamp(rawArmScale / Math.max(1e-4, armScale), 1, 1.6),
      chestPrayerBlend,
    );
    const chestDepthScale = Math.max(shoulderScale, bodyScale);
    const prayerZRatio = THREE.MathUtils.lerp(
      1,
      chestDepthScale / Math.max(1e-4, armScale),
      chestPrayerBlend * 0.9,
    );
    _v1.copy(target).sub(midAvatarShoulder);
    _v1.y *= prayerYRatio;
    _v1.z *= prayerZRatio;
    if (chestWorld) {
      _v2.copy(chestWorld);
      if (neckWorld) {
        _v2.lerp(neckWorld, THREE.MathUtils.lerp(0.2, 0.55, chestPrayerBlend));
      }
      _v2.add(_v1);
      target.lerp(_v2, chestPrayerBlend);
    } else {
      target.copy(midAvatarShoulder).add(_v1);
    }
  }

  let faceNearBlend = 0;
  const lShoulderNorm = bodyLandmarks[LM.LEFT_SHOULDER];
  const rShoulderNorm = bodyLandmarks[LM.RIGHT_SHOULDER];
  const mouthTop = faceLandmarks[FACE.MOUTH_TOP];
  const mouthBottom = faceLandmarks[FACE.MOUTH_BOTTOM];
  const mouthLeft = faceLandmarks[FACE.MOUTH_LEFT];
  const mouthRight = faceLandmarks[FACE.MOUTH_RIGHT];
  if (
    hand?.landmarks.length &&
    lShoulderNorm && rShoulderNorm &&
    mouthTop && mouthBottom && mouthLeft && mouthRight
  ) {
    const tipA = hand.landmarks[8];
    const tipB = hand.landmarks[12];
    const wristNorm = hand.landmarks[0];
    if (tipA && tipB && wristNorm) {
      const shoulderSpan2D = Math.hypot(
        rShoulderNorm.x - lShoulderNorm.x,
        rShoulderNorm.y - lShoulderNorm.y,
      );
      if (shoulderSpan2D > 1e-4) {
        const tipX = (tipA.x + tipB.x) * 0.5;
        const tipY = Math.min(tipA.y, tipB.y);
        const mouthX = (mouthLeft.x + mouthRight.x) * 0.5;
        const mouthY = (mouthTop.y + mouthBottom.y) * 0.5;
        const mouthSpan2D = Math.hypot(mouthRight.x - mouthLeft.x, mouthRight.y - mouthLeft.y);
        faceNearBlend = computeFaceNearBlend({
          handsTogetherBlend,
          shoulderSpan2D,
          tipX,
          tipY,
          mouthX,
          mouthY,
          mouthSpan2D,
          wristNormY: wristNorm.y,
        });
      }
    }
  }

  const frontPoseBlendBase = computeFrontPoseBlendBase(
    midpointBlend,
    handsTogetherBlend,
    chestPrayerBlend,
  );

  const wristForward = Math.max(0, perfMidZ - perfWrist.z);
  const wristFrontBlend = shoulderSpan > 1e-4
    ? THREE.MathUtils.clamp(wristForward / (shoulderSpan * 0.18), 0, 1)
    : 0;
  const frontPoseBlend = frontPoseBlendBase * wristFrontBlend * (1 - faceNearBlend * 0.9);
  if (frontPoseBlend > 1e-4 && perfLeftHip && perfRightHip) {
    mpDeltaToVrm(mirrorX, 0, 0, perfMidZ - perfHipMidZ, _v1);
    const chestForwardBias = Math.max(0, _v1.z) * bodyScale * 0.9 * frontPoseBlend;
    target.z += chestForwardBias;
  }

  if (faceNearBlend > 1e-4 && (neckWorld || chestWorld)) {
    _v2.copy(neckWorld ?? chestWorld!);
    if (headWorld) {
      _v2.lerp(headWorld, THREE.MathUtils.lerp(0.12, 0.30, faceNearBlend));
    }
    _v1.copy(target).sub(midAvatarShoulder);
    _v1.x *= THREE.MathUtils.lerp(1, 0.35, faceNearBlend);
    _v1.y *= THREE.MathUtils.lerp(1, 0.08, faceNearBlend);
    _v1.z *= THREE.MathUtils.lerp(1, 0.28, faceNearBlend);
    _v2.add(_v1);
    target.lerp(_v2, faceNearBlend);
  }

  if (chestPrayerBlend > 1e-4 || faceNearBlend > 1e-4) {
    const foldBlend = Math.max(chestPrayerBlend, faceNearBlend);
    const foldedReachRatio = THREE.MathUtils.lerp(0.82, 0.74, faceNearBlend);
    const prayerReachMax = avatarArmLen * THREE.MathUtils.lerp(1, foldedReachRatio, foldBlend);
    _v1.copy(target).sub(shoulderWorld);
    const reach = _v1.length();
    if (reach > prayerReachMax && reach > 1e-4) {
      _v1.multiplyScalar(prayerReachMax / reach);
      target.copy(shoulderWorld).add(_v1);
    }
  }

  const elbowPoleZ = THREE.MathUtils.lerp(armPoleZ, 1, frontPoseBlendBase);
  // _v1 is free here (elbow delta was already consumed into elbowTarget).
  // Use _v1 for pole direction — _v3 aliases `target` and must not be overwritten.
  mpDeltaToVrm(
    mirrorX,
    perfElbow.x - perfShoulder.x,
    perfElbow.y - perfShoulder.y,
    perfElbow.z - perfShoulder.z,
    _v1,
  );
  _v1.multiplyScalar(armScale);
  _v1.z *= elbowPoleZ;
  const elbowTarget = _v2.copy(shoulderWorld).add(_v1);

  mpDirToVrm(
    mirrorX,
    perfElbow.x - perfShoulder.x,
    perfElbow.y - perfShoulder.y,
    perfElbow.z - perfShoulder.z,
    _v1,
  );
  _v1.z *= elbowPoleZ;
  if (_v1.lengthSq() < 1e-6) _v1.set(0, -1, 0);

  return {
    target: target.clone(),
    elbowTarget: elbowTarget.clone(),
    rawPoleDirection: _v1.clone(),
    frontPoseBlendBase,
    diagnostics: {
      rawScale: rawArmScale,
      effectiveScale: armScale,
      segmentScaleCap: Number.NaN,
      midpointBlend,
      handsTogetherBlend,
      chestPrayerBlend,
      wristFrontBlend,
      frontPoseBlend,
      faceNearBlend,
    },
  };
}
