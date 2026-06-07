import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { getCachedHumanoidRestAxes, type HumanoidRestAxisInfo } from '../humanoidRestPose';
import { applyTwoBoneChain } from '../mocap/solvers/twoBoneChainApplication';
import { getPoseConstraints, type PoseConstraintProfileId, type PoseConstraints } from './poseConstraints';

export type ArmPoseClass = 'sideReach' | 'frontReach' | 'overhead' | 'crossBody' | 'behindBack' | 'unknown';

export interface PoseArmStats {
  available: boolean;
  poseClass: ArmPoseClass;
  upperArmForwardDeg: number | null;
  forearmForwardDeg: number | null;
  elbowBendDeg: number | null;
  wristReachRatio: number | null;
  violations: string[];
  clamped: boolean;
}

export interface PoseValidationStats {
  clampedThisFrame: number;
  violations: string[];
  arms: {
    left: PoseArmStats;
    right: PoseArmStats;
  };
}

export interface PoseValidatorOptions {
  profileId?: PoseConstraintProfileId;
}

export interface ArmWorldSnapshot {
  upperLength: number;
  lowerLength: number;
  upperArmForwardDeg: number | null;
  forearmForwardDeg: number | null;
}

interface ArmNodes {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  hand: THREE.Object3D;
}

interface TorsoBasis {
  forward: THREE.Vector3;
  up: THREE.Vector3;
  left: THREE.Vector3;
}

const BACKWARD_ARM_DEG = 120;
const UPPER_ONLY_IK_MARGIN_DEG = 20;
const OVERHEAD_Y = 0.7;
const FRONT_DEG = 65;
const CROSS_BODY_X = 0.35;

const _hips = new THREE.Vector3();
const _neck = new THREE.Vector3();
const _leftShoulder = new THREE.Vector3();
const _rightShoulder = new THREE.Vector3();
const _torsoUp = new THREE.Vector3();
const _torsoLeft = new THREE.Vector3();
const _torsoForward = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _target = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _upperDir = new THREE.Vector3();
const _forearmDir = new THREE.Vector3();
const FALLBACK_REST_AXIS = {
  left: new THREE.Vector3(1, 0, 0),
  right: new THREE.Vector3(-1, 0, 0),
} as const;

function emptyArmStats(): PoseArmStats {
  return {
    available: false,
    poseClass: 'unknown',
    upperArmForwardDeg: null,
    forearmForwardDeg: null,
    elbowBendDeg: null,
    wristReachRatio: null,
    violations: [],
    clamped: false,
  };
}

function makeInitialStats(): PoseValidationStats {
  return {
    clampedThisFrame: 0,
    violations: [],
    arms: {
      left: emptyArmStats(),
      right: emptyArmStats(),
    },
  };
}

export class PoseValidator {
  enabled = true;
  profileId: PoseConstraintProfileId;

  private stats: PoseValidationStats = makeInitialStats();
  private constraints: PoseConstraints;
  private readonly restAxes: Map<string, HumanoidRestAxisInfo>;

  constructor(private readonly vrm: VRM, opts: PoseValidatorOptions = {}) {
    this.profileId = opts.profileId ?? 'mixamoLive';
    this.constraints = getPoseConstraints(this.profileId);
    this.restAxes = getCachedHumanoidRestAxes(vrm);
  }

  validateAndClamp(excludedBones?: ReadonlySet<VRMHumanBoneName>): PoseValidationStats {
    this.stats = makeInitialStats();
    if (!this.enabled) return this.stats;

    this.vrm.scene?.updateMatrixWorld(true);
    const torso = this.computeTorsoBasis();
    if (!torso) return this.stats;

    const leftBefore = this.computeArmStats('left', torso);
    const rightBefore = this.computeArmStats('right', torso);
    const leftClamped = this.isArmChainExcluded('left', excludedBones)
      ? false
      : this.applyArmIkGuardrail('left', leftBefore, torso);
    const rightClamped = this.isArmChainExcluded('right', excludedBones)
      ? false
      : this.applyArmIkGuardrail('right', rightBefore, torso);

    if (leftClamped || rightClamped) this.vrm.scene?.updateMatrixWorld(true);

    this.stats.arms.left = this.computeArmStats('left', torso, leftClamped);
    this.stats.arms.right = this.computeArmStats('right', torso, rightClamped);
    this.stats.arms.left.violations = leftBefore.violations;
    this.stats.arms.right.violations = rightBefore.violations;
    this.stats.clampedThisFrame = Number(leftClamped) + Number(rightClamped);
    this.stats.violations = [
      ...this.stats.arms.left.violations,
      ...this.stats.arms.right.violations,
    ];
    return this.stats;
  }

  getStats(): PoseValidationStats {
    return this.stats;
  }

  getArmWorldSnapshot(side: 'left' | 'right'): ArmWorldSnapshot {
    this.vrm.scene?.updateMatrixWorld(true);
    const torso = this.computeTorsoBasis();
    const nodes = this.getArmNodes(side);
    if (!torso || !nodes) {
      return { upperLength: 0, lowerLength: 0, upperArmForwardDeg: null, forearmForwardDeg: null };
    }

    const stats = this.computeArmStats(side, torso);
    nodes.upper.getWorldPosition(_a);
    nodes.lower.getWorldPosition(_b);
    nodes.hand.getWorldPosition(_c);
    return {
      upperLength: _a.distanceTo(_b),
      lowerLength: _b.distanceTo(_c),
      upperArmForwardDeg: stats.upperArmForwardDeg,
      forearmForwardDeg: stats.forearmForwardDeg,
    };
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  setProfile(profileId: PoseConstraintProfileId): void {
    this.profileId = profileId;
    this.constraints = getPoseConstraints(profileId);
    this.stats = makeInitialStats();
  }

  private computeTorsoBasis(): TorsoBasis | null {
    const humanoid = this.vrm.humanoid;
    const hips = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    const neck = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck)
      ?? humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest);
    const leftUpper = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
    const rightUpper = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
    if (!hips || !neck || !leftUpper || !rightUpper) return null;

    hips.getWorldPosition(_hips);
    neck.getWorldPosition(_neck);
    leftUpper.getWorldPosition(_leftShoulder);
    rightUpper.getWorldPosition(_rightShoulder);

    _torsoUp.subVectors(_neck, _hips);
    _torsoLeft.subVectors(_leftShoulder, _rightShoulder);
    if (_torsoUp.lengthSq() < 1e-8 || _torsoLeft.lengthSq() < 1e-8) return null;
    _torsoUp.normalize();
    _torsoLeft.normalize();
    _torsoForward.crossVectors(_torsoLeft, _torsoUp);
    if (_torsoForward.lengthSq() < 1e-8) return null;
    _torsoForward.normalize();

    return {
      forward: _torsoForward.clone(),
      up: _torsoUp.clone(),
      left: _torsoLeft.clone(),
    };
  }

  private getArmNodes(side: 'left' | 'right'): ArmNodes | null {
    const humanoid = this.vrm.humanoid;
    const upper = humanoid.getNormalizedBoneNode(
      side === 'left' ? VRMHumanBoneName.LeftUpperArm : VRMHumanBoneName.RightUpperArm,
    );
    const lower = humanoid.getNormalizedBoneNode(
      side === 'left' ? VRMHumanBoneName.LeftLowerArm : VRMHumanBoneName.RightLowerArm,
    );
    const hand = humanoid.getNormalizedBoneNode(
      side === 'left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand,
    );
    return upper && lower && hand ? { upper, lower, hand } : null;
  }

  private computeArmStats(side: 'left' | 'right', torso: TorsoBasis, clamped = false): PoseArmStats {
    const nodes = this.getArmNodes(side);
    if (!nodes) return emptyArmStats();

    nodes.upper.getWorldPosition(_a);
    nodes.lower.getWorldPosition(_b);
    nodes.hand.getWorldPosition(_c);
    _upperDir.subVectors(_b, _a);
    _forearmDir.subVectors(_c, _b);
    const upperLen = _upperDir.length();
    const forearmLen = _forearmDir.length();
    if (upperLen < 1e-8 || forearmLen < 1e-8) return emptyArmStats();
    _upperDir.multiplyScalar(1 / upperLen);
    _forearmDir.multiplyScalar(1 / forearmLen);

    const upperArmForwardDeg = THREE.MathUtils.radToDeg(_upperDir.angleTo(torso.forward));
    const forearmForwardDeg = THREE.MathUtils.radToDeg(_forearmDir.angleTo(torso.forward));
    const elbowBendDeg = 180 - THREE.MathUtils.radToDeg(_upperDir.angleTo(_forearmDir));
    const wristReachRatio = _c.distanceTo(_a) / (upperLen + forearmLen);
    const poseClass = this.classifyArm(side, torso, _upperDir, _forearmDir, upperArmForwardDeg, forearmForwardDeg);
    const violation: string[] = [];
    if (poseClass !== 'overhead' && poseClass !== 'crossBody') {
      if (upperArmForwardDeg > this.constraints.arms.backward.upperArmMaxDeg) {
        violation.push(`${side}UpperArm.backwardChain`);
      }
      if (forearmForwardDeg > this.constraints.arms.backward.forearmMaxDeg) {
        violation.push(`${side}LowerArm.backwardChain`);
      }
    }

    return {
      available: true,
      poseClass,
      upperArmForwardDeg,
      forearmForwardDeg,
      elbowBendDeg,
      wristReachRatio,
      violations: violation,
      clamped,
    };
  }

  private classifyArm(
    side: 'left' | 'right',
    torso: TorsoBasis,
    upperDir: THREE.Vector3,
    forearmDir: THREE.Vector3,
    upperForwardDeg: number,
    forearmForwardDeg: number,
  ): ArmPoseClass {
    if (upperDir.dot(torso.up) > OVERHEAD_Y || forearmDir.dot(torso.up) > OVERHEAD_Y) return 'overhead';
    const lateral = upperDir.dot(torso.left) * (side === 'left' ? 1 : -1);
    if (lateral < -CROSS_BODY_X) return 'crossBody';
    if (upperForwardDeg < FRONT_DEG || forearmForwardDeg < FRONT_DEG) return 'frontReach';
    if (upperForwardDeg > BACKWARD_ARM_DEG && forearmForwardDeg > BACKWARD_ARM_DEG) return 'behindBack';
    return 'sideReach';
  }

  private applyArmIkGuardrail(side: 'left' | 'right', stats: PoseArmStats, torso: TorsoBasis): boolean {
    if (!this.shouldApplyArmIkGuardrail(side, stats)) return false;

    const nodes = this.getArmNodes(side);
    if (!nodes) return false;

    nodes.upper.getWorldPosition(_a);
    nodes.lower.getWorldPosition(_b);
    nodes.hand.getWorldPosition(_c);

    const upperLength = _a.distanceTo(_b);
    const lowerLength = _b.distanceTo(_c);
    if (upperLength < 1e-6 || lowerLength < 1e-6) return false;

    const chainLength = upperLength + lowerLength;
    const lateralSign = side === 'left' ? 1 : -1;
    const bias = this.constraints.arms.ik.safeTargetBias;
    _target.copy(_a)
      .addScaledVector(torso.left, bias.lateral * lateralSign * chainLength)
      .addScaledVector(torso.forward, bias.forward * chainLength)
      .addScaledVector(torso.up, bias.upward * chainLength);

    const poleTuple = this.constraints.arms.ik.sidePole[side];
    _pole.set(0, 0, 0)
      .addScaledVector(torso.left, poleTuple[0] * lateralSign)
      .addScaledVector(torso.up, poleTuple[1])
      .addScaledVector(torso.forward, poleTuple[2]);
    if (_pole.lengthSq() < 1e-8) _pole.copy(torso.up).multiplyScalar(-1);
    else _pole.normalize();

    applyTwoBoneChain({
      rootWorld: _a,
      targetWorld: _target,
      poleDirection: _pole,
      upperLength,
      lowerLength,
      upperNode: nodes.upper,
      lowerNode: nodes.lower,
      upperRestAxis: this.getArmRestAxis(side, 'UpperArm'),
      lowerRestAxis: this.getArmRestAxis(side, 'LowerArm'),
      lerp: this.constraints.arms.ik.correctionLerp,
    });
    return true;
  }

  private getArmRestAxis(side: 'left' | 'right', segment: 'UpperArm' | 'LowerArm'): THREE.Vector3 {
    return this.restAxes.get(`${side}${segment}`)?.rawAxis ?? FALLBACK_REST_AXIS[side];
  }

  private isArmChainExcluded(side: 'left' | 'right', excludedBones?: ReadonlySet<VRMHumanBoneName>): boolean {
    if (!excludedBones) return false;
    const upper = side === 'left' ? VRMHumanBoneName.LeftUpperArm : VRMHumanBoneName.RightUpperArm;
    const lower = side === 'left' ? VRMHumanBoneName.LeftLowerArm : VRMHumanBoneName.RightLowerArm;
    const hand = side === 'left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand;
    return excludedBones.has(upper) || excludedBones.has(lower) || excludedBones.has(hand);
  }

  private shouldApplyArmIkGuardrail(side: 'left' | 'right', stats: PoseArmStats): boolean {
    if (!stats.available || !stats.violations.some((v) => v.endsWith('.backwardChain'))) return false;

    const upperViolation = stats.violations.includes(`${side}UpperArm.backwardChain`);
    const forearmViolation = stats.violations.includes(`${side}LowerArm.backwardChain`);
    if (forearmViolation || stats.poseClass === 'behindBack') return true;

    const upperLimit = this.constraints.arms.backward.upperArmMaxDeg + UPPER_ONLY_IK_MARGIN_DEG;
    return upperViolation && (stats.upperArmForwardDeg ?? 0) > upperLimit;
  }
}
