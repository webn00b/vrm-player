import * as THREE from 'three';
import type { PoseFrame } from '../pipeline/poseDetector';
import { LM } from './directPoseConfig';
import { solveArmTarget } from '../solvers/armTargetSolver';
import { applyTwoBoneChain } from '../solvers/twoBoneChainApplication';
import { recoverWristZ } from '../solvers/anatomicalDepth';
import { capArmScaleByCurrentSegments } from '../solvers/solverHeuristics';
import { QuaternionOneEuro } from '../trackers/oneEuroFilter';
import {
  getArmPoleRaw,
  getArmPoleSmoothed,
  getArmSolverDiagnostics,
  getElbowTarget,
  getWristTarget,
} from '../diagnostics/mocapDiagnostics';
import { fadeChainToRest, trySymmetryChainCopy } from './chainFallbacks';
import type { DirectPoseRig } from './directPoseRig';

/**
 * Two-bone arm IK (shoulder+elbow chain).
 *
 * Anchor: avatar shoulder midpoint.
 * Target = avatarMidShoulder + scaled(performerWrist − performerMidShoulder)
 *
 * X uses shoulder-width scale, Y/Z use arm-length scale. This keeps folded /
 * crossed-arm poses near the torso centerline even when the avatar has much
 * narrower shoulders than the performer.
 */
export class ArmIKApplier {
  private rig: DirectPoseRig;

  // Smoothed pole vectors per arm (world-frame). MediaPipe sometimes flips
  // the elbow when the limb is near-straight — smoothing keeps the pole
  // direction stable so the IK solver doesn't flip the joint.
  private _poles: Record<'left' | 'right', THREE.Vector3> = {
    left:  new THREE.Vector3(),
    right: new THREE.Vector3(),
  };

  // B4: post-IK quaternion smoothing for arm bones. IK's two-stage solver
  // amplifies landmark jitter into visible tremor on the bone output;
  // QuaternionOneEuro damps it without blurring fast motion. Per-bone
  // instances (4 total: L/R × upper/lower arm) so they don't interfere.
  private _quatFilters: Record<string, QuaternionOneEuro> = {
    leftUpperArm:  new QuaternionOneEuro(1.0, 0.05),
    leftLowerArm:  new QuaternionOneEuro(1.0, 0.05),
    rightUpperArm: new QuaternionOneEuro(1.0, 0.05),
    rightLowerArm: new QuaternionOneEuro(1.0, 0.05),
  };

  // Scratch allocations — reused each frame to avoid GC pressure
  private _v2 = new THREE.Vector3();
  private _v4 = new THREE.Vector3();
  private _v5 = new THREE.Vector3();
  private _v6 = new THREE.Vector3();
  private _v5b = new THREE.Vector3(); // backward-guard scratch (forward dir)
  private _q3 = new THREE.Quaternion(); // backward-guard scratch (hips world rot)
  private _qFade = new THREE.Quaternion();
  private _qFiltered = new THREE.Quaternion();

  constructor(rig: DirectPoseRig) {
    this.rig = rig;
  }

  apply(frame: PoseFrame, side: 'left' | 'right'): void {
    const { nodeCache, restLocalAxis, settings, boneTracker, debugTargets, now } = this.rig;
    const calib = this.rig.calibration;
    if (!calib || !calib.calibrated) return;

    const upperName = side + 'UpperArm';
    const lowerName = side + 'LowerArm';
    const upperNode = nodeCache.get(upperName);
    const lowerNode = nodeCache.get(lowerName);
    const upperRest = restLocalAxis.get(upperName);
    const lowerRest = restLocalAxis.get(lowerName);
    if (!upperNode || !lowerNode || !upperRest || !lowerRest || !upperNode.parent) return;

    // Mirror: character's LEFT arm ← performer's RIGHT landmarks (12/14/16).
    const lms = frame.worldLandmarks;
    const perfLs = lms[11];
    const perfRs = lms[12];
    const sIdx = side === 'left' ? 12 : 11;
    const eIdx = side === 'left' ? 14 : 13;
    const wIdx = side === 'left' ? 16 : 15;
    const ps = lms[sIdx], pe = lms[eIdx], pw = lms[wIdx];
    const chainVisible =
      !!perfLs && !!perfRs && !!ps && !!pe && !!pw &&
      settings.isVisible(perfLs) && settings.isVisible(perfRs) &&
      settings.isVisible(ps) && settings.isVisible(pe) && settings.isVisible(pw);
    if (!chainVisible) {
      if (trySymmetryChainCopy(this.rig, side, 'UpperArm', 'LowerArm')) return;
      fadeChainToRest(this.rig, upperName, lowerName, settings.bodyLerp, this._qFade);
      return;
    }

    // Avatar same-side shoulder = IK root. Target anchor is the midpoint of both shoulders.
    upperNode.parent!.updateWorldMatrix(true, false);
    upperNode.updateWorldMatrix(false, false);
    const shoulderWorld = upperNode.getWorldPosition(this._v5);
    const otherUpperNode = nodeCache.get((side === 'left' ? 'right' : 'left') + 'UpperArm');
    if (!otherUpperNode) return;
    otherUpperNode.updateWorldMatrix(false, false);
    const midAvatarShoulder = this._v6.copy(shoulderWorld).add(otherUpperNode.getWorldPosition(this._v4)).multiplyScalar(0.5);

    // B1: anatomical Z recovery for the wrist when foreshortening is detected.
    // MediaPipe's Z component on `pw` is the noisiest signal of the chain;
    // when the arm points along the camera axis the 2D shoulder→wrist length
    // is short relative to the performer's known arm length, and the model's
    // reported Z is often far from truth. We replace it with a sphere-
    // intersection solution constrained by performer arm length.
    //
    // Mirror mapping: side='left' uses performer's RIGHT arm length
    //                 (see MocapCalibration.armScale() for the same swap).
    const perfMeasurements = calib.performerMeasurements();
    const perfArmLen = side === 'left'
      ? perfMeasurements.rightArmMax
      : perfMeasurements.leftArmMax;
    let effectivePw = pw;
    // Z recovery rescues noisy webcam depth; trusted (lifted) input already
    // has the right Z and the heuristic would overwrite it.
    if (perfArmLen > 0.05 && !settings.trustInputGeometry) {
      const recovered = recoverWristZ({
        shoulder: { x: ps.x, y: ps.y, z: ps.z },
        wrist:    { x: pw.x, y: pw.y, z: pw.z },
        armLength: perfArmLen,
      });
      if (recovered.recovered) {
        // Preserve visibility / other fields, only overwrite Z.
        effectivePw = { ...pw, z: recovered.wrist.z };
      }
    }

    const rawArmScale = calib.armScale(side);
    let armScale = rawArmScale;
    const shoulderScale = calib.shoulderWidthRatio();
    const avatarArmLen = calib.upperArmLength(side) + calib.lowerArmLength(side);
    const perfUpperLen = Math.hypot(pe.x - ps.x, pe.y - ps.y, pe.z - ps.z);
    const perfLowerLen = Math.hypot(effectivePw.x - pe.x, effectivePw.y - pe.y, effectivePw.z - pe.z);
    const perfSegmentLen = perfUpperLen + perfLowerLen;
    let segmentScaleCap = Number.NaN;
    const armScaleCap = capArmScaleByCurrentSegments(rawArmScale, avatarArmLen, perfSegmentLen);
    armScale = armScaleCap.effectiveScale;
    if (armScaleCap.cap != null) segmentScaleCap = armScaleCap.cap;
    const lh = lms[LM.LEFT_HIP], rh = lms[LM.RIGHT_HIP];
    const chestNode =
      nodeCache.get('upperChest') ??
      nodeCache.get('chest') ??
      nodeCache.get('spine');
    const neckNode = nodeCache.get('neck');
    const headNode = nodeCache.get('head');
    chestNode?.updateWorldMatrix(true, false);
    neckNode?.updateWorldMatrix(true, false);
    headNode?.updateWorldMatrix(true, false);
    const chestWorld = chestNode ? chestNode.getWorldPosition(new THREE.Vector3()) : null;
    const neckWorld = neckNode ? neckNode.getWorldPosition(new THREE.Vector3()) : null;
    const headWorld = headNode ? headNode.getWorldPosition(new THREE.Vector3()) : null;
    const hasLeftHandDetected = frame.hands.some((hand) => hand.side === 'Left');
    const hasRightHandDetected = frame.hands.some((hand) => hand.side === 'Right');
    const targetSolve = solveArmTarget({
      side,
      mirrorX: settings.mirrorX,
      perfLeftShoulder: perfLs,
      perfRightShoulder: perfRs,
      perfShoulder: ps,
      perfElbow: pe,
      perfWrist: effectivePw,
      otherWrist: lms[side === 'left' ? 15 : 16] ?? null,
      perfLeftHip: lh ?? null,
      perfRightHip: rh ?? null,
      bodyLandmarks: frame.landmarks,
      faceLandmarks: frame.faceLandmarks,
      hand: frame.hands.find((h) => h.side === (side === 'left' ? 'Left' : 'Right')),
      hasBothHandsDetected: hasLeftHandDetected && hasRightHandDetected,
      shoulderWorld,
      midAvatarShoulder,
      chestWorld,
      neckWorld,
      headWorld,
      rawArmScale,
      armScale,
      shoulderScale,
      bodyScale: calib.bodyScale(),
      avatarArmLen,
      avatarShoulderWidth: calib.avatarShoulderWidth,
      armZAttenuation: settings.armZAttenuation,
      armPoleZ: settings.armPoleZ,
      trustInputGeometry: settings.trustInputGeometry,
    });
    const target = targetSolve.target;

    const armDiag = getArmSolverDiagnostics(debugTargets, side);
    Object.assign(armDiag, targetSolve.diagnostics);
    armDiag.segmentScaleCap = segmentScaleCap;

    getWristTarget(debugTargets, side).copy(target);
    debugTargets.hasArm = true;

    // Pole vector: keep the wrist target midpoint-based, but drive the elbow
    // bend from the performer's same-side shoulder→elbow direction. This is a
    // much stabler bend hint than a midpoint-anchored elbow point when the hand
    // is close to the chest and the wrist target lies almost on the shoulder→hand
    // line.
    const elbowTarget = targetSolve.elbowTarget;
    getElbowTarget(debugTargets, side).copy(elbowTarget);
    this._v2.copy(targetSolve.rawPoleDirection);
    getArmPoleRaw(debugTargets, side).copy(this._v2);
    const smoothed = this._poles[side];
    if (smoothed.lengthSq() < 1e-6) smoothed.copy(this._v2);
    else smoothed.lerp(this._v2, settings.poleAlpha);
    getArmPoleSmoothed(debugTargets, side).copy(smoothed);

    // Backward-reach guard: depth ambiguity (arm pointing toward/away from
    // camera) can fling the wrist far behind the body. Clamp how far the
    // target sits behind the shoulder's coronal plane to armBackLimitDeg
    // (90 = off). User-tunable per clip; defends talk content where the hand
    // rarely goes far back while preserving genuine moderate back-reach.
    if (settings.armBackLimitDeg < 90) {
      const hips = nodeCache.get('hips');
      if (hips) {
        hips.getWorldQuaternion(this._q3);
        this._v5b.set(0, 0, -1).applyQuaternion(this._q3); // VRM faces -Z
        this._v5b.y = 0;
        if (this._v5b.lengthSq() > 1e-6) {
          this._v5b.normalize();
          this._v4.copy(target).sub(shoulderWorld);
          const back = -this._v4.dot(this._v5b); // >0 = behind the shoulder
          if (back > 0) {
            const maxBack = Math.sin(settings.armBackLimitDeg * Math.PI / 180) * this._v4.length();
            if (back > maxBack) {
              this._v4.addScaledVector(this._v5b, back - maxBack); // pull forward
              target.copy(shoulderWorld).add(this._v4);
            }
          }
        }
      }
    }

    applyTwoBoneChain({
      rootWorld: shoulderWorld,
      targetWorld: target,
      poleDirection: smoothed,
      upperLength: calib.upperArmLength(side),
      lowerLength: calib.lowerArmLength(side),
      upperNode,
      lowerNode,
      upperRestAxis: upperRest,
      lowerRestAxis: lowerRest,
      lerp: settings.bodyLerp,
    });
    // B4: damp residual IK jitter via QuaternionOneEuro on the post-slerp
    // bone quaternion. Adaptive: heavy smoothing at rest, light during fast
    // motion. Time in seconds for the filter's frequency math.
    const tSec = now * 0.001;
    const upperFilter = this._quatFilters[upperName];
    const lowerFilter = this._quatFilters[lowerName];
    if (upperFilter) {
      upperFilter.filter(upperNode.quaternion, tSec, this._qFiltered);
      upperNode.quaternion.copy(this._qFiltered);
      upperNode.updateWorldMatrix(false, true);
    }
    if (lowerFilter) {
      lowerFilter.filter(lowerNode.quaternion, tSec, this._qFiltered);
      lowerNode.quaternion.copy(this._qFiltered);
      lowerNode.updateWorldMatrix(false, true);
    }
    // State machine: record the (filtered) local quaternions so a subsequent
    // visibility-loss frame holds the smoothed pose instead of identity.
    boneTracker.markObserved(upperName, upperNode.quaternion, now);
    boneTracker.markObserved(lowerName, lowerNode.quaternion, now);
  }
}
