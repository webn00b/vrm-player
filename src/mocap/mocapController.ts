import type { VRM } from '@pixiv/three-vrm';
import { PoseDetector, type PoseModelQuality } from './poseDetector';
import { DirectPoseApplier } from './directPoseApplier';
import { BvhRecorder, downloadBvh } from './bvhRecorder';
import { MocapCalibration, type CalibrationStatus } from './mocapCalibration';

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
  private recorder: BvhRecorder;
  private _calibration: MocapCalibration;

  private _state: MocapState = 'off';
  private _recordingIndex = 0;

  onStateChange:          ((state: MocapState) => void) | null = null;
  onError:                ((err: Error)         => void) | null = null;
  onBvhReady:             ((bvh: string, name: string) => void) | null = null;
  onCalibrationChange:    ((s: CalibrationStatus) => void) | null = null;

  constructor(vrm: VRM, videoEl: HTMLVideoElement) {
    this.detector     = new PoseDetector(videoEl);
    this._calibration = new MocapCalibration(vrm);
    this.applier      = new DirectPoseApplier(vrm, this._calibration);
    this.recorder     = new BvhRecorder();

    this._calibration.onStatusChange = (s) => this.onCalibrationChange?.(s);

    this.detector.onFrame = (frame) => {
      // Auto-calibration accumulates samples until it has enough, then freezes.
      this._calibration.feed(frame);

      // Apply pose to VRM (IK on arms once calibrated, angle-based fallback otherwise)
      this.applier.apply(frame);

      // Buffer for BVH if recording
      if (this._state === 'recording') {
        this.recorder.addFrame((name) => this.applier.getQuaternion(name));
      }
    };

    this.detector.onError = (err) => {
      console.error('[mocap]', err);
      this.onError?.(err);
    };
  }

  get state():       MocapState { return this._state; }
  get frameCount():  number     { return this.recorder.frameCount; }
  get currentTime(): number     { return this.detector.currentTime; }
  get duration():    number     { return this.detector.duration; }
  get isPaused():    boolean    { return this.detector.isPaused; }

  /** Attach / detach the preview canvas. Call after startLive(). */
  setCanvas(canvas: HTMLCanvasElement | null): void {
    this.detector.setCanvas(canvas);
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

  // ── Calibration ────────────────────────────────────────────────────────────

  get calibration(): MocapCalibration { return this._calibration; }
  /** Clear calibration samples — next high-visibility frames re-calibrate. */
  recalibrate(): void { this._calibration.recalibrate(); }

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
    this.recorder.captureFrame((name) => this.applier.getQuaternion(name));
  }

  /**
   * Flush whatever frames are in the recorder to a .bvh download, then clear.
   * Used to finalise a frame-by-frame session without needing state transitions.
   */
  flushGrabbed(): void {
    if (this.recorder.frameCount === 0) return;
    const bvhText = this.recorder.stop();
    const name    = `mocap_${++this._recordingIndex}`;
    downloadBvh(bvhText, `${name}.bvh`);
    this.onBvhReady?.(bvhText, name);
  }

  // ── State transitions ──────────────────────────────────────────────────────

  /** Start camera + live pose preview. */
  async startLive(): Promise<void> {
    if (this._state !== 'off') return;
    await this.detector.start();
    this._setState('live');
  }

  /** Begin recording (must be in 'live' state first). */
  startRecording(): void {
    if (this._state !== 'live') return;
    this.recorder.start();
    this._setState('recording');
  }

  /**
   * Stop recording, generate BVH, trigger download, and notify via onBvhReady.
   * Returns to 'live' state.
   */
  stopRecording(): void {
    if (this._state !== 'recording') return;
    const bvhText = this.recorder.stop();
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

    // Recording from file: snap directly to detected pose, no torso dampening,
    // so the output BVH matches the source video instead of the smoothed preview.
    this.applier.setHighQualityMode(true);

    this.detector.onEnd = () => {
      const bvhText = this.recorder.stop();
      const name    = `mocap_${++this._recordingIndex}`;
      downloadBvh(bvhText, `${name}.bvh`);
      this.onBvhReady?.(bvhText, name);
      this.applier.setHighQualityMode(false); // restore smoothing for next session
      this._setState('off');
    };

    await this.detector.startFromFile(file);
    this.recorder.start();
    this._setState('recording');
  }

  /** Stop everything, close camera. */
  stop(): void {
    if (this._state === 'recording') this.recorder.stop(); // discard
    this.detector.stop();
    this._setState('off');
  }

  private _setState(s: MocapState): void {
    this._state = s;
    this.onStateChange?.(s);
  }
}
