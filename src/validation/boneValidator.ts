/**
 * Runtime bone-rotation validator.
 *
 * Called once per frame (the "chokepoint") after all rotation writers have
 * finished (mocap, BVH mixer, PriorityAnimator) but before the render and
 * before micro-animations layer their small deltas on top.
 *
 * Quaternion → Euler (with per-bone Euler order) → clamp each axis → Euler →
 * Quaternion. Skipped when the incoming rotation already satisfies bounds.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  DEFAULT_BONE_CONSTRAINTS,
  type BoneConstraintProfileId,
  mergeConstraints,
  type RotationConstraint,
} from './boneConstraints';

export interface ValidationStats {
  /** Bones clamped during the most recent frame. */
  clampedThisFrame: number;
  /** Bone with the largest single-axis overshoot this frame, null if none. */
  worstBone: VRMHumanBoneName | null;
  /** Size of that overshoot, radians. */
  worstDelta: number;
  /** World-space arm-chain diagnostics after runtime clamp. */
  armPosture: ValidationArmPostureStats;
}

export interface ArmPostureStats {
  available: boolean;
  upperArmLocalDeg: [number, number, number] | null;
  lowerArmLocalDeg: [number, number, number] | null;
  /** 0° = arm points to avatar front, 90° = side, 180° = straight back. */
  upperArmForwardDeg: number | null;
  /** 0° = forearm points to avatar front, 90° = side, 180° = straight back. */
  forearmForwardDeg: number | null;
}

export interface ValidationArmPostureStats {
  left: ArmPostureStats;
  right: ArmPostureStats;
}

// Reusable scratch — the validator is called every frame on every bone, so we
// avoid allocating Euler / Quaternion objects per call.
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _hipsPos = new THREE.Vector3();
const _neckPos = new THREE.Vector3();
const _leftShoulderPos = new THREE.Vector3();
const _rightShoulderPos = new THREE.Vector3();
const _torsoUp = new THREE.Vector3();
const _torsoLeft = new THREE.Vector3();
const _torsoForward = new THREE.Vector3();
const _armA = new THREE.Vector3();
const _armB = new THREE.Vector3();
const _armC = new THREE.Vector3();
const _upperDir = new THREE.Vector3();
const _forearmDir = new THREE.Vector3();

function emptyArmPostureStats(): ArmPostureStats {
  return {
    available: false,
    upperArmLocalDeg: null,
    lowerArmLocalDeg: null,
    upperArmForwardDeg: null,
    forearmForwardDeg: null,
  };
}

function makeInitialStats(): ValidationStats {
  return {
    clampedThisFrame: 0,
    worstBone: null,
    worstDelta: 0,
    armPosture: {
      left: emptyArmPostureStats(),
      right: emptyArmPostureStats(),
    },
  };
}

export class BoneValidator {
  private vrm: VRM;
  private constraints: Partial<Record<VRMHumanBoneName, RotationConstraint>>;
  private overrides?: Partial<Record<VRMHumanBoneName, RotationConstraint>>;
  private nodeCache = new Map<VRMHumanBoneName, THREE.Object3D>();
  private stats: ValidationStats = makeInitialStats();

  enabled = true;
  profileId: BoneConstraintProfileId = 'default';

  constructor(vrm: VRM, overrides?: Partial<Record<VRMHumanBoneName, RotationConstraint>>) {
    this.vrm = vrm;
    this.overrides = overrides;
    this.constraints = mergeConstraints(overrides, this.profileId);
    this.rebuildCache();
  }

  private rebuildCache(): void {
    this.nodeCache.clear();
    const humanoid = this.vrm.humanoid;
    for (const name of Object.keys(this.constraints) as VRMHumanBoneName[]) {
      const node = humanoid.getNormalizedBoneNode(name);
      if (node) this.nodeCache.set(name, node);
    }
  }

  /**
   * Clamp a quaternion in place against a single bone's constraint.
   * Returns the overshoot magnitude (largest per-axis delta) in radians,
   * or 0 if the input was already in range.
   */
  clampQuaternion(bone: VRMHumanBoneName, q: THREE.Quaternion): number {
    const c = this.constraints[bone];
    if (!c) return 0;

    _euler.setFromQuaternion(q, c.order);
    let ex = _euler.x, ey = _euler.y, ez = _euler.z;
    const [minX, minY, minZ] = c.min;
    const [maxX, maxY, maxZ] = c.max;

    let overshoot = 0;
    const clampAxis = (v: number, lo: number, hi: number): number => {
      if (v < lo) { const d = lo - v; if (d > overshoot) overshoot = d; return lo; }
      if (v > hi) { const d = v - hi; if (d > overshoot) overshoot = d; return hi; }
      return v;
    };

    const cx = clampAxis(ex, minX, maxX);
    const cy = clampAxis(ey, minY, maxY);
    const cz = clampAxis(ez, minZ, maxZ);

    if (overshoot === 0) return 0;

    // Preserve hemisphere: setFromEuler always returns a canonical form, which
    // can be antipodal to the input even when the rotation is similar. That
    // looks like a 180° flip to anything diffing adjacent frames (skel logger,
    // slerp interpolators downstream). Keep the sign aligned with the input.
    const origX = q.x, origY = q.y, origZ = q.z, origW = q.w;
    _euler.set(cx, cy, cz, c.order);
    q.setFromEuler(_euler);
    if (q.x * origX + q.y * origY + q.z * origZ + q.w * origW < 0) {
      q.set(-q.x, -q.y, -q.z, -q.w);
    }
    return overshoot;
  }

  /** Apply clampQuaternion to every known bone. Called once per frame. */
  clampAll(excludedBones?: ReadonlySet<VRMHumanBoneName>): ValidationStats {
    if (!this.enabled) {
      this.stats.clampedThisFrame = 0;
      this.stats.worstBone = null;
      this.stats.worstDelta = 0;
      this.updateArmPostureStats();
      return this.stats;
    }

    let clamped = 0;
    let worstBone: VRMHumanBoneName | null = null;
    let worstDelta = 0;

    for (const [bone, node] of this.nodeCache) {
      if (excludedBones?.has(bone)) continue;
      const overshoot = this.clampQuaternion(bone, node.quaternion);
      if (overshoot > 0) {
        clamped++;
        if (overshoot > worstDelta) { worstDelta = overshoot; worstBone = bone; }
      }
    }

    this.stats.clampedThisFrame = clamped;
    this.stats.worstBone = worstBone;
    this.stats.worstDelta = worstDelta;
    this.updateArmPostureStats();
    return this.stats;
  }

  private updateArmPostureStats(): void {
    const humanoid = this.vrm.humanoid;
    const hips = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    const neck = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck)
      ?? humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest);
    const leftShoulder = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
    const rightShoulder = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);

    this.vrm.scene?.updateMatrixWorld(true);
    if (!hips || !neck || !leftShoulder || !rightShoulder) {
      this.stats.armPosture.left = this.computeArmPosture('left', null);
      this.stats.armPosture.right = this.computeArmPosture('right', null);
      return;
    }

    hips.getWorldPosition(_hipsPos);
    neck.getWorldPosition(_neckPos);
    leftShoulder.getWorldPosition(_leftShoulderPos);
    rightShoulder.getWorldPosition(_rightShoulderPos);

    _torsoUp.subVectors(_neckPos, _hipsPos);
    _torsoLeft.subVectors(_leftShoulderPos, _rightShoulderPos);
    if (_torsoUp.lengthSq() < 1e-8 || _torsoLeft.lengthSq() < 1e-8) {
      this.stats.armPosture.left = this.computeArmPosture('left', null);
      this.stats.armPosture.right = this.computeArmPosture('right', null);
      return;
    }

    _torsoUp.normalize();
    _torsoLeft.normalize();
    // VRM avatar basis used elsewhere in the mocap stack: +X = avatar left,
    // +Y = up, +Z = forward.
    _torsoForward.crossVectors(_torsoLeft, _torsoUp);
    if (_torsoForward.lengthSq() < 1e-8) {
      this.stats.armPosture.left = this.computeArmPosture('left', null);
      this.stats.armPosture.right = this.computeArmPosture('right', null);
      return;
    }
    _torsoForward.normalize();

    this.stats.armPosture.left = this.computeArmPosture('left', _torsoForward);
    this.stats.armPosture.right = this.computeArmPosture('right', _torsoForward);
  }

  private computeArmPosture(side: 'left' | 'right', torsoForward: THREE.Vector3 | null): ArmPostureStats {
    const upperBone = side === 'left' ? VRMHumanBoneName.LeftUpperArm : VRMHumanBoneName.RightUpperArm;
    const lowerBone = side === 'left' ? VRMHumanBoneName.LeftLowerArm : VRMHumanBoneName.RightLowerArm;
    const handBone = side === 'left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand;
    const upper = this.vrm.humanoid.getNormalizedBoneNode(upperBone);
    const lower = this.vrm.humanoid.getNormalizedBoneNode(lowerBone);
    const hand = this.vrm.humanoid.getNormalizedBoneNode(handBone);
    if (!upper || !lower || !hand || !torsoForward) {
      return {
        ...emptyArmPostureStats(),
        upperArmLocalDeg: upper ? this.localEulerDeg(upperBone, upper.quaternion) : null,
        lowerArmLocalDeg: lower ? this.localEulerDeg(lowerBone, lower.quaternion) : null,
      };
    }

    upper.getWorldPosition(_armA);
    lower.getWorldPosition(_armB);
    hand.getWorldPosition(_armC);
    _upperDir.subVectors(_armB, _armA);
    _forearmDir.subVectors(_armC, _armB);
    if (_upperDir.lengthSq() < 1e-8 || _forearmDir.lengthSq() < 1e-8) {
      return {
        ...emptyArmPostureStats(),
        upperArmLocalDeg: this.localEulerDeg(upperBone, upper.quaternion),
        lowerArmLocalDeg: this.localEulerDeg(lowerBone, lower.quaternion),
      };
    }

    _upperDir.normalize();
    _forearmDir.normalize();
    return {
      available: true,
      upperArmLocalDeg: this.localEulerDeg(upperBone, upper.quaternion),
      lowerArmLocalDeg: this.localEulerDeg(lowerBone, lower.quaternion),
      upperArmForwardDeg: THREE.MathUtils.radToDeg(_upperDir.angleTo(torsoForward)),
      forearmForwardDeg: THREE.MathUtils.radToDeg(_forearmDir.angleTo(torsoForward)),
    };
  }

  private localEulerDeg(bone: VRMHumanBoneName, q: THREE.Quaternion): [number, number, number] {
    const c = this.constraints[bone];
    _euler.setFromQuaternion(q, c?.order ?? 'XYZ');
    return [
      THREE.MathUtils.radToDeg(_euler.x),
      THREE.MathUtils.radToDeg(_euler.y),
      THREE.MathUtils.radToDeg(_euler.z),
    ];
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  setProfile(profileId: BoneConstraintProfileId): void {
    if (this.profileId === profileId) return;
    this.profileId = profileId;
    this.constraints = mergeConstraints(this.overrides, this.profileId);
    this.rebuildCache();
    this.stats.clampedThisFrame = 0;
    this.stats.worstBone = null;
    this.stats.worstDelta = 0;
    this.updateArmPostureStats();
  }

  getStats(): ValidationStats {
    return this.stats;
  }

  /** Exposed for debug-panel "dump constraints" button. */
  getConstraints(): Partial<Record<VRMHumanBoneName, RotationConstraint>> {
    return this.constraints;
  }
}

export { DEFAULT_BONE_CONSTRAINTS };
