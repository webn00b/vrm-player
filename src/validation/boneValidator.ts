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
}

// Reusable scratch — the validator is called every frame on every bone, so we
// avoid allocating Euler / Quaternion objects per call.
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

export class BoneValidator {
  private vrm: VRM;
  private constraints: Partial<Record<VRMHumanBoneName, RotationConstraint>>;
  private nodeCache = new Map<VRMHumanBoneName, THREE.Object3D>();
  private stats: ValidationStats = { clampedThisFrame: 0, worstBone: null, worstDelta: 0 };

  enabled = true;

  constructor(vrm: VRM, overrides?: Partial<Record<VRMHumanBoneName, RotationConstraint>>) {
    this.vrm = vrm;
    this.constraints = mergeConstraints(overrides);
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
    return this.stats;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
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
