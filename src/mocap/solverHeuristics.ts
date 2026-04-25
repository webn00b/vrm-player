import * as THREE from 'three';

const RAD_5 = THREE.MathUtils.degToRad(5);
const RAD_12 = THREE.MathUtils.degToRad(12);

export function computeAdaptiveLateralGain(
  baseScale: number,
  maxScale: number,
  lateralLeanAbs: number,
): number {
  return THREE.MathUtils.lerp(
    baseScale,
    Math.max(baseScale, maxScale),
    THREE.MathUtils.clamp((lateralLeanAbs - RAD_5) / RAD_12, 0, 1),
  );
}

export interface ArmScaleCapResult {
  effectiveScale: number;
  cap: number | null;
}

export function capArmScaleByCurrentSegments(
  rawScale: number,
  avatarArmLen: number,
  perfSegmentLen: number,
): ArmScaleCapResult {
  if (!(rawScale > 1.02) || avatarArmLen <= 1e-4 || perfSegmentLen <= 1e-4) {
    return { effectiveScale: rawScale, cap: null };
  }

  const cap = (avatarArmLen / perfSegmentLen) * 1.05;
  return { effectiveScale: Math.min(rawScale, cap), cap };
}

export function computeMidpointBlend(
  shoulderCenterOffset: number,
  wristCenterOffset: number,
): number {
  if (Math.abs(shoulderCenterOffset) <= 1e-4) return 0;
  if (shoulderCenterOffset * wristCenterOffset <= 0) return 1;

  const centerRatio = Math.abs(wristCenterOffset) / Math.abs(shoulderCenterOffset);
  return THREE.MathUtils.clamp((0.35 - centerRatio) / 0.35, 0, 1);
}

export function computeHandsTogetherBlend(
  shoulderSpan: number,
  wristGap: number,
  wristLevelDelta: number,
): number {
  if (shoulderSpan <= 1e-4) return 0;

  const gapRatio = wristGap / shoulderSpan;
  const wristLevelRatio = Math.abs(wristLevelDelta) / shoulderSpan;
  return wristLevelRatio <= 0.25
    ? THREE.MathUtils.clamp((0.55 - gapRatio) / 0.30, 0, 1)
    : 0;
}

export function computePrayerBlend(
  handsTogetherBlend: number,
  armBendRatio: number,
  wristBelowShoulders: number,
): number {
  return handsTogetherBlend
    * THREE.MathUtils.clamp((armBendRatio - 0.10) / 0.22, 0, 1)
    * wristBelowShoulders;
}

export function computeFrontPoseBlendBase(
  midpointBlend: number,
  handsTogetherBlend: number,
  chestPrayerBlend: number,
): number {
  return Math.max(
    midpointBlend * (1 - chestPrayerBlend * 0.95),
    handsTogetherBlend * (1 - chestPrayerBlend * 0.85),
  );
}

export interface FaceNearBlendParams {
  handsTogetherBlend: number;
  shoulderSpan2D: number;
  tipX: number;
  tipY: number;
  mouthX: number;
  mouthY: number;
  mouthSpan2D: number;
  wristNormY: number;
}

export function computeFaceNearBlend({
  handsTogetherBlend,
  shoulderSpan2D,
  tipX,
  tipY,
  mouthX,
  mouthY,
  mouthSpan2D,
  wristNormY,
}: FaceNearBlendParams): number {
  if (shoulderSpan2D <= 1e-4) return 0;

  const faceXAllowance = Math.max(mouthSpan2D * 1.4, shoulderSpan2D * 0.16);
  const faceYAllowance = shoulderSpan2D * 0.20;
  const dxBlend = THREE.MathUtils.clamp(
    (faceXAllowance - Math.abs(tipX - mouthX)) / Math.max(1e-4, faceXAllowance),
    0,
    1,
  );
  const dyBlend = THREE.MathUtils.clamp(
    (faceYAllowance - Math.abs(tipY - mouthY)) / Math.max(1e-4, faceYAllowance),
    0,
    1,
  );
  const wristLiftNeed = THREE.MathUtils.clamp(
    (wristNormY - mouthY) / Math.max(1e-4, shoulderSpan2D * 0.35),
    0,
    1,
  );

  return handsTogetherBlend * dxBlend * dyBlend * wristLiftNeed;
}
