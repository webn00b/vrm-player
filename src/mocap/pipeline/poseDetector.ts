import {
  FilesetResolver,
  HolisticLandmarker,
  type HolisticLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { LandmarkStabilizer } from '../trackers/landmarkStabilizer';
import { LandmarkFilter } from '../trackers/oneEuroFilter';
import { fixedVideoFrameTimes } from './videoFrameTimes';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Landmark3D = { x: number; y: number; z: number; visibility?: number };

export type HandFrame = {
  side: 'Left' | 'Right';
  landmarks:      Landmark3D[];   // normalised (0-1)
  worldLandmarks: Landmark3D[];   // metres, origin at wrist
};

export type PoseFrame = {
  landmarks:      Landmark3D[];   // 33 body points, normalised
  worldLandmarks: Landmark3D[];   // 33 body points, metres
  faceLandmarks:  Landmark3D[];   // 478 face points, normalised (empty if no face)
  hands:          HandFrame[];    // 0-2 detected hands
};

// ── Model URL ─────────────────────────────────────────────────────────────────

const WASM_URL = '/mediapipe/wasm';

// HolisticLandmarker replaces the separate Pose + Hand detectors, matching
// sysAnimOnline's use of HolisticLandmarker for body+face+hands in one call.
const HOLISTIC_MODEL_URL = '/mediapipe/holistic_landmarker.task';

// Quality alias kept for API compatibility — affects internal pose model choice.
export type PoseModelQuality = 'lite' | 'full' | 'heavy';

export interface FixedVideoFileOptions {
  fps?: number;
  afterFrame?: (timeSec: number, frameIndex: number) => Promise<void> | void;
}

export const DEFAULT_FILE_CAPTURE_FPS = 30;

// ── Skeleton connections (for canvas preview) ─────────────────────────────────

const POSE_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

// ── PoseDetector ──────────────────────────────────────────────────────────────

/**
 * Runs MediaPipe HolisticLandmarker on each video frame.
 * Outputs a unified PoseFrame with body, face, and hand landmarks.
 *
 * Matches sysAnimOnline's use of HolisticLandmarker for a single-model
 * body+face+hands pipeline.
 */
export class PoseDetector {
  private holistic: HolisticLandmarker | null = null;
  private stream: MediaStream | null = null;
  readonly video: HTMLVideoElement;

  private _running  = false;
  private _paused   = false;
  private _rafId    = 0;
  private _lastTs   = -1;
  private _fileUrl: string | null = null;

  private _poseQuality: PoseModelQuality = 'full';
  private _filterEnabled = true;

  private _canvas: HTMLCanvasElement | null = null;
  private _ctx:    CanvasRenderingContext2D | null = null;

  // World landmarks (metres): high beta so fast arm/leg motion isn't lagged.
  // sysAnimOnline uses beta=1 for body pose — the 1€ filter becomes responsive
  // at speed and still smooths jitter at rest. Our previous beta=0.01 made it
  // basically a fixed low-pass at 1.5 Hz (no speed adaptation → visible lag).
  private _bodyWorldStabilizer = new LandmarkStabilizer(33);
  private _fBodyNorm  = new LandmarkFilter(33, 1.5, 0.1);
  private _fBodyWorld = new LandmarkFilter(33, 1.0, 0.8);
  // Face landmarks: slow-moving micro-expressions, keep heavily smoothed.
  private _fFace      = new LandmarkFilter(478, 1.0, 0.005);
  // Hand landmarks: sysAnimOnline uses beta≈0.001 (very stable) — hands need
  // extreme filtering to hide wrist-level detection noise.
  private _fHandNorm:  Record<'Left' | 'Right', LandmarkFilter> = {
    Left:  new LandmarkFilter(21, 1.5, 0.003),
    Right: new LandmarkFilter(21, 1.5, 0.003),
  };
  private _fHandWorld: Record<'Left' | 'Right', LandmarkFilter> = {
    Left:  new LandmarkFilter(21, 1.5, 0.003),
    Right: new LandmarkFilter(21, 1.5, 0.003),
  };
  private _handNormStabilizer: Record<'Left' | 'Right', LandmarkStabilizer> = {
    Left: new LandmarkStabilizer(21, {
      maxGapFrames: 2,
      maxStep: 0.12,
      maxZStep: 0.12,
    }),
    Right: new LandmarkStabilizer(21, {
      maxGapFrames: 2,
      maxStep: 0.12,
      maxZStep: 0.12,
    }),
  };
  private _handWorldStabilizer: Record<'Left' | 'Right', LandmarkStabilizer> = {
    Left: new LandmarkStabilizer(21, {
      maxGapFrames: 2,
      maxStep: 0.08,
      maxZStep: 0.08,
    }),
    Right: new LandmarkStabilizer(21, {
      maxGapFrames: 2,
      maxStep: 0.08,
      maxZStep: 0.08,
    }),
  };

  onFrame: ((frame: PoseFrame) => void) | null = null;
  onError: ((err: Error)       => void) | null = null;
  onEnd:   (() => void)        | null = null;

  get currentTime(): number { return this.video.currentTime; }
  get duration():    number  { return this.video.duration || 0; }

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  setCanvas(canvas: HTMLCanvasElement | null): void {
    this._canvas = canvas;
    this._ctx    = canvas ? canvas.getContext('2d') : null;
  }

  async setPoseQuality(q: PoseModelQuality): Promise<void> {
    if (this._poseQuality === q && this.holistic) return;
    this._poseQuality = q;
    if (this.holistic) {
      this.holistic.close();
      this.holistic = null;
      await this.init();
    }
  }

  setFilterEnabled(v: boolean): void { this._filterEnabled = v; }
  get filterEnabled(): boolean { return this._filterEnabled; }
  get poseQuality(): PoseModelQuality { return this._poseQuality; }

  async init(): Promise<void> {
    if (this.holistic) return;
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    this.holistic = await HolisticLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HOLISTIC_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
    });
  }

  async start(): Promise<void> {
    if (this._running) return;
    await this.init();

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });

    this.video.srcObject = this.stream;
    await new Promise<void>((res) => {
      this.video.onloadedmetadata = () => { this.video.play(); res(); };
    });

    this._running = true;
    this._tick();
  }

  async startFromFile(file: File): Promise<void> {
    if (this._running) return;
    await this.init();

    await this._openFile(file);

    this.video.onended = () => {
      this.stop();
      this.onEnd?.();
    };

    this.video.play();
    this._running = true;
    this._tick();
  }

  async processFileAtFixedFps(file: File, options: FixedVideoFileOptions = {}): Promise<boolean> {
    if (this._running) return false;
    await this.init();
    await this._openFile(file);

    const fps = options.fps ?? DEFAULT_FILE_CAPTURE_FPS;
    const times = fixedVideoFrameTimes(this.video.duration || 0, fps);
    let completed = true;
    this._running = true;

    try {
      for (let frameIndex = 0; frameIndex < times.length; frameIndex++) {
        const time = times[frameIndex];
        if (!this._running) {
          completed = false;
          break;
        }
        await this._seekFileVideo(time);
        if (!this._running) {
          completed = false;
          break;
        }
        this._detectOnce(Math.round(time * 1000));
        await options.afterFrame?.(time, frameIndex);
      }
    } finally {
      const wasRunning = this._running;
      this.stop();
      completed = completed && wasRunning;
    }

    return completed;
  }

  pause(): void {
    if (!this._running || this._paused) return;
    this._paused = true;
    if (!this.stream) this.video.pause();
  }

  resume(): void {
    if (!this._running || !this._paused) return;
    this._paused = false;
    if (!this.stream) this.video.play().catch(() => {/* ignore */});
  }

  get isPaused(): boolean { return this._paused; }

  async stepFrame(deltaSec: number): Promise<void> {
    if (!this._running || !this._paused || !this._fileUrl) return;
    const duration = this.video.duration || 0;
    const next = Math.max(0, Math.min(duration, this.video.currentTime + deltaSec));
    await new Promise<void>((res) => {
      const onSeeked = (): void => { this.video.removeEventListener('seeked', onSeeked); res(); };
      this.video.addEventListener('seeked', onSeeked);
      this.video.currentTime = next;
    });
    this._detectOnce(Math.round(next * 1000));
  }

  stop(): void {
    this._running = false;
    this._paused  = false;
    cancelAnimationFrame(this._rafId);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.video.onended = null;
    if (this._fileUrl) {
      this.video.pause();
      this.video.src = '';
      URL.revokeObjectURL(this._fileUrl);
      this._fileUrl = null;
    }
    this._bodyWorldStabilizer.reset();
    this._fBodyNorm.reset();  this._fBodyWorld.reset();
    this._fFace.reset();
    this._fHandNorm.Left.reset();  this._fHandNorm.Right.reset();
    this._fHandWorld.Left.reset(); this._fHandWorld.Right.reset();
    this._handNormStabilizer.Left.reset();  this._handNormStabilizer.Right.reset();
    this._handWorldStabilizer.Left.reset(); this._handWorldStabilizer.Right.reset();
  }

  dispose(): void {
    this.stop();
    this.onFrame = null;
    this.onError = null;
    this.onEnd = null;
    this.holistic?.close();
    this.holistic = null;
    this._ctx = null;
    this._canvas = null;
  }

  private _tick = (): void => {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(this._tick);
    if (this._paused) return;
    if (this.video.readyState < 2) return;
    const now = performance.now();
    if (now === this._lastTs) return;
    this._lastTs = now;
    this._detectOnce();
  };

  private async _openFile(file: File): Promise<void> {
    this._fileUrl       = URL.createObjectURL(file);
    this.video.src      = this._fileUrl;
    this.video.muted    = true;
    this.video.loop     = false;
    this.video.playsInline = true;

    await new Promise<void>((res, rej) => {
      this.video.onloadedmetadata = () => res();
      this.video.onerror = () => rej(new Error('Failed to load video file'));
    });
  }

  private async _seekFileVideo(timeSec: number): Promise<void> {
    const duration = this.video.duration || 0;
    const target = Math.max(0, Math.min(duration, timeSec));
    if (Math.abs(this.video.currentTime - target) < 0.002 && this.video.readyState >= 2) return;
    await new Promise<void>((res) => {
      const onSeeked = (): void => {
        this.video.removeEventListener('seeked', onSeeked);
        res();
      };
      this.video.addEventListener('seeked', onSeeked);
      this.video.currentTime = target;
    });
  }

  private _detectOnce(timestampMs = performance.now()): void {
    if (this.video.readyState < 2) return;
    try {
      const result: HolisticLandmarkerResult =
        this.holistic!.detectForVideo(this.video, timestampMs);

      if (!result.poseLandmarks.length || !this.onFrame) return;

      const tSec = timestampMs / 1000;

      const rawBodyNorm  = result.poseLandmarks[0]      as Landmark3D[];
      const rawBodyWorld = result.poseWorldLandmarks[0] as Landmark3D[];

      // World landmarks have no visibility field in HolisticLandmarker — copy from
      // normalized landmarks so downstream visibility gates work correctly.
      for (let i = 0; i < rawBodyWorld.length; i++) {
        if (rawBodyWorld[i] && rawBodyNorm[i]?.visibility !== undefined) {
          (rawBodyWorld[i] as Landmark3D).visibility = rawBodyNorm[i].visibility;
        }
      }

      const bodyNorm  = this._filterEnabled ? this._fBodyNorm.filter (rawBodyNorm,  tSec) : rawBodyNorm;
      const stableBodyWorld = this._filterEnabled
        ? this._bodyWorldStabilizer.stabilize(rawBodyWorld, tSec)
        : rawBodyWorld;
      const bodyWorld = this._filterEnabled ? this._fBodyWorld.filter(stableBodyWorld, tSec) : stableBodyWorld;

      const rawFace = (result.faceLandmarks[0] ?? []) as Landmark3D[];
      const faceLandmarks = (rawFace.length && this._filterEnabled)
        ? this._fFace.filter(rawFace, tSec)
        : rawFace;

      // HolisticLandmarker returns separate left/right hand arrays (from the
      // perspective of the person, not the camera — matching sysAnimOnline).
      const hands: HandFrame[] = [];

      const addHand = (
        norm: Landmark3D[],
        world: Landmark3D[],
        side: 'Left' | 'Right',
      ): void => {
        if (!norm.length) {
          this._handNormStabilizer[side].markMissing();
          this._handWorldStabilizer[side].markMissing();
          return;
        }
        const stableNorm = this._filterEnabled
          ? this._handNormStabilizer[side].stabilize(norm, tSec)
          : norm;
        const stableWorld = this._filterEnabled && world.length
          ? this._handWorldStabilizer[side].stabilize(world, tSec)
          : world;
        if (!world.length) this._handWorldStabilizer[side].markMissing();
        hands.push({
          side,
          landmarks:      this._filterEnabled ? this._fHandNorm [side].filter(stableNorm,  tSec) : stableNorm,
          worldLandmarks: this._filterEnabled ? this._fHandWorld[side].filter(stableWorld, tSec) : stableWorld,
        });
      };

      // Self-view (selfie) mirror: person's LEFT hand appears on the RIGHT side
      // of the screen → drives avatar's RIGHT arm, and vice versa.
      // Flip labels to match body tracking, which also mirrors L↔R via LIMB_BONES.
      // Matches sysAnimOnline's explicit LR flip for holistic hand landmarks.
      addHand(
        (result.leftHandLandmarks[0]      ?? []) as Landmark3D[],
        (result.leftHandWorldLandmarks[0] ?? []) as Landmark3D[],
        'Right',  // person's left → avatar's right
      );
      addHand(
        (result.rightHandLandmarks[0]      ?? []) as Landmark3D[],
        (result.rightHandWorldLandmarks[0] ?? []) as Landmark3D[],
        'Left',   // person's right → avatar's left
      );

      const frame: PoseFrame = { landmarks: bodyNorm, worldLandmarks: bodyWorld, faceLandmarks, hands };

      if (this._canvas && this._ctx) this._draw(frame, result);

      this.onFrame(frame);
    } catch (e) {
      this.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private _draw(frame: PoseFrame, result: HolisticLandmarkerResult): void {
    const canvas = this._canvas!;
    const ctx    = this._ctx!;
    const w = canvas.width;
    const h = canvas.height;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, -w, 0, w, h);
    ctx.restore();

    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, w, h);

    // Body skeleton
    this._drawConnections(ctx, frame.landmarks, POSE_CONNECTIONS, w, h, '#00e5ff', 1.5);
    this._drawDots(ctx, frame.landmarks, w, h, '#00e5ff', 2.5);

    // Face mesh (sparse — just dots)
    if (frame.faceLandmarks.length > 0) {
      ctx.fillStyle = 'rgba(255,200,100,0.5)';
      for (const lm of frame.faceLandmarks) {
        ctx.beginPath();
        ctx.arc((1 - lm.x) * w, lm.y * h, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Hands
    const handColors = ['#ffee00', '#ff6ec7'];
    const allHands = [
      result.leftHandLandmarks[0],
      result.rightHandLandmarks[0],
    ].filter(Boolean);

    for (let i = 0; i < allHands.length; i++) {
      const lms = allHands[i] as Landmark3D[];
      this._drawConnections(ctx, lms, HAND_CONNECTIONS, w, h, handColors[i % 2], 1.2);
      this._drawDots(ctx, lms, w, h, handColors[i % 2], 2);
    }
  }

  private _drawConnections(
    ctx: CanvasRenderingContext2D,
    lms: Landmark3D[],
    connections: [number, number][],
    w: number, h: number,
    color: string,
    lineWidth: number,
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const [a, b] of connections) {
      const la = lms[a]; const lb = lms[b];
      if (!la || !lb) continue;
      if ((la.visibility ?? 1) < 0.3 || (lb.visibility ?? 1) < 0.3) continue;
      ctx.moveTo((1 - la.x) * w, la.y * h);
      ctx.lineTo((1 - lb.x) * w, lb.y * h);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private _drawDots(
    ctx: CanvasRenderingContext2D,
    lms: Landmark3D[],
    w: number, h: number,
    color: string,
    r: number,
  ): void {
    ctx.fillStyle = color;
    for (const lm of lms) {
      if ((lm.visibility ?? 1) < 0.3) continue;
      ctx.beginPath();
      ctx.arc((1 - lm.x) * w, lm.y * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
