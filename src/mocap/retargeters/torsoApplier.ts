import * as THREE from 'three';
import type { PoseFrame } from '../pipeline/poseDetector';
import { LM } from './directPoseConfig';
import { solveShoulderTarget } from '../solvers/shoulderRetarget';
import {
  solveHipPositionTarget,
  solveHipsOrientationTarget,
  solveSpineTarget,
} from '../solvers/torsoTargetSolver';
import type { DirectPoseRig } from './directPoseRig';

/**
 * Hips / spine / head / shoulders retargeting. Torso runs first each frame —
 * its rotations propagate to limbs via parent world matrices.
 */
// Hip-height smoothing/latch tuning (see _hipHeightEma field docs).
// EMA alpha 0.25 ≈ 3-frame lag at 30 fps — imperceptible, kills jitter.
const HIP_HEIGHT_EMA_ALPHA = 0.25;
// Enter standing above 94% of the leg chain, leave below 92% (hysteresis),
// pin at 98.5% — visually straight without singular full extension.
const STAND_ENTER_RATIO = 0.94;
const STAND_EXIT_RATIO = 0.92;
const STAND_HEIGHT_RATIO = 0.985;

export class TorsoApplier {
  private rig: DirectPoseRig;

  // Default hips world-rotation at load time. The VRM often ships with a
  // non-identity hips orientation (e.g. 180° around Y) to face the camera.
  // We preserve it as a baseline so that at T-pose our code produces the
  // character's natural facing direction instead of forcibly re-facing to +Z.
  private _hipsBaseWorld = new THREE.Quaternion();

  // Avatar's shoulder-line direction in hips-local frame, projected to XZ.
  // Used as the reference "zero-twist" vector in applySpine when hips
  // landmarks aren't visible enough to give a live hip axis (e.g. upper-body-
  // only recordings where only shoulders/head are in frame).
  private _avatarShoulderRestLocal = new THREE.Vector3(1, 0, 0);

  // Hip position tracking: performer hip centre delta → avatar hips.position.
  // The baseline is stored in NORMALIZED image units (see applyHips) and
  // converted to metres with the calibration's live metersPerNorm() ratio, so
  // a drifting scale estimate can't accumulate into a position offset.
  private _hipPerfBaseline:      THREE.Vector3 | null = null;
  private _hipAvatarBaseline:    THREE.Vector3 = new THREE.Vector3();
  // Avatar rest ankle height (world Y) — reference floor for the
  // legs-derived absolute hip height. NaN until captured.
  private _groundWorldY = Number.NaN;
  // Smoothed hip-above-ankle height + standing latch. Raw per-frame height
  // jitters (the lowest-ankle max flips between legs, ankle depth wobbles)
  // and feeds straight into knee bend — visible as the avatar "breathing"
  // through its knees while the performer stands still.
  private _hipHeightEma = 0;
  private _standing = false;
  private _torsoForwardBaseline: number | null = null;
  private _headYawBaseline:   number | null = null;
  private _headPitchBaseline: number | null = null;
  private _headRollBaseline:  number | null = null;

  private _headRestLocal = new THREE.Quaternion();
  private _neckRestLocal = new THREE.Quaternion();

  // Scratch allocations — reused each frame to avoid GC pressure
  private _v3 = new THREE.Vector3();
  private _q1 = new THREE.Quaternion();
  private _q2 = new THREE.Quaternion();
  private _qFade = new THREE.Quaternion();

  constructor(rig: DirectPoseRig) {
    this.rig = rig;
    this._captureHipsBaseline();
    this._captureHeadBaseline();
  }

  /** The avatar's hips world quaternion at rest (before any mocap). */
  get hipsBaseWorld(): THREE.Quaternion { return this._hipsBaseWorld; }

  /** Reset baselines — next frame re-anchors to current performer position. */
  resetBaselines(): void {
    this._hipHeightEma = 0;
    this._standing = false;
    this._hipPerfBaseline = null;
    this._torsoForwardBaseline = null;
    this._headYawBaseline = null;
    this._headPitchBaseline = null;
    this._headRollBaseline = null;
  }

  private _captureHipsBaseline(): void {
    const hipsNode = this.rig.nodeCache.get('hips');
    if (!hipsNode) return;
    // Make sure the whole VRM world matrix chain is fresh before reading
    this.rig.vrm.scene.updateMatrixWorld(true);
    hipsNode.getWorldQuaternion(this._hipsBaseWorld);

    // Rest ankle height — floor reference for the legs-derived hip height.
    const pos = new THREE.Vector3();
    let minY = Infinity;
    for (const name of ['leftFoot', 'rightFoot'] as const) {
      const node = this.rig.nodeCache.get(name);
      if (node) { node.getWorldPosition(pos); if (pos.y < minY) minY = pos.y; }
    }
    if (minY < Infinity) this._groundWorldY = minY;

    // Capture the avatar's shoulder line in hips-local (XZ projected). Used
    // as a twist reference when performer hips aren't visible.
    const lShoulder = this.rig.nodeCache.get('leftShoulder')
                   ?? this.rig.nodeCache.get('leftUpperArm');
    const rShoulder = this.rig.nodeCache.get('rightShoulder')
                   ?? this.rig.nodeCache.get('rightUpperArm');
    if (lShoulder && rShoulder) {
      const lPos = new THREE.Vector3();
      const rPos = new THREE.Vector3();
      lShoulder.getWorldPosition(lPos);
      rShoulder.getWorldPosition(rPos);
      const dir = new THREE.Vector3().subVectors(rPos, lPos);
      dir.applyQuaternion(this._q1.copy(this._hipsBaseWorld).invert());
      dir.y = 0;
      if (dir.lengthSq() > 1e-6) this._avatarShoulderRestLocal.copy(dir.normalize());
    }
  }

  private _captureHeadBaseline(): void {
    this._headRestLocal.copy(this.rig.nodeCache.get('head')?.quaternion ?? new THREE.Quaternion());
    this._neckRestLocal.copy(this.rig.nodeCache.get('neck')?.quaternion ?? new THREE.Quaternion());
  }

  applyShoulders(frame: PoseFrame): void {
    const { nodeCache, restLocalAxis, settings, boneTracker, now } = this.rig;
    const rad = settings.shoulderSpreadDeg * (Math.PI / 180);
    const ls = frame.worldLandmarks[LM.LEFT_SHOULDER];
    const rs = frame.worldLandmarks[LM.RIGHT_SHOULDER];
    const shouldersVisible = !!ls && !!rs && settings.isVisible(ls) && settings.isVisible(rs);

    const applySide = (
      nodeName: 'leftShoulder' | 'rightShoulder',
      performerShoulder: { x: number; y: number; z: number } | undefined,
      spreadSign: number,
    ): void => {
      const node = nodeCache.get(nodeName);
      const restAxis = restLocalAxis.get(nodeName);
      if (!node || !restAxis || !node.parent) return;
      if (!shouldersVisible) {
        // A1: fade clavicle toward rest. Shoulder bones had no slerp pre-fade
        // (direct copy of solver output), so we copy fade target directly.
        const fade = boneTracker.fade(nodeName, now, this._qFade);
        node.quaternion.copy(fade);
        node.updateWorldMatrix(false, true);
        return;
      }
      node.parent.updateWorldMatrix(true, false);
      node.parent.getWorldQuaternion(this._q1);
      const target = solveShoulderTarget({
        mirrorX: settings.mirrorX,
        restAxis,
        parentWorldQuaternion: this._q1,
        leftShoulder: ls!,
        rightShoulder: rs!,
        performerShoulder,
        spreadRadians: rad,
        spreadSign,
      });
      node.quaternion.copy(target);
      node.updateWorldMatrix(false, true);
      boneTracker.markObserved(nodeName, node.quaternion, now);
    };

    // Mirror: avatar LEFT clavicle follows performer's RIGHT shoulder, and vice versa.
    applySide('leftShoulder', rs, -1);
    applySide('rightShoulder', ls, 1);
  }

  /**
   * Compute hips world orientation from the torso quadrilateral (shoulder + hip lines).
   *   X (right→left in character frame) = direction across hips
   *   Y (up along spine)                 = midHip → midShoulder
   *   Z (forward from character)         = cross(X, Y)
   *
   * After mirror-swap: person's RIGHT hip maps to character's LEFT hip, so the
   * character-space "right→left" direction = (personRightHip - personLeftHip)
   * fed through the mirror-aware MediaPipe→VRM conversion.
   */
  applyHips(frame: PoseFrame): void {
    const { nodeCache, settings, boneTracker, now, calibration } = this.rig;
    const hipsNode = nodeCache.get('hips');
    if (!hipsNode || !hipsNode.parent) return;

    const lms = frame.worldLandmarks;
    const lh = lms[LM.LEFT_HIP], rh = lms[LM.RIGHT_HIP];
    const ls = lms[LM.LEFT_SHOULDER], rs = lms[LM.RIGHT_SHOULDER];
    // Need all four torso landmarks to be visible for a reliable basis.
    // A1: previously early-returned (hips frozen indefinitely); now fade to rest.
    const torsoVisible =
      !!lh && !!rh && !!ls && !!rs &&
      settings.isVisible(lh) && settings.isVisible(rh) &&
      settings.isVisible(ls) && settings.isVisible(rs);
    if (!torsoVisible) {
      const fadeTarget = boneTracker.fade('hips', now, this._qFade);
      if (settings.spineLerp >= 1) hipsNode.quaternion.copy(fadeTarget);
      else                         hipsNode.quaternion.slerp(fadeTarget, settings.spineLerp);
      hipsNode.updateWorldMatrix(false, true);
      return;
    }
    hipsNode.parent.updateWorldMatrix(true, false);
    hipsNode.parent.getWorldQuaternion(this._q2);
    const hipsTarget = solveHipsOrientationTarget({
      mirrorX: settings.mirrorX,
      leftHip: lh,
      rightHip: rh,
      leftShoulder: ls,
      rightShoulder: rs,
      hipsBaseWorld: this._hipsBaseWorld,
      hipsParentWorldQuaternion: this._q2,
      torsoAxisMaxDivergenceDeg: settings.torsoAxisMaxDivergenceDeg,
      torsoDepthDamping: settings.torsoDepthDamping,
    });
    if (!hipsTarget) return;

    if (settings.spineLerp >= 1) hipsNode.quaternion.copy(hipsTarget);
    else                         hipsNode.quaternion.slerp(hipsTarget, settings.spineLerp);
    hipsNode.updateWorldMatrix(false, true);
    boneTracker.markObserved('hips', hipsNode.quaternion, now);

    // ── Hip world position ──────────────────────────────────────────────────
    // MediaPipe WORLD landmarks are hip-centred: the hip midpoint is ~(0,0,0)
    // in every frame, so they cannot carry global translation (using them here
    // froze the BVH root in place). The NORMALIZED (image-space) landmarks do
    // move; convert image units to metres with the calibrated world/norm
    // hip-width ratio. Note normalized z is also hip-rooted, so the midpoint z
    // stays ~0 — depth translation is not recovered yet.
    if (settings.hipPositionEnabled) {
      const nlh = frame.landmarks[LM.LEFT_HIP];
      const nrh = frame.landmarks[LM.RIGHT_HIP];
      const metersPerNorm = calibration?.metersPerNorm() ?? 0;
      if (!nlh || !nrh || metersPerNorm <= 0) return;

      const cx = (nlh.x + nrh.x) * 0.5;
      const cy = (nlh.y + nrh.y) * 0.5;
      const cz = (nlh.z + nrh.z) * 0.5;

      if (!this._hipPerfBaseline) {
        this._hipPerfBaseline = new THREE.Vector3(cx, cy, cz);
        hipsNode.getWorldPosition(this._hipAvatarBaseline);
      }

      // Hip centre translation should follow whole-body/leg scale, not torso
      // width scale. In full-body shots the avatar can have much shorter
      // shoulders/hips but near-1:1 leg length; using bodyScale here makes the
      // pelvis move too little and forces leg IK to over-stretch.
      // Delta is computed in normalized units inside the solver, then scaled
      // to metres by the CURRENT ratio — so a drifting metersPerNorm estimate
      // rescales the whole offset instead of accumulating error.
      const scale = (calibration?.legScale() ?? 1) * metersPerNorm;

      // Vertical: the image-space Y delta underestimates crouch depth (a deep
      // squat barely lowers the pelvis on screen), and a too-high pelvis with
      // ground-clamped ankle targets means leg IK can never bend the knees.
      // Hip height above the lowest ankle in WORLD landmark space is metric
      // and pose-true (especially when lifted) — use it as an absolute Y.
      let absoluteHeight: { hipHeightM: number; legScale: number; groundWorldY: number } | undefined;
      if (settings.hipHeightFromLegs && Number.isFinite(this._groundWorldY)) {
        const la = lms[LM.LEFT_ANKLE], ra = lms[LM.RIGHT_ANKLE];
        const anklesVisible =
          !!la && !!ra && settings.isVisible(la) && settings.isVisible(ra);
        if (anklesVisible) {
          const hipY = (lh.y + rh.y) * 0.5;
          // MediaPipe world y points DOWN: lowest ankle has the LARGEST y.
          const hipHeightRaw = Math.max(la.y, ra.y) - hipY;
          if (hipHeightRaw > 0.2) {
            // EMA kills per-frame jitter; the standing latch pins an
            // almost-straight leg to exactly straight (with hysteresis) so
            // measurement noise can't pulse the knees while standing.
            this._hipHeightEma = this._hipHeightEma <= 0
              ? hipHeightRaw
              : this._hipHeightEma * (1 - HIP_HEIGHT_EMA_ALPHA) + hipHeightRaw * HIP_HEIGHT_EMA_ALPHA;
            let hipHeightM = this._hipHeightEma;
            const perfChain = calibration?.performerLegChainLength() ?? 0;
            if (perfChain > 1e-3) {
              const ratio = hipHeightM / perfChain;
              if (this._standing ? ratio > STAND_EXIT_RATIO : ratio > STAND_ENTER_RATIO) {
                this._standing = true;
                hipHeightM = perfChain * STAND_HEIGHT_RATIO;
              } else {
                this._standing = false;
              }
            }
            absoluteHeight = {
              hipHeightM,
              legScale: calibration?.legScale() ?? 1,
              groundWorldY: this._groundWorldY,
            };
          }
        }
      }

      hipsNode.parent!.getWorldPosition(this._v3);
      hipsNode.parent!.getWorldQuaternion(this._q1);
      const positionTarget = solveHipPositionTarget({
        mirrorX: settings.mirrorX,
        depthScale: settings.depthScale,
        perfCenterX: cx,
        perfCenterY: cy,
        perfCenterZ: cz,
        perfBaseline: this._hipPerfBaseline,
        avatarBaselineWorld: this._hipAvatarBaseline,
        hipsParentWorldPosition: this._v3,
        hipsParentWorldQuaternion: this._q1,
        scale,
        absoluteHeight,
      });

      if (settings.hipPositionLerp >= 1) hipsNode.position.copy(positionTarget);
      else                               hipsNode.position.lerp(positionTarget, settings.hipPositionLerp);
      hipsNode.updateWorldMatrix(false, true);
    }
  }

  applyHead(frame: PoseFrame): void {
    const { nodeCache, settings } = this.rig;
    const headNode = nodeCache.get('head');
    const neckNode = nodeCache.get('neck');
    if (!headNode && !neckNode) return;

    const lms = frame.worldLandmarks;
    const nose = lms[LM.NOSE];
    const leftShoulder = lms[LM.LEFT_SHOULDER];
    const rightShoulder = lms[LM.RIGHT_SHOULDER];
    if (
      !nose || !leftShoulder || !rightShoulder ||
      !settings.isVisible(nose) || !settings.isVisible(leftShoulder) || !settings.isVisible(rightShoulder)
    ) return;

    const shoulderSpan = Math.max(0.05, Math.hypot(
      leftShoulder.x - rightShoulder.x,
      leftShoulder.y - rightShoulder.y,
      leftShoulder.z - rightShoulder.z,
    ));
    const shoulderMidX = (leftShoulder.x + rightShoulder.x) * 0.5;
    const shoulderMidY = (leftShoulder.y + rightShoulder.y) * 0.5;

    const leftEar = lms[LM.LEFT_EAR];
    const rightEar = lms[LM.RIGHT_EAR];
    const earsVisible =
      !!leftEar && !!rightEar && settings.isVisible(leftEar) && settings.isVisible(rightEar);
    const earSpan = earsVisible
      ? Math.max(0.03, Math.hypot(
          leftEar!.x - rightEar!.x,
          leftEar!.y - rightEar!.y,
          leftEar!.z - rightEar!.z,
        ))
      : shoulderSpan * 0.45;
    const faceMidX = earsVisible ? (leftEar!.x + rightEar!.x) * 0.5 : shoulderMidX;

    const yawRaw = (nose.x - faceMidX) / earSpan;
    const pitchRaw = (nose.y - shoulderMidY) / shoulderSpan;
    const rollRaw = earsVisible ? (leftEar!.y - rightEar!.y) / earSpan : 0;
    if (this._headYawBaseline == null) {
      this._headYawBaseline = yawRaw;
      this._headPitchBaseline = pitchRaw;
      this._headRollBaseline = rollRaw;
    }

    const mirror = settings.mirrorX ? -1 : 1;
    const yaw = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(
      (yawRaw - this._headYawBaseline) * mirror * 35,
      -22,
      22,
    ));
    const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(
      -(pitchRaw - (this._headPitchBaseline ?? pitchRaw)) * 28,
      -14,
      14,
    ));
    const roll = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(
      (rollRaw - (this._headRollBaseline ?? rollRaw)) * mirror * 24,
      -12,
      12,
    ));

    const applyLocal = (
      node: THREE.Object3D | undefined,
      rest: THREE.Quaternion,
      pitchWeight: number,
      yawWeight: number,
      rollWeight: number,
    ): void => {
      if (!node) return;
      this._q1.setFromEuler(new THREE.Euler(
        pitch * pitchWeight,
        yaw * yawWeight,
        roll * rollWeight,
        'XYZ',
      ));
      this._q1.premultiply(rest).normalize();
      if (settings.headLerp >= 1) node.quaternion.copy(this._q1);
      else                        node.quaternion.slerp(this._q1, settings.headLerp);
      node.updateWorldMatrix(false, true);
    };

    applyLocal(neckNode, this._neckRestLocal, 0.3, 0.3, 0.2);
    applyLocal(headNode, this._headRestLocal, 0.7, 0.7, 0.5);
  }

  /**
   * Spine / chest twist — the yaw between shoulder line and hip line,
   * computed in HIPS LOCAL frame. Both axes are transformed via the
   * current hips world-quaternion-inverse so the twist is independent
   * of the VRM's default facing baseline (e.g. 180° around Y).
   */
  applySpine(frame: PoseFrame): void {
    const { nodeCache, settings, boneTracker, now, debugTargets } = this.rig;
    const spineNode = nodeCache.get('spine');
    const chestNode = nodeCache.get('chest') ?? nodeCache.get('upperChest');
    const hipsNode  = nodeCache.get('hips');
    if (!hipsNode || (!spineNode && !chestNode)) return;

    const lms = frame.worldLandmarks;
    const lh = lms[LM.LEFT_HIP], rh = lms[LM.RIGHT_HIP];
    const ls = lms[LM.LEFT_SHOULDER], rs = lms[LM.RIGHT_SHOULDER];
    const shouldersVisible = !!ls && !!rs && settings.isVisible(ls) && settings.isVisible(rs);
    if (!shouldersVisible) {
      // A1: fade spine + chest toward rest instead of leaving them frozen.
      const fadeNode = (node: THREE.Object3D | undefined, trackName: string): void => {
        if (!node) return;
        const fade = boneTracker.fade(trackName, now, this._qFade);
        if (settings.spineLerp >= 1) node.quaternion.copy(fade);
        else                         node.quaternion.slerp(fade, settings.spineLerp);
        node.updateWorldMatrix(false, true);
      };
      fadeNode(spineNode, 'spine');
      fadeNode(chestNode, 'chest');
      return;
    }

    const hipsVisible = !!lh && !!rh && settings.isVisible(lh) && settings.isVisible(rh);
    hipsNode.updateWorldMatrix(true, false);
    const count = (spineNode ? 1 : 0) + (chestNode ? 1 : 0);
    hipsNode.getWorldQuaternion(this._q2);
    const spineTarget = solveSpineTarget({
      mirrorX: settings.mirrorX,
      leftShoulder: ls,
      rightShoulder: rs,
      leftHip: hipsVisible ? lh! : null,
      rightHip: hipsVisible ? rh! : null,
      hipsWorldQuaternion: this._q2,
      avatarShoulderRestLocal: this._avatarShoulderRestLocal,
      torsoAxisMaxDivergenceDeg: settings.torsoAxisMaxDivergenceDeg,
      torsoForwardBaseline: this._torsoForwardBaseline,
      forwardBendScale: settings.forwardBendScale,
      torsoDepthDamping: settings.torsoDepthDamping,
      lateralBendScale: settings.lateralBendScale,
      lateralBendScaleMax: settings.lateralBendScaleMax,
      spineNodeCount: count,
    });
    if (!spineTarget) return;

    this._torsoForwardBaseline = spineTarget.nextForwardBaseline;
    Object.assign(debugTargets.torsoSolver, spineTarget.diagnostics);
    const halfTwist = spineTarget.halfTwist;

    const applyTwist = (node: THREE.Object3D, trackName: string): void => {
      if (settings.spineLerp >= 1) node.quaternion.copy(halfTwist);
      else                         node.quaternion.slerp(halfTwist, settings.spineLerp);
      node.updateWorldMatrix(false, true);
      boneTracker.markObserved(trackName, node.quaternion, now);
    };
    if (spineNode) applyTwist(spineNode, 'spine');
    if (chestNode) applyTwist(chestNode, 'chest');
  }
}
