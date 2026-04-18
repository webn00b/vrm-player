import {
  FilesetResolver,
  PoseLandmarker,
  HandLandmarker,
  type PoseLandmarkerResult,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { LandmarkFilter } from './oneEuroFilter';

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
  hands:          HandFrame[];    // 0-2 detected hands
};

// ── Model URLs ────────────────────────────────────────────────────────────────

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';

export type PoseModelQuality = 'lite' | 'full' | 'heavy';

const POSE_MODEL_URLS: Record<PoseModelQuality, string> = {
  lite:  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full:  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// ── Skeleton connections ──────────────────────────────────────────────────────

const POSE_CONNECTIONS: [number, number][] = [
  // Face outline
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // Right arm
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // Left leg
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  // Right leg
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],          // index
  [0, 9], [9, 10], [10, 11], [11, 12],     // middle
  [0, 13], [13, 14], [14, 15], [15, 16],   // ring
  [0, 17], [17, 18], [18, 19], [19, 20],   // pinky
  [5, 9], [9, 13], [13, 17],               // palm knuckles
];

// ── PoseDetector ──────────────────────────────────────────────────────────────

/**
 * Runs MediaPipe Pose Landmarker + Hand Landmarker on the same video frame.
 * Emits a unified PoseFrame each RAF tick.
 * Optionally renders the annotated feed onto a provided canvas.
 */
export class PoseDetector {
  private poseLandmarker: PoseLandmarker | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  readonly video: HTMLVideoElement;

  private _running  = false;
  private _paused   = false;
  private _rafId    = 0;
  private _lastTs   = -1;
  private _fileUrl: string | null = null;

  // Configuration — change via setters before calling start/startFromFile
  private _poseQuality: PoseModelQuality = 'full';
  private _filterEnabled = true;

  private _canvas: HTMLCanvasElement | null = null;
  private _ctx:    CanvasRenderingContext2D | null = null;

  // Adaptive low-pass filters per stream. Separate instances so state doesn't
  // leak between normalised / world / left-hand / right-hand landmark sets.
  private _fBodyNorm  = new LandmarkFilter(33, 1.5, 0.01);
  private _fBodyWorld = new LandmarkFilter(33, 1.5, 0.01);
  // Hands: keyed by side so MediaPipe re-ordering between frames doesn't scramble state
  private _fHandNorm:  Record<'Left' | 'Right', LandmarkFilter> = {
    Left:  new LandmarkFilter(21, 2.0, 0.02),
    Right: new LandmarkFilter(21, 2.0, 0.02),
  };
  private _fHandWorld: Record<'Left' | 'Right', LandmarkFilter> = {
    Left:  new LandmarkFilter(21, 2.0, 0.02),
    Right: new LandmarkFilter(21, 2.0, 0.02),
  };

  onFrame: ((frame: PoseFrame) => void) | null = null;
  onError: ((err: Error)       => void) | null = null;
  onEnd:   (() => void)        | null = null;

  get currentTime(): number { return this.video.currentTime; }
  get duration():    number  { return this.video.duration || 0; }

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  /** Attach / detach the preview canvas. */
  setCanvas(canvas: HTMLCanvasElement | null): void {
    this._canvas = canvas;
    this._ctx    = canvas ? canvas.getContext('2d') : null;
  }

  /** Choose pose-detection model. Must be called before start/startFromFile.
   *  If the model is already loaded and quality differs, reloads the pose model. */
  async setPoseQuality(q: PoseModelQuality): Promise<void> {
    if (this._poseQuality === q && this.poseLandmarker) return;
    this._poseQuality = q;
    if (this.poseLandmarker) {
      this.poseLandmarker.close();
      this.poseLandmarker = null;
      await this.init();
    }
  }

  /** Enable/disable OneEuroFilter smoothing on input landmarks. */
  setFilterEnabled(v: boolean): void { this._filterEnabled = v; }
  get filterEnabled(): boolean { return this._filterEnabled; }
  get poseQuality(): PoseModelQuality { return this._poseQuality; }

  async init(): Promise<void> {
    if (this.poseLandmarker && this.handLandmarker) return;

    const vision = await FilesetResolver.forVisionTasks(WASM_URL);

    const [pose, hand] = await Promise.all([
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: POSE_MODEL_URLS[this._poseQuality], delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      }),
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
      }),
    ]);

    this.poseLandmarker = pose;
    this.handLandmarker = hand;
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

  /** Start processing a video file. Records automatically; fires onEnd when done. */
  async startFromFile(file: File): Promise<void> {
    if (this._running) return;
    await this.init();

    this._fileUrl       = URL.createObjectURL(file);
    this.video.src      = this._fileUrl;
    this.video.muted    = true;
    this.video.loop     = false;
    this.video.playsInline = true;

    await new Promise<void>((res, rej) => {
      this.video.onloadedmetadata = () => res();
      this.video.onerror = () => rej(new Error('Failed to load video file'));
    });

    this.video.onended = () => {
      this.stop();
      this.onEnd?.();
    };

    this.video.play();
    this._running = true;
    this._tick();
  }

  /** Pause detection + video playback. RAF keeps ticking but skips detect. */
  pause(): void {
    if (!this._running || this._paused) return;
    this._paused = true;
    if (!this.stream) this.video.pause();  // only file source supports video-level pause
  }

  /** Resume from pause. No-op if wasn't paused. */
  resume(): void {
    if (!this._running || !this._paused) return;
    this._paused = false;
    if (!this.stream) this.video.play().catch(() => {/* ignore */});
  }

  get isPaused(): boolean { return this._paused; }

  /**
   * Seek the video by the given delta in seconds (negative = rewind), run
   * detection on the resulting single frame. Only works when a file is the
   * source AND the detector is currently paused. Returns a promise that
   * resolves once detection has processed the new frame.
   */
  async stepFrame(deltaSec: number): Promise<void> {
    if (!this._running || !this._paused || !this._fileUrl) return;
    const duration = this.video.duration || 0;
    const next = Math.max(0, Math.min(duration, this.video.currentTime + deltaSec));
    // Need a 'seeked' event to know the frame is ready before we detect.
    await new Promise<void>((res) => {
      const onSeeked = (): void => { this.video.removeEventListener('seeked', onSeeked); res(); };
      this.video.addEventListener('seeked', onSeeked);
      this.video.currentTime = next;
    });
    // Force a detection pass on this frame (bypass _paused guard for one call).
    this._detectOnce();
  }

  stop(): void {
    this._running = false;
    this._paused  = false;
    cancelAnimationFrame(this._rafId);
    // Webcam
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    // File
    this.video.onended = null;
    if (this._fileUrl) {
      this.video.pause();
      this.video.src = '';
      URL.revokeObjectURL(this._fileUrl);
      this._fileUrl = null;
    }
    // Reset filters so next session starts clean
    this._fBodyNorm.reset();  this._fBodyWorld.reset();
    this._fHandNorm.Left.reset();  this._fHandNorm.Right.reset();
    this._fHandWorld.Left.reset(); this._fHandWorld.Right.reset();
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

  /**
   * Run one detect+emit cycle on the current video frame. Bypasses paused/
   * lastTs guards — used both by the RAF tick and by stepFrame().
   */
  private _detectOnce(): void {
    if (this.video.readyState < 2) return;

    const now = performance.now();
    try {
      const poseResult: PoseLandmarkerResult =
        this.poseLandmarker!.detectForVideo(this.video, now);

      const handResult: HandLandmarkerResult =
        this.handLandmarker!.detectForVideo(this.video, now);

      if (poseResult.landmarks.length === 0 || !this.onFrame) return;

      const tSec = now / 1000;
      const rawBodyNorm  = poseResult.landmarks[0]      as Landmark3D[];
      const rawBodyWorld = poseResult.worldLandmarks[0] as Landmark3D[];

      const bodyNorm  = this._filterEnabled ? this._fBodyNorm.filter (rawBodyNorm,  tSec) : rawBodyNorm;
      const bodyWorld = this._filterEnabled ? this._fBodyWorld.filter(rawBodyWorld, tSec) : rawBodyWorld;

      const hands: HandFrame[] = handResult.landmarks.map((lm, i) => {
        const side  = (handResult.handedness[i]?.[0]?.categoryName ?? 'Left') as 'Left' | 'Right';
        const rawN  = lm                                   as Landmark3D[];
        const rawW  = (handResult.worldLandmarks[i] ?? lm) as Landmark3D[];
        return {
          side,
          landmarks:      this._filterEnabled ? this._fHandNorm [side].filter(rawN, tSec) : rawN,
          worldLandmarks: this._filterEnabled ? this._fHandWorld[side].filter(rawW, tSec) : rawW,
        };
      });

      const frame: PoseFrame = {
        landmarks:      bodyNorm,
        worldLandmarks: bodyWorld,
        hands,
      };

      if (this._canvas && this._ctx) {
        this._draw(frame, handResult);
      }

      this.onFrame(frame);
    } catch (e) {
      this.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────────

  private _draw(frame: PoseFrame, handResult: HandLandmarkerResult): void {
    const canvas = this._canvas!;
    const ctx    = this._ctx!;
    const w = canvas.width;
    const h = canvas.height;

    // Mirror video (selfie view)
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, -w, 0, w, h);
    ctx.restore();

    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, w, h);

    // Pose skeleton — x mirrored for display to match flipped video
    this._drawConnections(ctx, frame.landmarks, POSE_CONNECTIONS, w, h, '#00e5ff', 1.5);
    this._drawDots(ctx, frame.landmarks, w, h, '#00e5ff', 2.5);

    // Hands
    for (let i = 0; i < frame.hands.length; i++) {
      const color = handResult.handedness[i]?.[0]?.categoryName === 'Right' ? '#ffee00' : '#ff6ec7';
      this._drawConnections(ctx, frame.hands[i].landmarks, HAND_CONNECTIONS, w, h, color, 1.2);
      this._drawDots(ctx, frame.hands[i].landmarks, w, h, color, 2);
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
      // mirror x to match flipped video
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
