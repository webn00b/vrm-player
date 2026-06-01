export interface StabilizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface LandmarkStabilizerOptions {
  minVisibility?: number;
  maxGapFrames?: number;
  maxStep?: number;
  maxZStep?: number;
}

interface LandmarkState {
  point: StabilizedLandmark;
  gapFrames: number;
  stale: boolean;
}

const DEFAULT_OPTIONS: Required<LandmarkStabilizerOptions> = {
  minVisibility: 0.3,
  maxGapFrames: 3,
  maxStep: 0.45,
  maxZStep: 0.18,
};

export class LandmarkStabilizer {
  private readonly options: Required<LandmarkStabilizerOptions>;
  private readonly states: Array<LandmarkState | null>;

  constructor(count: number, options: LandmarkStabilizerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.states = Array.from({ length: count }, () => null);
  }

  stabilize<T extends StabilizedLandmark>(landmarks: T[], _timeSec: number): T[] {
    return landmarks.map((landmark, index) => this.stabilizeOne(landmark, index) as T);
  }

  reset(): void {
    this.states.fill(null);
  }

  private stabilizeOne<T extends StabilizedLandmark>(landmark: T, index: number): StabilizedLandmark {
    const current = { ...landmark };
    const visibility = current.visibility ?? 1;
    const previous = this.states[index] ?? null;

    if (!previous) {
      if (visibility >= this.options.minVisibility) {
        this.states[index] = { point: { ...current }, gapFrames: 0, stale: false };
      }
      return current;
    }

    if (visibility < this.options.minVisibility) {
      const gapFrames = previous.gapFrames + 1;
      if (gapFrames <= this.options.maxGapFrames && !previous.stale) {
        this.states[index] = { ...previous, gapFrames };
        return {
          ...previous.point,
          visibility: this.options.minVisibility,
        };
      }
      this.states[index] = { ...previous, gapFrames, stale: true };
      return current;
    }

    const stabilized = previous.stale ? current : this.limitStep(previous.point, current);
    this.states[index] = { point: { ...stabilized }, gapFrames: 0, stale: false };
    return stabilized;
  }

  private limitStep(previous: StabilizedLandmark, current: StabilizedLandmark): StabilizedLandmark {
    const out = { ...current };
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const dz = current.z - previous.z;
    const xyLen = Math.hypot(dx, dy);

    if (xyLen > this.options.maxStep) {
      const scale = this.options.maxStep / xyLen;
      out.x = previous.x + dx * scale;
      out.y = previous.y + dy * scale;
    }

    if (Math.abs(dz) > this.options.maxZStep) {
      out.z = previous.z + Math.sign(dz) * this.options.maxZStep;
    }

    return out;
  }
}
