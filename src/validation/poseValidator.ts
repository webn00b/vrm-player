import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';

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
const OVERHEAD_Y = 0.7;
const FRONT_DEG = 65;
const CROSS_BODY_X = 0.35;

const SIDE_GUARDRAILS = {
  left: {
    min: new THREE.Vector3(THREE.MathUtils.degToRad(-80), THREE.MathUtils.degToRad(-65), THREE.MathUtils.degToRad(-30)),
    max: new THREE.Vector3(THREE.MathUtils.degToRad(+130), THREE.MathUtils.degToRad(+24), THREE.MathUtils.degToRad(+170)),
  },
  right: {
    min: new THREE.Vector3(THREE.MathUtils.degToRad(-80), THREE.MathUtils.degToRad(0), THREE.MathUtils.degToRad(-70)),
    max: new THREE.Vector3(THREE.MathUtils.degToRad(+130), THREE.MathUtils.degToRad(+65), THREE.MathUtils.degToRad(+50)),
  },
} as const;

const UPPER_BACKWARD_TARGET = {
  left: { y: THREE.MathUtils.degToRad(15), z: THREE.MathUtils.degToRad(-15) },
  right: { y: THREE.MathUtils.degToRad(0), z: THREE.MathUtils.degToRad(40) },
} as const;

const LOWER_BACKWARD_TARGET = {
  left: { y: THREE.MathUtils.degToRad(35) },
  right: { y: THREE.MathUtils.degToRad(0) },
} as const;

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
const _upperDir = new THREE.Vector3();
const _forearmDir = new THREE.Vector3();
const _euler = new THREE.Euler();

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

  private stats: PoseValidationStats = makeInitialStats();

  constructor(private readonly vrm: VRM) {}

  validateAndClamp(): PoseValidationStats {
    this.stats = makeInitialStats();
    if (!this.enabled) return this.stats;

    this.vrm.scene?.updateMatrixWorld(true);
    const torso = this.computeTorsoBasis();
    if (!torso) return this.stats;

    const leftBefore = this.computeArmStats('left', torso);
    const rightBefore = this.computeArmStats('right', torso);
    const leftClampCount = this.clampBackwardArmIfNeeded('left', leftBefore);
    const rightClampCount = this.clampBackwardArmIfNeeded('right', rightBefore);
    const leftClamped = leftClampCount > 0;
    const rightClamped = rightClampCount > 0;

    if (leftClamped || rightClamped) this.vrm.scene?.updateMatrixWorld(true);

    this.stats.arms.left = this.computeArmStats('left', torso, leftClamped);
    this.stats.arms.right = this.computeArmStats('right', torso, rightClamped);
    this.stats.arms.left.violations = leftBefore.violations;
    this.stats.arms.right.violations = rightBefore.violations;
    this.stats.clampedThisFrame = leftClampCount + rightClampCount;
    this.stats.violations = [
      ...this.stats.arms.left.violations,
      ...this.stats.arms.right.violations,
    ];
    return this.stats;
  }

  getStats(): PoseValidationStats {
    return this.stats;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
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
      if (upperArmForwardDeg > BACKWARD_ARM_DEG) violation.push(`${side}UpperArm.backwardChain`);
      if (forearmForwardDeg > BACKWARD_ARM_DEG) violation.push(`${side}LowerArm.backwardChain`);
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

  private clampBackwardArmIfNeeded(side: 'left' | 'right', stats: PoseArmStats): number {
    if (!stats.available) return 0;

    const nodes = this.getArmNodes(side);
    if (!nodes) return 0;
    let count = 0;
    if (stats.violations.includes(`${side}UpperArm.backwardChain`)) {
      if (this.clampUpperArmBackward(side, nodes.upper)) count++;
    }
    if (stats.violations.includes(`${side}LowerArm.backwardChain`)) {
      if (this.clampLowerArmBackward(side, nodes.lower)) count++;
    }
    return count;
  }

  private clampUpperArmBackward(side: 'left' | 'right', upper: THREE.Object3D): boolean {
    const limits = SIDE_GUARDRAILS[side];
    const target = UPPER_BACKWARD_TARGET[side];
    _euler.setFromQuaternion(upper.quaternion, 'YXZ');
    const nextX = THREE.MathUtils.clamp(_euler.x, limits.min.x, limits.max.x);
    const nextY = side === 'left'
      ? Math.min(THREE.MathUtils.clamp(_euler.y, limits.min.y, limits.max.y), target.y)
      : Math.max(THREE.MathUtils.clamp(_euler.y, limits.min.y, limits.max.y), target.y);
    const nextZ = side === 'left'
      ? Math.max(THREE.MathUtils.clamp(_euler.z, limits.min.z, limits.max.z), target.z)
      : Math.min(THREE.MathUtils.clamp(_euler.z, limits.min.z, limits.max.z), target.z);
    if (
      Math.abs(nextX - _euler.x) < 1e-8
      && Math.abs(nextY - _euler.y) < 1e-8
      && Math.abs(nextZ - _euler.z) < 1e-8
    ) {
      return false;
    }

    _euler.set(nextX, nextY, nextZ, 'YXZ');
    upper.quaternion.setFromEuler(_euler);
    return true;
  }

  private clampLowerArmBackward(side: 'left' | 'right', lower: THREE.Object3D): boolean {
    const target = LOWER_BACKWARD_TARGET[side];
    _euler.setFromQuaternion(lower.quaternion, 'XYZ');
    const nextY = side === 'left'
      ? Math.min(_euler.y, target.y)
      : Math.max(_euler.y, target.y);
    if (Math.abs(nextY - _euler.y) < 1e-8) return false;
    _euler.set(_euler.x, nextY, _euler.z, 'XYZ');
    lower.quaternion.setFromEuler(_euler);
    return true;
  }
}
