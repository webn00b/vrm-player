import * as THREE from 'three';

export type MocapSide = 'left' | 'right';

export interface ArmSolverDiagnostics {
  rawScale: number;
  effectiveScale: number;
  segmentScaleCap: number;
  midpointBlend: number;
  handsTogetherBlend: number;
  chestPrayerBlend: number;
  wristFrontBlend: number;
  frontPoseBlend: number;
  faceNearBlend: number;
}

export interface TorsoSolverDiagnostics {
  forwardLeanRaw: number;
  forwardLeanApplied: number;
  lateralLeanRaw: number;
  lateralLeanApplied: number;
  lateralLeanGain: number;
}

export interface MocapDebugTargets {
  leftWristTarget: THREE.Vector3;
  rightWristTarget: THREE.Vector3;
  leftElbowTarget: THREE.Vector3;
  rightElbowTarget: THREE.Vector3;
  leftArmPoleRaw: THREE.Vector3;
  rightArmPoleRaw: THREE.Vector3;
  leftArmPoleSmoothed: THREE.Vector3;
  rightArmPoleSmoothed: THREE.Vector3;
  leftAnkleTarget: THREE.Vector3;
  rightAnkleTarget: THREE.Vector3;
  leftArmSolver: ArmSolverDiagnostics;
  rightArmSolver: ArmSolverDiagnostics;
  torsoSolver: TorsoSolverDiagnostics;
  hasArm: boolean;
  hasLeg: boolean;
  leftFootLocked: boolean;
  rightFootLocked: boolean;
}

export function createArmSolverDiagnostics(): ArmSolverDiagnostics {
  return {
    rawScale: Number.NaN,
    effectiveScale: Number.NaN,
    segmentScaleCap: Number.NaN,
    midpointBlend: Number.NaN,
    handsTogetherBlend: Number.NaN,
    chestPrayerBlend: Number.NaN,
    wristFrontBlend: Number.NaN,
    frontPoseBlend: Number.NaN,
    faceNearBlend: Number.NaN,
  };
}

export function createTorsoSolverDiagnostics(): TorsoSolverDiagnostics {
  return {
    forwardLeanRaw: Number.NaN,
    forwardLeanApplied: Number.NaN,
    lateralLeanRaw: Number.NaN,
    lateralLeanApplied: Number.NaN,
    lateralLeanGain: Number.NaN,
  };
}

export function createMocapDebugTargets(): MocapDebugTargets {
  return {
    leftWristTarget: new THREE.Vector3(),
    rightWristTarget: new THREE.Vector3(),
    leftElbowTarget: new THREE.Vector3(),
    rightElbowTarget: new THREE.Vector3(),
    leftArmPoleRaw: new THREE.Vector3(),
    rightArmPoleRaw: new THREE.Vector3(),
    leftArmPoleSmoothed: new THREE.Vector3(),
    rightArmPoleSmoothed: new THREE.Vector3(),
    leftAnkleTarget: new THREE.Vector3(),
    rightAnkleTarget: new THREE.Vector3(),
    leftArmSolver: createArmSolverDiagnostics(),
    rightArmSolver: createArmSolverDiagnostics(),
    torsoSolver: createTorsoSolverDiagnostics(),
    hasArm: false,
    hasLeg: false,
    leftFootLocked: false,
    rightFootLocked: false,
  };
}

export function resetArmSolverDiagnostics(diag: ArmSolverDiagnostics): void {
  diag.rawScale = Number.NaN;
  diag.effectiveScale = Number.NaN;
  diag.segmentScaleCap = Number.NaN;
  diag.midpointBlend = Number.NaN;
  diag.handsTogetherBlend = Number.NaN;
  diag.chestPrayerBlend = Number.NaN;
  diag.wristFrontBlend = Number.NaN;
  diag.frontPoseBlend = Number.NaN;
  diag.faceNearBlend = Number.NaN;
}

export function resetTorsoSolverDiagnostics(diag: TorsoSolverDiagnostics): void {
  diag.forwardLeanRaw = Number.NaN;
  diag.forwardLeanApplied = Number.NaN;
  diag.lateralLeanRaw = Number.NaN;
  diag.lateralLeanApplied = Number.NaN;
  diag.lateralLeanGain = Number.NaN;
}

export function resetMocapDebugTargets(targets: MocapDebugTargets): void {
  targets.hasArm = false;
  targets.hasLeg = false;
  targets.leftFootLocked = false;
  targets.rightFootLocked = false;
  resetArmSolverDiagnostics(targets.leftArmSolver);
  resetArmSolverDiagnostics(targets.rightArmSolver);
  resetTorsoSolverDiagnostics(targets.torsoSolver);
}

export function getArmSolverDiagnostics(
  targets: MocapDebugTargets,
  side: MocapSide,
): ArmSolverDiagnostics {
  return side === 'left' ? targets.leftArmSolver : targets.rightArmSolver;
}

export function getWristTarget(
  targets: MocapDebugTargets,
  side: MocapSide,
): THREE.Vector3 {
  return side === 'left' ? targets.leftWristTarget : targets.rightWristTarget;
}

export function getElbowTarget(
  targets: MocapDebugTargets,
  side: MocapSide,
): THREE.Vector3 {
  return side === 'left' ? targets.leftElbowTarget : targets.rightElbowTarget;
}

export function getArmPoleRaw(
  targets: MocapDebugTargets,
  side: MocapSide,
): THREE.Vector3 {
  return side === 'left' ? targets.leftArmPoleRaw : targets.rightArmPoleRaw;
}

export function getArmPoleSmoothed(
  targets: MocapDebugTargets,
  side: MocapSide,
): THREE.Vector3 {
  return side === 'left' ? targets.leftArmPoleSmoothed : targets.rightArmPoleSmoothed;
}

export function getAnkleTarget(
  targets: MocapDebugTargets,
  side: MocapSide,
): THREE.Vector3 {
  return side === 'left' ? targets.leftAnkleTarget : targets.rightAnkleTarget;
}
