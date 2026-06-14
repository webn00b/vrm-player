import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import {
  PoseDetector,
  type PoseModelQuality,
  type PoseFrame,
  type PoseStabilizerSettings,
} from './poseDetector';
import { DirectPoseApplier } from '../retargeters/directPoseApplier';
import { FaceApplier } from '../retargeters/faceApplier';
import {
  faceTrackHasMotion,
  serializeFaceTrack,
  type FaceExpressionFrame,
  type FaceTrack,
} from '../bvh/faceTrack';
import { downloadBvh, BVH_FRAME_RATE } from '../bvh/bvhRecorder';
import { smoothMocapFrames } from './offlineLandmarkSmoother';
import { debiasTorsoLean, debiasLegLean } from './torsoDebias';
import { autoTrimRange } from './autoTrim';
import { MotionBertLifter, readLiftingEnabled } from './poseLifter';
import { FULL_BODY_COVERAGE_MIN, fullBodyCoverage } from './bodyCoverage';
import { MocapCalibration, type CalibrationStatus } from '../trackers/mocapCalibration';
import type { LandmarkStabilizerOptions } from '../trackers/landmarkStabilizer';
import type { PoseSnapshot } from '../bvh/bvhRoundtripVerifier';
import { shouldRecordAfterPreroll } from './videoFrameTimes';
import { MocapBvhSession } from './mocapBvhSession';
import {
  buildBvhDiagnosticText,
  dumpSkeleton,
  getActualBonePositions,
  getAvatarJointPositions,
  getReachPercent,
  type AvatarJointPositionMap,
  type ReachPercent,
} from '../diagnostics/mocapInspector';

export type MocapState = 'off' | 'live' | 'recording';
export interface MocapBvhReadyOptions {
  source: 'camera' | 'video';
  exportAgentOgiJson?: boolean;
}

export interface PoseBvhExport {
  name: string;
  bvhText: string;
}

export interface FileCaptureProgress {
  /** analyze = pass A (detection), lift = MotionBERT 3D lifting,
   *  smooth = offline filtering, replay = pass B (BVH capture). */
  phase: 'analyze' | 'lift' | 'smooth' | 'replay';
  frameIndex: number;
  totalFrames: number;
}

const DEFAULT_FILE_CAPTURE_CALIBRATION_PREROLL_SEC = 1.5;

// localStorage overrides for the two-pass file pipeline; let headless tools
// and A/B comparisons flip stages without a UI round-trip.
const OFFLINE_SMOOTHING_STORAGE_KEY = 'vrm-player.mocap.offlineSmoothing';
const CROP_REDETECT_STORAGE_KEY = 'vrm-player.mocap.cropRedetect';
const CHAIN_SCALE_STORAGE_KEY = 'vrm-player.mocap.chainScale';
const LIFTING_STORAGE_KEY = 'vrm-player.mocap.lifting';
const AUTO_TRIM_STORAGE_KEY = 'vrm-player.mocap.autoTrim';
const ARM_BACK_LIMIT_STORAGE_KEY = 'vrm-player.mocap.armBackLimitDeg';

function readStorageNumber(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function readStorageToggle(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

function persistToggle(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* private mode */ }
}

function readOfflineSmoothingDefault(): boolean {
  return readStorageToggle(OFFLINE_SMOOTHING_STORAGE_KEY);
}

function readCropRedetectEnabled(): boolean {
  try {
    return localStorage.getItem(CROP_REDETECT_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * Orchestrates the webcam → pose → VRM → BVH pipeline.
 *
 *   off       – camera closed, VRM unaffected
 *   live      – camera on, pose applied to VRM each frame, no recording
 *   recording – live + every frame written to the BVH session
 *
 * Recorder bookkeeping lives in MocapBvhSession; console diagnostics in
 * mocapInspector. This class owns the state machine and the detector wiring.
 */
export class MocapController {
  private detector: PoseDetector;
  private applier: DirectPoseApplier;
  private faceApplier: FaceApplier;
  private session: MocapBvhSession;
  private _calibration: MocapCalibration;

  private _state: MocapState = 'off';
  private _fileCaptureActive = false;
  private _fixedFileCaptureActive = false;
  private _fixedFileFramePending = false;
  private _fileCaptureCalibrationPrerollSec = DEFAULT_FILE_CAPTURE_CALIBRATION_PREROLL_SEC;
  // Two-pass file capture: collect raw landmarks first, smooth offline
  // (zero-phase), then replay through the applier. See offlineLandmarkSmoother.
  private _offlineSmoothingEnabled = readOfflineSmoothingDefault();
  private _fileProgress: FileCaptureProgress | null = null;
  // MotionBERT temporal 3D lifting (two-pass file capture only). Lazy-loads
  // the ONNX model; silently unavailable when the model isn't deployed.
  private _lifter = new MotionBertLifter();
  private _liftingEnabled = readLiftingEnabled();
  // Second detection pass over a person crop (personCropPlanner). Default
  // OFF: Holistic runs its own internal ROI tracking, so the extra pass
  // measured no 2D improvement on AIST (10 px either way) while doubling
  // pass-A time. Kept as an experimental toggle for extreme cases.
  private _cropRedetectEnabled = readCropRedetectEnabled();
  // Trim idle/empty head and tail of the captured clip. See autoTrim.
  private _autoTrimEnabled = readStorageToggle(AUTO_TRIM_STORAGE_KEY);
  // One expression sample per recorded BVH frame → face sidecar. See faceTrack.
  private _faceTrack: FaceExpressionFrame[] = [];

  // Latest detected frame — applied each render tick via applyLatestFrame()
  // so mocap overlays on top of the BVH mixer output rather than fighting it.
  private _latestFrame: PoseFrame | null = null;
  // Set to false each time a new frame arrives. Kept for UI / future diagnostics;
  // BVH recording itself samples the latest pose at fixed 30 Hz, so repeated
  // detector frames are intentionally written to preserve wall-clock duration.
  private _frameRecorded = false;

  onStateChange:          ((state: MocapState) => void) | null = null;
  onError:                ((err: Error)         => void) | null = null;
  onBvhReady:             ((bvh: string, name: string, options: MocapBvhReadyOptions) => void) | null = null;
  onCalibrationChange:    ((s: CalibrationStatus) => void) | null = null;

  private _vrm: VRM;
  exportAgentOgiJsonForVideo = false;

  /** Save a copy of the live webcam footage alongside the BVH (camera source). */
  saveCameraVideo = true;
  private _camRecorder: MediaRecorder | null = null;
  private _camChunks: Blob[] = [];

  constructor(vrm: VRM, videoEl: HTMLVideoElement) {
    this._vrm         = vrm;
    this.detector     = new PoseDetector(videoEl);
    this._calibration = new MocapCalibration(vrm);
    this.applier      = new DirectPoseApplier(vrm, this._calibration);
    this.faceApplier  = new FaceApplier(vrm);
    this.session      = new MocapBvhSession(vrm, (name) => this.applier.getQuaternion(name));

    this._calibration.onStatusChange = (s) => this.onCalibrationChange?.(s);
    this._calibration.setChainScaleEnabled(readStorageToggle(CHAIN_SCALE_STORAGE_KEY));
    const storedArmBack = readStorageNumber(ARM_BACK_LIMIT_STORAGE_KEY);
    if (storedArmBack !== null) this.applier.setArmBackLimitDeg(storedArmBack);

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
  get frameCount():         number            { return this.session.live.frameCount; }
  get recordingFrameCount(): number           { return this.session.live.frameCount; }
  get grabbedFrameCount():   number           { return this.session.grab.frameCount; }
  get currentTime():        number            { return this.detector.currentTime; }
  get duration():           number            { return this.detector.duration; }
  get isPaused():           boolean           { return this.detector.isPaused; }
  get latestFrame():        PoseFrame | null  { return this._latestFrame; }
  get videoElement():       HTMLVideoElement  { return this.detector.video; }
  /** True while a video file is being converted (either pipeline). */
  get isFileCapture():      boolean           { return this._fileCaptureActive; }
  /** Two-pass conversion progress, null outside two-pass file capture. */
  get fileCaptureProgress(): FileCaptureProgress | null { return this._fileProgress; }

  /** Attach / detach the preview canvas. Call after startLive(). */
  setCanvas(canvas: HTMLCanvasElement | null): void {
    this.detector.setCanvas(canvas);
  }

  private _captureFixedFileFrame(): boolean {
    this._frameRecorded = this.session.captureFixedFileFrame();
    if (this._frameRecorded) this._captureFaceFrame();
    return this._frameRecorded;
  }

  /** Sample the current expression values for the face sidecar, 1:1 with the
   *  BVH frame just recorded. */
  private _captureFaceFrame(): void {
    if (this.faceApplier.enabled) this._faceTrack.push(this.faceApplier.currentExpressions());
  }

  /** The just-recorded face track, or null when empty / no expression motion.
   *  Consumed by the player to drive expressions during BVH replay. */
  getLastFaceTrack(): FaceTrack | null {
    const track = { fps: BVH_FRAME_RATE, frames: this._faceTrack };
    return this._faceTrack.length && faceTrackHasMotion(track) ? track : null;
  }

  /** Publish the captured face track as a sidecar handle (null when empty /
   *  no expression motion). Headless tools read window.__mocapLastFaceTrack. */
  private _publishFaceTrack(): void {
    const track = this.getLastFaceTrack();
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__mocapLastFaceTrack =
        track ? serializeFaceTrack(track) : null;
    }
  }

  private _nextAnimationFrame(): Promise<void> {
    if (typeof requestAnimationFrame !== 'function') {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  private async _awaitRenderedFixedFileCapture(timeSec: number): Promise<void> {
    this._fixedFileFramePending = shouldRecordAfterPreroll(
      timeSec,
      this._fileCaptureCalibrationPrerollSec,
    );
    await this._nextAnimationFrame();
    await this._nextAnimationFrame();
    if (this._fixedFileFramePending && this._state === 'recording') {
      this.captureRecordedFrame();
    }
  }

  /**
   * Two-pass file capture. Pass A seeks through the video and collects RAW
   * landmarks (no online filtering — no per-frame render waits either, so it
   * runs at decode speed). The buffer is then gap-filled and smoothed with a
   * zero-phase low-pass (no lag, unlike the causal live filters). Pass B
   * replays the smoothed frames through calibration + applier at render pace,
   * capturing each rendered pose into the BVH session exactly like the
   * single-pass path. Returns false when stopped early.
   */
  private async _runTwoPassFileCapture(file: File): Promise<boolean> {
    const collected = await this.detector.collectFileFramesAtFixedFps(file, {
      fps: BVH_FRAME_RATE,
      cropRedetect: this._cropRedetectEnabled,
      afterFrame: (_timeSec, frameIndex) => {
        const total = Math.max(
          frameIndex + 1,
          Math.round((this.detector.duration || 0) * BVH_FRAME_RATE),
        );
        this._fileProgress = { phase: 'analyze', frameIndex, totalFrames: total };
        if (frameIndex % 60 === 0) console.info(`[mocap:two-pass] pass A frame ${frameIndex}`);
      },
    });
    if (!collected.completed || this._state !== 'recording') return false;

    const detected = collected.frames.filter(Boolean).length;
    console.info(
      `[mocap:two-pass] pass A done: ${detected}/${collected.frames.length} frames detected`,
    );

    // Trusted-geometry profile only when the LOWER BODY is credibly visible.
    // Half-body footage gives hallucinated legs; lifting them or deriving the
    // hip height from fake ankles dismantles the pose — fall back to the
    // guarded live-style heuristics instead.
    const coverage = fullBodyCoverage(collected.frames);
    const trusted = coverage >= FULL_BODY_COVERAGE_MIN;
    this.applier.setTrustedInputMode(trusted);
    console.info(
      `[mocap:two-pass] full-body coverage ${(coverage * 100).toFixed(0)}% → ` +
      `${trusted ? 'trusted-geometry' : 'guarded-heuristics'} retarget`,
    );

    // Temporal 3D lifting: replace MediaPipe's per-frame depth-guessed world
    // landmarks with MotionBERT's trajectory-lifted 3D before smoothing.
    let lifted = false;
    if (this._liftingEnabled && trusted) {
      this._fileProgress = { phase: 'lift', frameIndex: 0, totalFrames: collected.frames.length };
      if (await this._lifter.init()) {
        lifted = await this._lifter.liftSequence(collected.frames, collected.aspect);
      }
      if (this._state !== 'recording') return false;
    }
    // Honest torso depth is earned by a successful lift, not by coverage: a
    // full-body clip whose lift was disabled or failed still carries noisy raw
    // MediaPipe z, and trusting it over-rotates the torso. Keep it damped unless
    // the lifter actually replaced the depth signal.
    this.applier.setTorsoDepthTrusted(lifted);

    // Torso depth de-bias (lifted only): the lifter places shoulders a
    // constant ~12 deg behind the hips even for a straight performer, tipping
    // the avatar backward with the arms trailing. Centre the sequence on its
    // median torso lean. This bias is a lifter artefact — on un-lifted raw z the
    // median lean is the performer's real posture, so only de-bias when lifted.
    if (lifted) {
      const biasRad = debiasTorsoLean(collected.frames);
      if (biasRad !== 0) {
        console.info(`[mocap:two-pass] torso de-bias ${(biasRad * 180 / Math.PI).toFixed(1)}deg`);
      }
      // Same lifter artefact for the legs: ankles sit a constant distance behind
      // the hips, swinging the legs back once the torso is straightened.
      const legBiasRad = debiasLegLean(collected.frames);
      if (legBiasRad !== 0) {
        console.info(`[mocap:two-pass] leg de-bias ${(legBiasRad * 180 / Math.PI).toFixed(1)}deg`);
      }
    }

    // Diagnostic dump for the offline tools (landmarks-vs-gt, visibility
    // analysis): world landmarks (lifted when the lifter ran) + raw 2D with
    // visibility. Written in BOTH retarget profiles.
    (window as unknown as Record<string, unknown>).__mocapLiftedDump = {
      fps: BVH_FRAME_RATE,
      aspect: collected.aspect,
      coverage,
      frames: collected.frames.map((f) =>
        f ? f.worldLandmarks.map((lm) => [lm.x, lm.y, lm.z]) : null,
      ),
      rawNorm: collected.frames.map((f) =>
        f ? f.landmarks.map((lm) => [lm.x, lm.y, lm.visibility ?? 1]) : null,
      ),
    };

    this._fileProgress = { phase: 'smooth', frameIndex: 0, totalFrames: collected.frames.length };
    const smoothed = smoothMocapFrames(collected.frames, { fps: BVH_FRAME_RATE });

    // Auto-trim idle/empty head and tail (performer not yet in frame, settling
    // into rest, holding still at the end). Only the static bookends go.
    let frames = smoothed;
    if (this._autoTrimEnabled) {
      const range = autoTrimRange(smoothed);
      if (range.start > 0 || range.end < smoothed.length) {
        console.info(`[mocap:two-pass] auto-trim ${smoothed.length} → frames [${range.start},${range.end})`);
        frames = smoothed.slice(range.start, range.end);
      }
    }
    // Offline calibration: measure the performer ONCE over the whole (smoothed,
    // trimmed) clip — the exact frames pass B replays — as a robust median
    // instead of a converging per-frame EMA. Locks the size so the replay loop's
    // feed() calls can't re-drift it. Makes the body size deterministic per clip
    // (no noisy warm-up), so limb position targets are consistent run to run.
    this._calibration.calibrateFromClip(frames);
    console.info(
      `[mocap:two-pass] offline calibration: bodyScale=${this._calibration.bodyScale().toFixed(3)} ` +
      `legScale=${this._calibration.legScale().toFixed(3)}`,
    );

    console.info('[mocap:two-pass] pass B: replaying smoothed frames');

    for (let i = 0; i < frames.length; i++) {
      if (this._state !== 'recording') return false;
      this._fileProgress = { phase: 'replay', frameIndex: i, totalFrames: frames.length };
      const frame = frames[i];
      if (frame) {
        this._calibration.feed(frame);
        this._latestFrame = frame;
        this._frameRecorded = false;
      }
      // Nothing detected yet — nothing to apply or record (matches the
      // single-pass behaviour before the first detection).
      if (!this._latestFrame) continue;
      await this._awaitRenderedFixedFileCapture(i / BVH_FRAME_RATE);
    }

    // Final cleanup in quaternion space: the palm-orientation solve amplifies
    // residual landmark noise into wrist swings that landmark smoothing can't
    // reach. See bvhRotationSmoother.
    this.session.smoothRecordedRotations();
    return true;
  }

  // ── Debug knobs ────────────────────────────────────────────────────────────

  setPoseQuality(q: PoseModelQuality): Promise<void> { return this.detector.setPoseQuality(q); }
  get poseQuality(): PoseModelQuality { return this.detector.poseQuality; }

  setFilterEnabled(v: boolean): void { this.detector.setFilterEnabled(v); }
  get filterEnabled(): boolean { return this.detector.filterEnabled; }

  setOfflineSmoothingEnabled(v: boolean): void {
    this._offlineSmoothingEnabled = v; persistToggle(OFFLINE_SMOOTHING_STORAGE_KEY, v);
  }
  get offlineSmoothingEnabled(): boolean { return this._offlineSmoothingEnabled; }

  // Two-pass pipeline stage toggles. Each updates the live field AND persists,
  // so a change applies to the next conversion without a reload. See the
  // Pipeline rows in the capture UI.
  setLiftingEnabled(v: boolean): void { this._liftingEnabled = v; persistToggle(LIFTING_STORAGE_KEY, v); }
  get liftingEnabled(): boolean { return this._liftingEnabled; }

  setCropRedetectEnabled(v: boolean): void { this._cropRedetectEnabled = v; persistToggle(CROP_REDETECT_STORAGE_KEY, v); }
  get cropRedetectEnabled(): boolean { return this._cropRedetectEnabled; }

  setAutoTrimEnabled(v: boolean): void { this._autoTrimEnabled = v; persistToggle(AUTO_TRIM_STORAGE_KEY, v); }
  get autoTrimEnabled(): boolean { return this._autoTrimEnabled; }

  setChainScaleEnabled(v: boolean): void {
    this._calibration.setChainScaleEnabled(v); persistToggle(CHAIN_SCALE_STORAGE_KEY, v);
  }
  get chainScaleEnabled(): boolean { return this._calibration.chainScaleEnabled; }

  setFileCaptureCalibrationPrerollSec(sec: number): void {
    this._fileCaptureCalibrationPrerollSec = Number.isFinite(sec)
      ? Math.max(0, Math.min(5, sec))
      : DEFAULT_FILE_CAPTURE_CALIBRATION_PREROLL_SEC;
  }
  get fileCaptureCalibrationPrerollSec(): number { return this._fileCaptureCalibrationPrerollSec; }

  setBodyStabilizerSettings(options: LandmarkStabilizerOptions): void {
    this.detector.setBodyStabilizerSettings(options);
  }
  get stabilizerSettings(): PoseStabilizerSettings { return this.detector.stabilizerSettings; }

  setHandStabilizerSettings(options: LandmarkStabilizerOptions): void {
    this.detector.setHandStabilizerSettings(options);
  }

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

  setSymmetryFallback(v: boolean): void { this.applier.setSymmetryFallback(v); }
  get symmetryFallback(): boolean { return this.applier.symmetryFallback; }

  setBodySmoothing(v: number): void { this.applier.setBodySmoothing(v); }
  get bodySmoothing(): number { return this.applier.bodySmoothing; }

  setSpineSmoothing(v: number): void { this.applier.setSpineSmoothing(v); }
  get spineSmoothing(): number { return this.applier.spineSmoothing; }

  setArmZAttenuation(v: number): void { this.applier.setArmZAttenuation(v); }
  get armZAttenuation(): number { return this.applier.armZAttenuation; }

  setArmBackLimitDeg(v: number): void {
    this.applier.setArmBackLimitDeg(v);
    try { localStorage.setItem(ARM_BACK_LIMIT_STORAGE_KEY, String(this.applier.armBackLimitDeg)); } catch { /* private mode */ }
  }
  get armBackLimitDeg(): number { return this.applier.armBackLimitDeg; }

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
   * 'recording' state. Reads bone.quaternion *now* after clamp + overlays, and
   * samples at the BVH recorder's fixed 30 Hz clock. We do not gate on "new
   * detector frame" here: if pose detection runs at 12-20 fps, repeating the
   * latest pose is what preserves playback speed.
   */
  captureRecordedFrame(): void {
    if (this._state !== 'recording') return;
    if (!this._latestFrame) return;

    if (this._fixedFileCaptureActive) {
      if (!this._fixedFileFramePending) return;
      this._captureFixedFileFrame();
      this._fixedFileFramePending = false;
      return;
    }

    const accepted = this.session.addCurrentPoseFrame(this.session.live);
    if (!accepted) return;

    // Keep a parallel internal-roundtrip stream whose x/z convention cancels
    // the loader's VRM0 conversion. This is what we auto-replay and save for
    // drag-and-drop back into this player.
    if (this.session.replay) {
      this.session.captureCurrentPoseFrame(this.session.replay);
    }
    this._frameRecorded = true;
    this._captureFaceFrame();
    this.session.snapshotIfNewFrame();
  }

  // ── Round-trip verification API ────────────────────────────────────────────

  /** Begin collecting expected-side pose snapshots alongside the live recorder. */
  startVerifyCapture(): void { this.session.startVerifyCapture(); }

  /** Stop collecting and return the captured snapshots (one per BVH frame). */
  stopVerifyCapture(): PoseSnapshot[] { return this.session.stopVerifyCapture(); }

  get verifyCapturing(): boolean { return this.session.verifyCapturing; }
  get verifyCapturedCount(): number { return this.session.verifyCapturedCount; }

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
    this.session.resetLive('internal-roundtrip');
    this.session.live.start();
    this._setState('recording');
  }

  /** Stop a verification recording and return the BVH text; no download, no onBvhReady. */
  stopVerifyRecording(): string {
    if (this._state !== 'recording') return '';
    const bvhText = this.session.live.stop();
    this.session.resetLive();
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
    this.session.resetLive('internal-roundtrip');

    this.session.startVerifyCapture();

    const tickInterval = onProgress
      ? window.setInterval(() => onProgress(this.verifyCapturedCount), 150)
      : 0;

    return new Promise<{ bvh: string; expected: PoseSnapshot[] }>((resolve, reject) => {
      this.detector.onEnd = () => {
        const bvhText = this.session.live.stop();
        const expected = this.session.stopVerifyCapture();
        if (tickInterval) clearInterval(tickInterval);
        this._teardownFileCapture();
        this.session.resetLive();
        this._setState('off');
        resolve({ bvh: bvhText, expected });
      };

      this.detector.startFromFile(file).then(
        () => {
          this.session.live.start();
          this._setState('recording');
        },
        (err) => {
          if (tickInterval) clearInterval(tickInterval);
          this.session.stopVerifyCapture();
          this.detector.stop();
          this._teardownFileCapture();
          this.session.resetLive();
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

  // ── Calibration & diagnostics ───────────────────────────────────────────────

  get calibration(): MocapCalibration { return this._calibration; }
  get hipsBaseWorld() { return this.applier.hipsBaseWorld; }
  get debugTargets() { return this.applier.debugTargets; }

  /** Per-chain visibility-loss state (D1-lite). Passthrough from the applier. */
  getTrackingHealth() { return this.applier.getTrackingHealth(); }

  /** IK target reach as % of avatar limb length, per side. See mocapInspector. */
  getReachPercent(): ReachPercent {
    return getReachPercent(this._vrm, this._calibration, this.applier.debugTargets);
  }

  /** Console dump: performer landmarks vs avatar skeleton vs calibration. */
  dumpSkeleton(): void {
    dumpSkeleton({
      vrm: this._vrm,
      cal: this._calibration,
      frame: this._latestFrame,
      debugTargets: this.applier.debugTargets,
    });
  }

  /** World positions of the avatar's hand / foot bones — used to compare against
   *  IK targets for fit statistics. */
  getActualBonePositions(): ReturnType<typeof getActualBonePositions> {
    return getActualBonePositions(this._vrm);
  }

  /** World positions of key avatar joints for side-by-side pose diagnostics. */
  getAvatarJointPositions(kind: 'normalized' | 'raw' = 'normalized'): AvatarJointPositionMap {
    return getAvatarJointPositions(this._vrm, kind);
  }

  /** Multi-section BVH diagnostic text for the debug modal. */
  getBvhDiagnosticText(): string {
    return buildBvhDiagnosticText({
      vrm: this._vrm,
      state: this._state,
      getJointOffset: (name) => this.session.getBvhJointOffset(name),
      getApplierRestAxis: (name) => this.applier.getRestAxis(name),
      captureCurrentPoseBvh: () => {
        const recorder = this.session.createRecorder();
        this.session.captureCurrentPoseFrame(recorder);
        return recorder.stop();
      },
    });
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
    this.session.captureCurrentPoseFrame(this.session.grab);
  }

  /**
   * Flush whatever frames are in the recorder to a .bvh download, then clear.
   * Used to finalise a frame-by-frame session without needing state transitions.
   */
  flushGrabbed(): void {
    if (this.session.grab.frameCount === 0) return;
    const bvhText = this.session.grab.stop();
    const name    = this.session.nextRecordingName();
    downloadBvh(bvhText, `${name}.bvh`);
    this.onBvhReady?.(bvhText, name, { source: 'camera' });
  }

  /**
   * Export the avatar's current pose as a single-frame BVH without touching the
   * live recorder buffer. Safe to call during live preview or active recording.
   */
  exportCurrentPoseBvh(): PoseBvhExport {
    const poseRecorder = this.session.createRecorder();
    this.session.captureCurrentPoseFrame(poseRecorder);
    const bvhText = poseRecorder.stop();
    const name = this.session.nextPoseExportName();
    downloadBvh(bvhText, `${name}.bvh`);
    return { name, bvhText };
  }

  private _teardownFileCapture(): void {
    this._fixedFileCaptureActive = false;
    this._fixedFileFramePending = false;
    this._fileProgress = null;
    if (this._fileCaptureActive) {
      this.applier.setHighQualityMode(false);
      this.applier.setTrustedInputMode(false);
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
    this._faceTrack = [];
    if (this.saveCameraVideo) this._startCameraVideoRecording();
    this.session.live.start();
    this.session.startReplay();
    this._setState('recording');
  }

  /** Start a MediaRecorder on the live webcam stream so the raw footage can be
   *  saved alongside the BVH. No-op if there is no stream or no MediaRecorder. */
  private _startCameraVideoRecording(): void {
    this._camRecorder = null;
    this._camChunks = [];
    const stream = this.detector.cameraStream;
    if (!stream || typeof MediaRecorder === 'undefined') return;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported(t));
    try {
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      rec.ondataavailable = (e) => { if (e.data.size > 0) this._camChunks.push(e.data); };
      rec.start();
      this._camRecorder = rec;
    } catch {
      this._camRecorder = null; // codec/permission issue — skip video save silently
    }
  }

  /** Stop the camera MediaRecorder and download the footage as `${name}.webm`. */
  private _finishCameraVideoRecording(name: string): void {
    const rec = this._camRecorder;
    this._camRecorder = null;
    if (!rec) return;
    rec.onstop = () => {
      if (this._camChunks.length === 0) return;
      const blob = new Blob(this._camChunks, { type: rec.mimeType || 'video/webm' });
      this._camChunks = [];
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.webm` });
      a.click();
      URL.revokeObjectURL(url);
    };
    if (rec.state !== 'inactive') rec.stop();
  }

  /** Abort the camera recording without saving (discarded session). */
  private _discardCameraVideoRecording(): void {
    const rec = this._camRecorder;
    this._camRecorder = null;
    this._camChunks = [];
    if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); }
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
    const { name, replayText } = this.session.finishRecording('camera');
    this._publishFaceTrack();
    downloadBvh(replayText, `${name}.bvh`);
    this._finishCameraVideoRecording(name); // save the raw footage next to the BVH
    this.onBvhReady?.(replayText, name, { source: 'camera' });
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
    this._faceTrack = [];
    this._teardownFileCapture();

    // Recording from file: snap directly to detected pose, no torso dampening,
    // so the output BVH matches the source video instead of the smoothed preview.
    this.applier.setHighQualityMode(true);
    this._fileCaptureActive = true;
    this._fixedFileCaptureActive = true;

    try {
      this.session.live.start();
      this.session.startReplay();
      this._setState('recording');
      const completed = this._offlineSmoothingEnabled
        ? await this._runTwoPassFileCapture(file)
        : await this.detector.processFileAtFixedFps(file, {
            fps: BVH_FRAME_RATE,
            afterFrame: (timeSec) => this._awaitRenderedFixedFileCapture(timeSec),
          });
      if (!completed || this.state !== 'recording') return;

      const { name, replayText } = this.session.finishRecording('video');
      this._publishFaceTrack();
      downloadBvh(replayText, `${name}.bvh`);
      this.onBvhReady?.(replayText, name, {
        source: 'video',
        exportAgentOgiJson: this.exportAgentOgiJsonForVideo,
      });
      this._setState('off');
    } catch (err) {
      this.detector.stop();
      if (this.session.live.recording) this.session.live.stop();
      this.session.discardReplay();
      throw err;
    } finally {
      this._teardownFileCapture();
    }
  }

  /** Stop everything, close camera. */
  stop(): void {
    if (this._state === 'recording' && this.session.live.recording) this.session.live.stop(); // discard
    this._discardCameraVideoRecording();
    this.session.discardReplay();
    this._fixedFileFramePending = false;
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
