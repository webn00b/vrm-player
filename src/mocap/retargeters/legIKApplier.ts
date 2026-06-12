import * as THREE from 'three';
import type { PoseFrame } from '../pipeline/poseDetector';
import { solveLegTarget } from '../solvers/legTargetSolver';
import { applyTwoBoneChain } from '../solvers/twoBoneChainApplication';
import { getAnkleTarget } from '../diagnostics/mocapDiagnostics';
import { fadeChainToRest, trySymmetryChainCopy } from './chainFallbacks';
import type { DirectPoseRig } from './directPoseRig';

/**
 * Two-bone leg IK (hip+knee chain). Targets the performer's ankle landmark
 * scaled to avatar space via the hip-width body scale. Pole = hip→knee
 * direction (smoothed). Foot rotation is not addressed here — the foot
 * bone stays at rest orientation (angle-driven foot-IK is out of scope).
 *
 * Also owns the foot-lock state machine and the avatar's rest-pose ground
 * level (clamping IK targets to >= groundY prevents feet sinking into the floor).
 */
export class LegIKApplier {
  private rig: DirectPoseRig;

  // World Y of the avatar's ankle bones at rest pose (≈ floor level for ankles).
  private _groundY = 0;

  private _footLocked:    Record<'left' | 'right', boolean>       = { left: false, right: false };
  private _footLockedPos: Record<'left' | 'right', THREE.Vector3> = {
    left: new THREE.Vector3(), right: new THREE.Vector3(),
  };
  private _footStableFrames:   Record<'left' | 'right', number> = { left: 0, right: 0 };
  private _footAirborneFrames: Record<'left' | 'right', number> = { left: 0, right: 0 };
  private _prevAnkleTarget: Record<'left' | 'right', THREE.Vector3> = {
    left:  new THREE.Vector3(Infinity, Infinity, Infinity),
    right: new THREE.Vector3(Infinity, Infinity, Infinity),
  };

  // Smoothed pole vectors per leg (world-frame) — same flip-guard as arms.
  private _poles: Record<'left' | 'right', THREE.Vector3> = {
    left:  new THREE.Vector3(),
    right: new THREE.Vector3(),
  };

  // Scratch allocations — reused each frame to avoid GC pressure
  private _v5 = new THREE.Vector3();
  private _q3 = new THREE.Quaternion();
  private _qFade = new THREE.Quaternion();

  constructor(rig: DirectPoseRig) {
    this.rig = rig;
    this._captureGroundY();
  }

  /** Avatar's rest-pose ankle height above the scene floor (metres). Read-only debug info. */
  get groundY(): number { return this._groundY; }

  /** Release any locked feet and reset velocity history. Call on recalibrate / stop. */
  resetFootLock(): void {
    this._footLocked.left  = false;
    this._footLocked.right = false;
    this._prevAnkleTarget.left.set(Infinity, Infinity, Infinity);
    this._prevAnkleTarget.right.set(Infinity, Infinity, Infinity);
    this._footStableFrames.left = this._footStableFrames.right = 0;
    this._footAirborneFrames.left = this._footAirborneFrames.right = 0;
  }

  isFootLocked(side: 'left' | 'right'): boolean { return this._footLocked[side]; }

  private _captureGroundY(): void {
    this.rig.vrm.scene.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    let minY = Infinity;
    for (const boneName of ['leftFoot', 'rightFoot'] as const) {
      const node = this.rig.nodeCache.get(boneName);
      if (node) { node.getWorldPosition(pos); if (pos.y < minY) minY = pos.y; }
    }
    this._groundY = minY < Infinity ? minY : 0;
  }

  apply(frame: PoseFrame, side: 'left' | 'right'): void {
    const { nodeCache, restLocalAxis, settings, boneTracker, debugTargets, now } = this.rig;
    const calib = this.rig.calibration;
    if (!calib || !calib.calibrated) return;

    const upperName = side + 'UpperLeg';
    const lowerName = side + 'LowerLeg';
    const upperNode = nodeCache.get(upperName);
    const lowerNode = nodeCache.get(lowerName);
    const upperRest = restLocalAxis.get(upperName);
    const lowerRest = restLocalAxis.get(lowerName);
    if (!upperNode || !lowerNode || !upperRest || !lowerRest || !upperNode.parent) return;

    // Mirror: character's LEFT leg ← performer's RIGHT side (24/26/28).
    const lms = frame.worldLandmarks;
    const hIdx = side === 'left' ? 24 : 23;  // same-side performer hip
    const kIdx = side === 'left' ? 26 : 25;
    const aIdx = side === 'left' ? 28 : 27;
    const ph = lms[hIdx], pk = lms[kIdx], pa = lms[aIdx];
    const chainVisible =
      !!ph && !!pk && !!pa &&
      settings.isVisible(ph) && settings.isVisible(pk) && settings.isVisible(pa);
    if (!chainVisible) {
      if (trySymmetryChainCopy(this.rig, side, 'UpperLeg', 'LowerLeg')) return;
      fadeChainToRest(this.rig, upperName, lowerName, settings.bodyLerp, this._qFade);
      return;
    }

    // Avatar same-side hip = IK root and target anchor.
    upperNode.parent!.updateWorldMatrix(true, false);
    upperNode.updateWorldMatrix(false, false);
    const hipWorld = upperNode.getWorldPosition(this._v5);

    const legSolve = solveLegTarget({
      mirrorX: settings.mirrorX,
      hip: ph,
      knee: pk,
      ankle: pa,
      hipWorld,
      legScale: calib.legScale(),
      legSpreadX: settings.legSpreadX,
      groundY: this._groundY,
      poleAlpha: settings.poleAlpha,
      footLockEnabled: settings.footLockEnabled,
      footVelocityLockThreshold: settings.footVelocityLockThreshold,
      footVelocityUnlockThreshold: settings.footVelocityUnlockThreshold,
      footLiftThreshold: settings.footLiftThreshold,
      state: {
        locked: this._footLocked[side],
        lockedPosition: this._footLockedPos[side],
        prevTarget: this._prevAnkleTarget[side],
        smoothedPole: this._poles[side],
        stableFrames: this._footStableFrames[side],
        airborneFrames: this._footAirborneFrames[side],
      },
    });
    const target = legSolve.target;
    this._footLocked[side] = legSolve.locked;
    this._footStableFrames[side] = legSolve.stableFrames;
    this._footAirborneFrames[side] = legSolve.airborneFrames;

    getAnkleTarget(debugTargets, side).copy(target);
    debugTargets[side === 'left' ? 'leftFootLocked' : 'rightFootLocked'] = this._footLocked[side];
    debugTargets.hasLeg = true;

    applyTwoBoneChain({
      rootWorld: hipWorld,
      targetWorld: target,
      poleDirection: legSolve.poleDirection,
      upperLength: calib.upperLegLength(side),
      lowerLength: calib.lowerLegLength(side),
      upperNode,
      lowerNode,
      upperRestAxis: upperRest,
      lowerRestAxis: lowerRest,
      lerp: settings.bodyLerp,
    });
    boneTracker.markObserved(upperName, upperNode.quaternion, now);
    boneTracker.markObserved(lowerName, lowerNode.quaternion, now);
  }

  /** Calibration not leg-ready yet — ease the leg chain back to rest pose. */
  relaxToRest(side: 'left' | 'right'): void {
    const { nodeCache, settings } = this.rig;
    const upperNode = nodeCache.get(`${side}UpperLeg`);
    const lowerNode = nodeCache.get(`${side}LowerLeg`);
    if (!upperNode || !lowerNode) return;

    this._q3.identity();
    if (settings.bodyLerp >= 1) upperNode.quaternion.copy(this._q3);
    else                        upperNode.quaternion.slerp(this._q3, settings.bodyLerp);
    upperNode.updateWorldMatrix(false, true);

    this._q3.identity();
    if (settings.bodyLerp >= 1) lowerNode.quaternion.copy(this._q3);
    else                        lowerNode.quaternion.slerp(this._q3, settings.bodyLerp);
    lowerNode.updateWorldMatrix(false, true);

    this._footLocked[side] = false;
    this._poles[side].set(0, 0, 0);
  }
}
