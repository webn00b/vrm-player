import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { PoseDetector, type PoseModelQuality, type PoseFrame } from './poseDetector';
import { DirectPoseApplier } from './directPoseApplier';
import { FaceApplier } from './faceApplier';
import { BvhRecorder, downloadBvh } from './bvhRecorder';
import { MocapCalibration, type CalibrationStatus } from './mocapCalibration';
import { getCachedHumanoidRestAxes } from '../humanoidRestPose';
import { captureSnapshot, type PoseSnapshot } from './bvhRoundtripVerifier';

export type MocapState = 'off' | 'live' | 'recording';

/**
 * Orchestrates the webcam → pose → VRM → BVH pipeline.
 *
 *   off       – camera closed, VRM unaffected
 *   live      – camera on, pose applied to VRM each frame, no recording
 *   recording – live + every frame written to BvhRecorder
 */
export class MocapController {
  private detector: PoseDetector;
  private applier: DirectPoseApplier;
  private faceApplier: FaceApplier;
  private liveRecorder: BvhRecorder;
  private grabRecorder: BvhRecorder;
  private _calibration: MocapCalibration;

  private _state: MocapState = 'off';
  private _recordingIndex = 0;
  private _poseExportIndex = 0;
  private _fileCaptureActive = false;

  // Latest detected frame — applied each render tick via applyLatestFrame()
  // so mocap overlays on top of the BVH mixer output rather than fighting it.
  private _latestFrame: PoseFrame | null = null;
  // Set to false each time a new frame arrives; set to true after we record it.
  // Prevents double-recording if the render loop runs faster than detection.
  private _frameRecorded = false;

  onStateChange:          ((state: MocapState) => void) | null = null;
  onError:                ((err: Error)         => void) | null = null;
  onBvhReady:             ((bvh: string, name: string) => void) | null = null;
  onCalibrationChange:    ((s: CalibrationStatus) => void) | null = null;

  // ── Round-trip verification (expected-side capture) ─────────────────────────
  // When non-null, every time the live recorder accepts a new frame we also
  // snapshot the full normalized-bone state. Pairs with a deterministic replay
  // in bvhRoundtripVerifier to detect record↔playback divergence.
  private _verifySnapshots: PoseSnapshot[] | null = null;
  private _verifyLastFrameCount = 0;

  private _vrm: VRM;

  constructor(vrm: VRM, videoEl: HTMLVideoElement) {
    this._vrm         = vrm;
    this.detector     = new PoseDetector(videoEl);
    this._calibration = new MocapCalibration(vrm);
    this.applier      = new DirectPoseApplier(vrm, this._calibration);
    this.faceApplier  = new FaceApplier(vrm);
    this.liveRecorder = this._createRecorder();
    this.grabRecorder = this._createRecorder();

    this._calibration.onStatusChange = (s) => this.onCalibrationChange?.(s);

    this.detector.onFrame = (frame) => {
      // Accumulate calibration data every frame.
      this._calibration.feed(frame);

      // Store for overlay — actual VRM application happens in the render loop
      // via applyLatestFrame() so mocap writes AFTER the BVH mixer.
      this._latestFrame  = frame;
      this._frameRecorded = false;
    };

    this.detector.onError = (err) => {
      console.error('[mocap]', err);
      this.onError?.(err);
    };
  }

  get state():              MocapState        { return this._state; }
  get frameCount():         number            { return this.liveRecorder.frameCount; }
  get recordingFrameCount(): number           { return this.liveRecorder.frameCount; }
  get grabbedFrameCount():   number           { return this.grabRecorder.frameCount; }
  get currentTime():        number            { return this.detector.currentTime; }
  get duration():           number            { return this.detector.duration; }
  get isPaused():           boolean           { return this.detector.isPaused; }
  get latestFrame():        PoseFrame | null  { return this._latestFrame; }
  get videoElement():       HTMLVideoElement  { return this.detector.video; }

  /** Attach / detach the preview canvas. Call after startLive(). */
  setCanvas(canvas: HTMLCanvasElement | null): void {
    this.detector.setCanvas(canvas);
  }

  private _createRecorder(): BvhRecorder {
    const correctionInvMap = this._buildCorrectionInvMap();
    // VRM 0.x avatars use a flipped (left-handed-ish) coordinate system.
    // `@pixiv/three-vrm-animation/createVRMAnimationClip` automatically negates
    // x/z components on load when target avatar is 0.x; pre-flip here to make
    // the round-trip cancel.
    const flipForVrm0 = this._vrm.meta.metaVersion === '0';
    return new BvhRecorder({
      getJointOffset: (name) => this._getBvhJointOffset(name),
      getRestCorrectionInv: (name) => correctionInvMap.get(name) ?? null,
      flipForVrm0,
    });
  }

  private _buildCorrectionInvMap(): Map<string, [number, number, number, number]> {
    const map = new Map<string, [number, number, number, number]>();
    // Prime the rest-axes cache while the avatar is in (near-)bind pose so the
    // loader sees the same snapshot at replay time. See note on
    // `getCachedHumanoidRestAxes` in humanoidRestPose.ts.
    const restAxes = getCachedHumanoidRestAxes(this._vrm);
    const _q = new THREE.Quaternion();
    for (const [bone, info] of restAxes) {
      // correction = setFromUnitVectors(rawAxis, normalizedAxis)
      // correctionInv rotates normalizedAxis back to rawAxis direction;
      // pre-multiplying by corrInv maps rawAxis-convention q to T-pose-relative q.
      _q.copy(info.correction).invert();
      map.set(bone, [_q.x, _q.y, _q.z, _q.w]);
    }
    return map;
  }

  private _getBvhJointOffset(name: string): [number, number, number] | null {
    if (name === 'hips') return [0, 0, 0];
    const node = this._vrm.humanoid.getNormalizedBoneNode(name as any);
    if (!node) return null;
    return [node.position.x, node.position.y, node.position.z];
  }

  private _getBvhHipsPosition(): [number, number, number] | null {
    // Write LOCAL position (relative to hips' parent), not world. AnimationMixer
    // on playback writes back into `bone.position` which is local — so for a
    // bit-exact round-trip the value we record must be the same field.
    // Reading world here would silently bake the parent transform into the BVH
    // and re-apply it on playback, producing a constant offset (~9cm in our
    // verifier on rigs where the normalized hips has any parent transform).
    const hips = this._vrm.humanoid.getNormalizedBoneNode('hips' as any);
    if (!hips) return null;
    const p = hips.position;
    return [p.x, p.y, p.z];
  }

  // ── Debug knobs ────────────────────────────────────────────────────────────

  setPoseQuality(q: PoseModelQuality): Promise<void> { return this.detector.setPoseQuality(q); }
  get poseQuality(): PoseModelQuality { return this.detector.poseQuality; }

  setFilterEnabled(v: boolean): void { this.detector.setFilterEnabled(v); }
  get filterEnabled(): boolean { return this.detector.filterEnabled; }

  setDepthScale(v: number): void { this.applier.setDepthScale(v); }
  get depthScale(): number { return this.applier.depthScale; }

  setVisibilityThreshold(v: number): void { this.applier.setVisibilityThreshold(v); }
  get visibilityThreshold(): number { return this.applier.visibilityThreshold; }

  setShoulderSpread(deg: number): void { this.applier.setShoulderSpread(deg); }
  get shoulderSpread(): number { return this.applier.shoulderSpread; }

  setLegSpreadX(v: number): void { this.applier.setLegSpreadX(v); }
  get legSpreadX(): number { return this.applier.legSpreadX; }

  setMirrorX(v: boolean): void { this.applier.setMirrorX(v); }
  get mirrorX(): boolean { return this.applier.mirrorX; }

  setBodySmoothing(v: number): void { this.applier.setBodySmoothing(v); }
  get bodySmoothing(): number { return this.applier.bodySmoothing; }

  setSpineSmoothing(v: number): void { this.applier.setSpineSmoothing(v); }
  get spineSmoothing(): number { return this.applier.spineSmoothing; }

  setArmZAttenuation(v: number): void { this.applier.setArmZAttenuation(v); }
  get armZAttenuation(): number { return this.applier.armZAttenuation; }

  setPoleSmoothing(v: number): void { this.applier.setPoleSmoothing(v); }
  get poleSmoothing(): number { return this.applier.poleSmoothing; }

  setArmPoleZ(v: number): void { this.applier.setArmPoleZ(v); }
  get armPoleZ(): number { return this.applier.armPoleZ; }

  setHipPositionEnabled(v: boolean): void { this.applier.setHipPositionEnabled(v); }
  get hipPositionEnabled(): boolean { return this.applier.hipPositionEnabled; }

  setFootLockEnabled(v: boolean): void { this.applier.setFootLockEnabled(v); }
  get footLockEnabled(): boolean { return this.applier.footLockEnabled; }

  setLateralBendScale(v: number): void { this.applier.setLateralBendScale(v); }
  get lateralBendScale(): number { return this.applier.lateralBendScale; }

  setHandTrackingPriorityEnabled(v: boolean): void { this.applier.setHandTrackingPriorityEnabled(v); }
  get handTrackingPriorityEnabled(): boolean { return this.applier.handTrackingPriorityEnabled; }

  setFaceTrackingEnabled(v: boolean): void { this.faceApplier.setEnabled(v); }
  get faceTrackingEnabled(): boolean { return this.faceApplier.enabled; }

  // ── Overlay application ───────────────────────────────────────────────────

  /**
   * Apply the latest detected pose frame to the VRM.
   * Call this from the main render loop AFTER the BVH mixer update so that
   * mocap overlays on top of the animation rather than being overwritten by it.
   *
   * Recording is intentionally NOT done here — call `captureRecordedFrame()`
   * after the render-loop pipeline finishes (post-clamp, post-overlays, but
   * pre-vrm.update) so the BVH stores exactly what the user saw on screen.
   */
  applyLatestFrame(): void {
    if (!this._latestFrame || this._state === 'off') return;
    this.applier.apply(this._latestFrame);
    this.faceApplier.apply(this._latestFrame.faceLandmarks);
  }

  /**
   * Snapshot the current normalized-bone state into the live recorder when in
   * 'recording' state. Reads bone.quaternion *now* — meant to run after the
   * render loop's clamp + overlay stages so what we record matches what is
   * about to be drawn. Rate-limited to 30 Hz inside the recorder.
   */
  captureRecordedFrame(): void {
    if (this._state !== 'recording') return;
    if (!this._latestFrame || this._frameRecorded) return;

    this.liveRecorder.addFrame(
      (name) => this.applier.getQuaternion(name),
      () => this._getBvhHipsPosition(),
    );
    this._frameRecorded = true;

    // Round-trip verification: snapshot a full pose only when the recorder
    // actually accepted a new frame (rate-limited to 30 Hz) so expected[i]
    // aligns 1:1 with the BVH frame i written to file.
    if (this._verifySnapshots !== null) {
      const fc = this.liveRecorder.frameCount;
      if (fc > this._verifyLastFrameCount) {
        this._verifySnapshots.push(captureSnapshot(this._vrm, fc - 1));
        this._verifyLastFrameCount = fc;
      }
    }
  }

  // ── Round-trip verification API ────────────────────────────────────────────

  /** Begin collecting expected-side pose snapshots alongside the live recorder. */
  startVerifyCapture(): void {
    this._verifySnapshots = [];
    this._verifyLastFrameCount = this.liveRecorder.frameCount;
  }

  /** Stop collecting and return the captured snapshots (one per BVH frame). */
  stopVerifyCapture(): PoseSnapshot[] {
    const out = this._verifySnapshots ?? [];
    this._verifySnapshots = null;
    this._verifyLastFrameCount = 0;
    return out;
  }

  get verifyCapturing(): boolean { return this._verifySnapshots !== null; }
  get verifyCapturedCount(): number { return this._verifySnapshots?.length ?? 0; }

  /** VRM handle — needed by the verifier to run deterministic replay. */
  get vrm(): VRM { return this._vrm; }

  /**
   * Start a recording buffer specifically for verification. Unlike
   * `startRecording()`, this does NOT transition state to 'recording' and so
   * does not enable the normal record-side effects (auto-replay on stop,
   * BVH download). The caller must also call `startVerifyCapture()` to collect
   * the expected-side snapshots, and must pair with `stopVerifyRecording()`.
   *
   * Requires mocap state === 'live'.
   */
  startVerifyRecording(): void {
    if (this._state !== 'live') return;
    this.liveRecorder.start();
    this._setState('recording');
  }

  /** Stop a verification recording and return the BVH text; no download, no onBvhReady. */
  stopVerifyRecording(): string {
    if (this._state !== 'recording') return '';
    const bvhText = this.liveRecorder.stop();
    this._setState('live');
    return bvhText;
  }

  /**
   * Process a video file end-to-end for round-trip verification. Same pipeline
   * as `startFromFile` but returns the BVH text + expected-side snapshots
   * without triggering download or the auto-replay `onBvhReady` hook.
   * Resolves when the video finishes; rejects on error.
   */
  async startVerifyFromFile(
    file: File,
    onProgress?: (frames: number) => void,
  ): Promise<{ bvh: string; expected: PoseSnapshot[] }> {
    if (this._state !== 'off') {
      throw new Error(`startVerifyFromFile requires state 'off'; current '${this._state}'`);
    }
    this._latestFrame = null;
    this._frameRecorded = false;
    this._teardownFileCapture();

    this.applier.setHighQualityMode(true);
    this._fileCaptureActive = true;

    this.startVerifyCapture();

    const tickInterval = onProgress
      ? window.setInterval(() => onProgress(this.verifyCapturedCount), 150)
      : 0;

    return new Promise<{ bvh: string; expected: PoseSnapshot[] }>((resolve, reject) => {
      this.detector.onEnd = () => {
        const bvhText = this.liveRecorder.stop();
        const expected = this.stopVerifyCapture();
        if (tickInterval) clearInterval(tickInterval);
        this._teardownFileCapture();
        this._setState('off');
        resolve({ bvh: bvhText, expected });
      };

      this.detector.startFromFile(file).then(
        () => {
          this.liveRecorder.start();
          this._setState('recording');
        },
        (err) => {
          if (tickInterval) clearInterval(tickInterval);
          this.stopVerifyCapture();
          this.detector.stop();
          this._teardownFileCapture();
          reject(err);
        },
      );
    });
  }

  /**
   * Re-apply tracked wrist + finger pose after other authored overlays so hands
   * remain the top layer when hand-priority mode is enabled.
   */
  applyTrackedHandsOverlay(): void {
    if (!this._latestFrame || this._state === 'off' || !this.applier.handTrackingPriorityEnabled) return;
    this.applier.applyTrackedHands(this._latestFrame, true);
  }

  // ── Calibration ────────────────────────────────────────────────────────────

  get calibration(): MocapCalibration { return this._calibration; }
  get hipsBaseWorld() { return this.applier.hipsBaseWorld; }
  get debugTargets() { return this.applier.debugTargets; }

  /** Per-chain visibility-loss state (D1-lite). Passthrough from the applier. */
  getTrackingHealth() { return this.applier.getTrackingHealth(); }

  /**
   * IK target reach as % of avatar limb length, per side.
   *   < 90%  — comfortable reach, IK bends freely
   *   ~100%  — near max (straight limb)
   *   > 100% — unreachable (limb locks, hand/foot short of target)
   */
  getReachPercent(): { armL: number; armR: number; legL: number; legR: number } {
    const h = this._vrm.humanoid;
    const tmp = new THREE.Vector3();
    const reach = (boneName: string, target: THREE.Vector3, limbLen: number): number => {
      const n = h.getNormalizedBoneNode(boneName as any);
      if (!n || limbLen <= 0) return 0;
      n.getWorldPosition(tmp);
      return (tmp.distanceTo(target) / limbLen) * 100;
    };
    const cal = this._calibration;
    const dt  = this.applier.debugTargets;
    return {
      armL: dt.hasArm ? reach('leftUpperArm',  dt.leftWristTarget,  cal.avatarLeftUpperArm  + cal.avatarLeftLowerArm)   : 0,
      armR: dt.hasArm ? reach('rightUpperArm', dt.rightWristTarget, cal.avatarRightUpperArm + cal.avatarRightLowerArm)  : 0,
      legL: dt.hasLeg ? reach('leftUpperLeg',  dt.leftAnkleTarget,  cal.avatarLeftUpperLeg  + cal.avatarLeftLowerLeg)   : 0,
      legR: dt.hasLeg ? reach('rightUpperLeg', dt.rightAnkleTarget, cal.avatarRightUpperLeg + cal.avatarRightLowerLeg)  : 0,
    };
  }

  /**
   * Dump a full side-by-side comparison of performer landmarks vs avatar
   * skeleton to the console. Useful for debugging scale / calibration bugs
   * (e.g. "performer skeleton shoulders look too wide").
   */
  dumpSkeleton(): void {
    const frame = this._latestFrame;
    const cal   = this._calibration;
    const h     = this._vrm.humanoid;

    console.group('%cSkeleton dump', 'color:#6186ff;font-weight:bold');

    if (!frame) {
      console.warn('No mocap frame available — start camera first.');
      console.groupEnd();
      return;
    }

    // ── Performer measurements (raw MediaPipe world meters) ────────────────
    const lms = frame.worldLandmarks;
    const dist = (a: any, b: any): number => {
      if (!a || !b) return NaN;
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      return Math.sqrt(dx*dx + dy*dy + dz*dz);
    };
    const vis = (l: any): string => l?.visibility != null ? `${(l.visibility*100).toFixed(0)}%` : '?';

    const ls = lms[11], rs = lms[12];           // shoulders
    const lh = lms[23], rh = lms[24];           // hips
    const lw = lms[15], rw = lms[16];           // wrists
    const le = lms[13], re = lms[14];           // elbows
    const lk = lms[25], rk = lms[26];           // knees
    const la = lms[27], ra = lms[28];           // ankles

    console.group('%cPerformer (raw MP meters)', 'color:#00ff88');
    console.table({
      'Shoulder width':  { value: dist(ls, rs).toFixed(3), vis: `${vis(ls)}/${vis(rs)}` },
      'Hip width':       { value: dist(lh, rh).toFixed(3), vis: `${vis(lh)}/${vis(rh)}` },
      'Left upper arm':  { value: dist(ls, le).toFixed(3), vis: `${vis(ls)}/${vis(le)}` },
      'Left lower arm':  { value: dist(le, lw).toFixed(3), vis: `${vis(le)}/${vis(lw)}` },
      'Right upper arm': { value: dist(rs, re).toFixed(3), vis: `${vis(rs)}/${vis(re)}` },
      'Right lower arm': { value: dist(re, rw).toFixed(3), vis: `${vis(re)}/${vis(rw)}` },
      'Left upper leg':  { value: dist(lh, lk).toFixed(3), vis: `${vis(lh)}/${vis(lk)}` },
      'Left lower leg':  { value: dist(lk, la).toFixed(3), vis: `${vis(lk)}/${vis(la)}` },
      'Right upper leg': { value: dist(rh, rk).toFixed(3), vis: `${vis(rh)}/${vis(rk)}` },
      'Right lower leg': { value: dist(rk, ra).toFixed(3), vis: `${vis(rk)}/${vis(ra)}` },
    });
    console.log('Shoulder→Wrist L (max accum):', cal.unifyArmMax
      ? Math.max((cal as any).performerLeftArmMax, (cal as any).performerRightArmMax).toFixed(3)
      : (cal as any).performerRightArmMax?.toFixed?.(3));
    console.log('Shoulder→Wrist R (max accum):', (cal as any).performerLeftArmMax?.toFixed?.(3));
    console.groupEnd();

    // ── Avatar measurements (rest-pose bone lengths) ───────────────────────
    const boneWorld = (name: string): THREE.Vector3 => {
      const n = h.getNormalizedBoneNode(name as any);
      const v = new THREE.Vector3();
      n?.getWorldPosition(v);
      return v;
    };

    const avatarShoulderW = boneWorld('leftUpperArm').distanceTo(boneWorld('rightUpperArm'));
    const avatarHipW      = boneWorld('leftUpperLeg').distanceTo(boneWorld('rightUpperLeg'));
    console.group('%cAvatar (rest-pose world meters)', 'color:#fbbf24');
    console.table({
      'Shoulder width':  { value: avatarShoulderW.toFixed(3) },
      'Hip width':       { value: avatarHipW.toFixed(3) },
      'L upper arm':     { value: cal.avatarLeftUpperArm.toFixed(3)  },
      'L lower arm':     { value: cal.avatarLeftLowerArm.toFixed(3)  },
      'R upper arm':     { value: cal.avatarRightUpperArm.toFixed(3) },
      'R lower arm':     { value: cal.avatarRightLowerArm.toFixed(3) },
      'L upper leg':     { value: cal.avatarLeftUpperLeg.toFixed(3)  },
      'L lower leg':     { value: cal.avatarLeftLowerLeg.toFixed(3)  },
      'R upper leg':     { value: cal.avatarRightUpperLeg.toFixed(3) },
      'R lower leg':     { value: cal.avatarRightLowerLeg.toFixed(3) },
    });
    console.groupEnd();

    // ── Calibration state ──────────────────────────────────────────────────
    const st = cal.status();
    console.group('%cCalibration', 'color:#c084fc');
    console.table({
      'Calibrated':          { value: st.calibrated },
      'Body scale':          { value: `${(st.bodyScale*100).toFixed(1)}%` },
      'Shoulder scale':      { value: `${(st.shoulderWidthScale*100).toFixed(1)}%` },
      'Arm L scale':         { value: `${(st.leftArmScale*100).toFixed(1)}%` },
      'Arm R scale':         { value: `${(st.rightArmScale*100).toFixed(1)}%` },
      'Leg scale':           { value: `${(cal.legScale()*100).toFixed(1)}%` },
      'Unify arm max':       { value: cal.unifyArmMax },
      'Hip vis gate':        { value: cal.hipVisGate.toFixed(2) },
    });
    console.log('Readiness:', cal.readiness());
    console.groupEnd();

    // ── Ratios: avatar / performer ─────────────────────────────────────────
    const refs = cal.refRatios();
    console.group('%cRatios avatar/performer (all references)', 'color:#f87171');
    console.table({
      'Shoulder ratio': { value: refs.shoulder?.toFixed(3) ?? 'n/a' },
      'Hip ratio':      { value: refs.hip?.toFixed(3)      ?? 'n/a' },
      'Head ratio':     { value: refs.head?.toFixed(3)     ?? 'n/a' },
      'Active ref':     { value: cal.scaleRef },
      'bodyScale used': { value: (cal.bodyScale() * 100).toFixed(1) + '%' },
    });
    console.groupEnd();

    // ── IK target vs actual bone ───────────────────────────────────────────
    const dt = this.applier.debugTargets;
    const actual = this.getActualBonePositions();
    const reach  = this.getReachPercent();
    console.group('%cIK targets & reach', 'color:#93b4ff');
    console.table({
      'L wrist target':  { pos: dt.leftWristTarget.toArray().map((v) => v.toFixed(3)).join(', '), reach: `${reach.armL.toFixed(0)}%` },
      'L hand actual':   { pos: actual.leftHand.toArray().map((v) => v.toFixed(3)).join(', '), reach: '' },
      'R wrist target':  { pos: dt.rightWristTarget.toArray().map((v) => v.toFixed(3)).join(', '), reach: `${reach.armR.toFixed(0)}%` },
      'R hand actual':   { pos: actual.rightHand.toArray().map((v) => v.toFixed(3)).join(', '), reach: '' },
      'L ankle target':  { pos: dt.leftAnkleTarget.toArray().map((v) => v.toFixed(3)).join(', '), reach: `${reach.legL.toFixed(0)}%` },
      'L foot actual':   { pos: actual.leftFoot.toArray().map((v) => v.toFixed(3)).join(', '), reach: '' },
      'R ankle target':  { pos: dt.rightAnkleTarget.toArray().map((v) => v.toFixed(3)).join(', '), reach: `${reach.legR.toFixed(0)}%` },
      'R foot actual':   { pos: actual.rightFoot.toArray().map((v) => v.toFixed(3)).join(', '), reach: '' },
    });
    console.groupEnd();

    console.groupEnd();
  }

  /** World positions of the avatar's hand / foot bones — used to compare against
   *  IK targets for fit statistics. */
  getActualBonePositions(): {
    leftHand: THREE.Vector3; rightHand: THREE.Vector3;
    leftFoot: THREE.Vector3; rightFoot: THREE.Vector3;
  } {
    const h = this._vrm.humanoid;
    const get = (name: string): THREE.Vector3 => {
      const node = h.getNormalizedBoneNode(name as any);
      const out  = new THREE.Vector3();
      node?.getWorldPosition(out);
      return out;
    };
    return {
      leftHand:  get('leftHand'),
      rightHand: get('rightHand'),
      leftFoot:  get('leftFoot'),
      rightFoot: get('rightFoot'),
    };
  }

  /** World positions of key avatar joints for side-by-side pose diagnostics. */
  getAvatarJointPositions(): {
    hips: THREE.Vector3;
    leftUpperArm: THREE.Vector3;  leftLowerArm: THREE.Vector3;  leftHand: THREE.Vector3;
    rightUpperArm: THREE.Vector3; rightLowerArm: THREE.Vector3; rightHand: THREE.Vector3;
    leftUpperLeg: THREE.Vector3;  leftLowerLeg: THREE.Vector3;  leftFoot: THREE.Vector3;
    rightUpperLeg: THREE.Vector3; rightLowerLeg: THREE.Vector3; rightFoot: THREE.Vector3;
  };
  getAvatarJointPositions(kind: 'normalized' | 'raw'): {
    hips: THREE.Vector3;
    leftUpperArm: THREE.Vector3;  leftLowerArm: THREE.Vector3;  leftHand: THREE.Vector3;
    rightUpperArm: THREE.Vector3; rightLowerArm: THREE.Vector3; rightHand: THREE.Vector3;
    leftUpperLeg: THREE.Vector3;  leftLowerLeg: THREE.Vector3;  leftFoot: THREE.Vector3;
    rightUpperLeg: THREE.Vector3; rightLowerLeg: THREE.Vector3; rightFoot: THREE.Vector3;
  };
  getAvatarJointPositions(kind: 'normalized' | 'raw' = 'normalized'): {
    hips: THREE.Vector3;
    leftUpperArm: THREE.Vector3;  leftLowerArm: THREE.Vector3;  leftHand: THREE.Vector3;
    rightUpperArm: THREE.Vector3; rightLowerArm: THREE.Vector3; rightHand: THREE.Vector3;
    leftUpperLeg: THREE.Vector3;  leftLowerLeg: THREE.Vector3;  leftFoot: THREE.Vector3;
    rightUpperLeg: THREE.Vector3; rightLowerLeg: THREE.Vector3; rightFoot: THREE.Vector3;
  } {
    const h = this._vrm.humanoid;
    const get = (name: string): THREE.Vector3 => {
      const node = kind === 'raw'
        ? h.getRawBoneNode(name as any) ?? h.getNormalizedBoneNode(name as any)
        : h.getNormalizedBoneNode(name as any);
      const out  = new THREE.Vector3();
      node?.getWorldPosition(out);
      return out;
    };
    return {
      hips:          get('hips'),
      leftUpperArm:  get('leftUpperArm'),
      leftLowerArm:  get('leftLowerArm'),
      leftHand:      get('leftHand'),
      rightUpperArm: get('rightUpperArm'),
      rightLowerArm: get('rightLowerArm'),
      rightHand:     get('rightHand'),
      leftUpperLeg:  get('leftUpperLeg'),
      leftLowerLeg:  get('leftLowerLeg'),
      leftFoot:      get('leftFoot'),
      rightUpperLeg: get('rightUpperLeg'),
      rightLowerLeg: get('rightLowerLeg'),
      rightFoot:     get('rightFoot'),
    };
  }
  /** Clear calibration samples — next high-visibility frames re-calibrate. */
  recalibrate(): void {
    this._calibration.recalibrate();
    this.applier.resetHipBaseline();
    this.applier.resetFootLock();
    // If the detector is paused (or just hasn't produced a new frame yet), the
    // running EMAs we just zeroed would stay zero until playback resumes — and
    // applier.apply() falls back to its un-calibrated branch in the meantime,
    // visibly breaking the pose. Re-seed from the cached frame so calibration
    // is usable on the very next render tick, even while paused.
    if (this._latestFrame) this._calibration.feed(this._latestFrame);
  }

  // ── Playback controls (useful mainly for file-source mocap) ────────────────

  /** Pause both the video and the detection loop. */
  pause(): void { this.detector.pause(); }
  /** Resume from pause. */
  resume(): void { this.detector.resume(); }
  /** Seek the video by deltaSec and run detection on that single frame.
   *  Only works while paused with a file source. */
  stepFrame(deltaSec: number): Promise<void> { return this.detector.stepFrame(deltaSec); }

  /**
   * Append the current VRM pose to the BVH buffer as one frame at a synthetic
   * rate-aligned timestamp. Use for manual frame-by-frame animation capture
   * independent of the live "recording" auto-append.
   */
  grabFrame(): void {
    this.grabRecorder.captureFrame(
      (name) => this.applier.getQuaternion(name),
      () => this._getBvhHipsPosition(),
    );
  }

  /**
   * Flush whatever frames are in the recorder to a .bvh download, then clear.
   * Used to finalise a frame-by-frame session without needing state transitions.
   */
  flushGrabbed(): void {
    if (this.grabRecorder.frameCount === 0) return;
    const bvhText = this.grabRecorder.stop();
    const name    = `mocap_${++this._recordingIndex}`;
    downloadBvh(bvhText, `${name}.bvh`);
    this.onBvhReady?.(bvhText, name);
  }

  /**
   * Export the avatar's current pose as a single-frame BVH without touching the
   * live recorder buffer. Safe to call during live preview or active recording.
   */
  exportCurrentPoseBvh(): string {
    const poseRecorder = this._createRecorder();
    poseRecorder.captureFrame(
      (name) => this.applier.getQuaternion(name),
      () => this._getBvhHipsPosition(),
    );
    const bvhText = poseRecorder.stop();
    const name = `pose_${++this._poseExportIndex}`;
    downloadBvh(bvhText, `${name}.bvh`);
    return name;
  }

  /**
   * Returns a multi-section diagnostic string covering:
   * - VRM normalized bone offsets (used as BVH OFFSET values)
   * - Humanoid rest-axis corrections (rawAxis vs normalizedAxis per bone)
   * - Current-pose 1-frame BVH text
   * Intended for the debug diagnostic modal.
   */
  getBvhDiagnosticText(): string {
    const lines: string[] = ['=== BVH Diagnostic ===', `Timestamp: ${new Date().toISOString()}`, ''];

    // ── Joint offsets ────────────────────────────────────────────────────────
    lines.push('--- Joint offsets (BVH HIERARCHY OFFSET, metres) ---');
    const boneNames = Object.keys(this._vrm.humanoid.humanBones);
    for (const name of boneNames) {
      const offset = this._getBvhJointOffset(name);
      if (offset) {
        lines.push(`  ${name.padEnd(30)} [${offset.map((v) => v.toFixed(5)).join(', ')}]`);
      } else {
        lines.push(`  ${name.padEnd(30)} (not in humanoid)`);
      }
    }

    // ── Applier rest axes (what the mocap pipeline actually uses) ────────────
    lines.push('', '--- Applier restLocalAxis + per-bone BVH correction ---');
    lines.push('  applier uses rawAxis; BVH export pre-multiplies by corrInv to produce T-pose-relative output');
    const axes = getCachedHumanoidRestAxes(this._vrm);
    for (const [bone, info] of axes) {
      const corrAngleDeg = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(info.correction.w))));
      const na = info.normalizedAxis;
      const ra = info.rawAxis;
      const applierAxis = this.applier.getRestAxis(bone);
      const matchesRaw = applierAxis
        ? Math.abs(applierAxis.dot(ra) - 1) < 0.001
        : false;
      lines.push(`  ${bone.padEnd(20)} restAxis=[${(applierAxis?.x ?? NaN).toFixed(4)}, ${(applierAxis?.y ?? NaN).toFixed(4)}, ${(applierAxis?.z ?? NaN).toFixed(4)}]  normAxis=[${na.x.toFixed(4)}, ${na.y.toFixed(4)}, ${na.z.toFixed(4)}]  rawAxis=[${ra.x.toFixed(4)}, ${ra.y.toFixed(4)}, ${ra.z.toFixed(4)}]  corrAngle=${corrAngleDeg.toFixed(1)}°  useRaw=${matchesRaw}`);
    }

    // ── Current pose BVH (1 frame) ───────────────────────────────────────────
    lines.push('', `--- Current pose BVH (1 frame) [mocap state: ${this._state}] ---`);
    lines.push('  NOTE: bone values here reflect CURRENT node.quaternion (idle anim when camera off).');
    lines.push('  To verify BVH fix: enable camera, stand in T-pose, then re-open this modal.');
    try {
      const recorder = this._createRecorder();
      recorder.captureFrame(
        (name) => this.applier.getQuaternion(name),
        () => this._getBvhHipsPosition(),
      );
      lines.push(recorder.stop());
    } catch (e) {
      lines.push(`ERROR: ${(e as Error).message}`);
    }

    return lines.join('\n');
  }

  private _teardownFileCapture(): void {
    if (this._fileCaptureActive) {
      this.applier.setHighQualityMode(false);
      this._fileCaptureActive = false;
    }
    this.detector.onEnd = null;
  }

  // ── State transitions ──────────────────────────────────────────────────────

  /** Start camera + live pose preview. */
  async startLive(): Promise<void> {
    if (this._state !== 'off') return;
    this._teardownFileCapture();
    this._latestFrame = null;
    this._frameRecorded = false;
    await this.detector.start();
    this._setState('live');
  }

  /** Begin recording (must be in 'live' state first). */
  startRecording(): void {
    if (this._state !== 'live') return;
    this.liveRecorder.start();
    this._setState('recording');
  }

  /**
   * Stop recording, generate BVH, trigger download, and notify via onBvhReady.
   * Returns to 'live' state.
   */
  stopRecording(): void {
    if (this._state !== 'recording') return;
    if (this._fileCaptureActive) {
      this.stop();
      return;
    }
    const bvhText = this.liveRecorder.stop();
    const name    = `mocap_${++this._recordingIndex}`;
    downloadBvh(bvhText, `${name}.bvh`);
    this.onBvhReady?.(bvhText, name);
    this._setState('live');
  }

  /**
   * Process a video file: load → apply pose each frame → auto-record → download BVH.
   * Fires onStateChange('recording') immediately, then onStateChange('off') when done.
   */
  async startFromFile(file: File): Promise<void> {
    if (this._state !== 'off') return;
    this._latestFrame = null;
    this._frameRecorded = false;
    this._teardownFileCapture();

    // Recording from file: snap directly to detected pose, no torso dampening,
    // so the output BVH matches the source video instead of the smoothed preview.
    this.applier.setHighQualityMode(true);
    this._fileCaptureActive = true;

    this.detector.onEnd = () => {
      const bvhText = this.liveRecorder.stop();
      const name    = `mocap_${++this._recordingIndex}`;
      downloadBvh(bvhText, `${name}.bvh`);
      this.onBvhReady?.(bvhText, name);
      this._teardownFileCapture();
      this._setState('off');
    };

    try {
      await this.detector.startFromFile(file);
      this.liveRecorder.start();
      this._setState('recording');
    } catch (err) {
      this.detector.stop();
      this._teardownFileCapture();
      throw err;
    }
  }

  /** Stop everything, close camera. */
  stop(): void {
    if (this._state === 'recording' && this.liveRecorder.recording) this.liveRecorder.stop(); // discard
    this.detector.stop();
    this._teardownFileCapture();
    this.applier.resetHipBaseline();
    this.applier.resetFootLock();
    this.faceApplier.reset();
    this._setState('off');
  }

  dispose(): void {
    this.stop();
    this.detector.dispose();
    this.onStateChange = null;
    this.onError = null;
    this.onBvhReady = null;
    this.onCalibrationChange = null;
  }

  private _setState(s: MocapState): void {
    this._state = s;
    this.onStateChange?.(s);
  }
}
