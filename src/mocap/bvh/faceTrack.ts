/**
 * Face-expression sidecar track for recorded video→animation.
 *
 * BVH carries bone rotations + the hips position — it cannot hold blendshape
 * expressions, so the FaceApplier's per-frame values (blink + mouth-open) were
 * lost on export. This is the persistence layer: one expression sample per BVH
 * frame, serialized to a `<name>.face.json` sidecar saved next to the BVH.
 * A future playback pass loads it and drives expressionManager alongside the
 * BVH mixer.
 */

export interface FaceExpressionFrame {
  blinkLeft: number;
  blinkRight: number;
  aa: number;
}

export interface FaceTrack {
  /** Frame rate; matches the BVH's (30). */
  fps: number;
  frames: FaceExpressionFrame[];
}

/** True when any frame moves an expression off zero — empty tracks are dropped
 *  so a face-tracking-off recording writes no useless sidecar. */
export function faceTrackHasMotion(track: FaceTrack, eps = 1e-3): boolean {
  return track.frames.some(
    (f) => Math.abs(f.blinkLeft) > eps || Math.abs(f.blinkRight) > eps || Math.abs(f.aa) > eps,
  );
}

/** Parse a serialized sidecar back to a FaceTrack, or null if malformed. */
export function parseFaceTrack(json: string): FaceTrack | null {
  try {
    const d = JSON.parse(json);
    if (d?.format !== 'vrm-player.face-track' || !Array.isArray(d.frames)) return null;
    return { fps: Number(d.fps) || 30, frames: d.frames };
  } catch {
    return null;
  }
}

/** Minimal VRM surface the player needs — keeps faceTrack import-light. */
interface ExpressionTarget {
  expressionManager?: { setValue(name: string, value: number): void } | null;
}

/**
 * Drives a VRM's expressions from a face track during BVH playback. Call
 * setTrack() when a clip with a face sidecar starts, then applyAt(timeSec)
 * each render frame with the clip's current time. Holds the last frame past
 * the end; a null track is a no-op (and clears expressions once).
 */
export class FaceTrackPlayer {
  private _track: FaceTrack | null = null;
  private _needsClear = false;

  constructor(private readonly vrm: ExpressionTarget) {}

  setTrack(track: FaceTrack | null): void {
    this._track = track && track.frames.length ? track : null;
  }

  get hasTrack(): boolean { return this._track !== null; }

  applyAt(timeSec: number): void {
    const em = this.vrm.expressionManager;
    if (!em) return;
    if (!this._track) {
      if (this._needsClear) {
        em.setValue('blinkLeft', 0); em.setValue('blinkRight', 0); em.setValue('aa', 0);
        this._needsClear = false;
      }
      return;
    }
    const { fps, frames } = this._track;
    const i = Math.max(0, Math.min(frames.length - 1, Math.round(timeSec * fps)));
    const f = frames[i];
    em.setValue('blinkLeft', f.blinkLeft);
    em.setValue('blinkRight', f.blinkRight);
    em.setValue('aa', f.aa);
    this._needsClear = true;
  }
}

export function serializeFaceTrack(track: FaceTrack): string {
  // Round to 4 dp — expressions are 0..1, more precision is noise.
  const r = (v: number): number => Math.round(v * 1e4) / 1e4;
  return JSON.stringify({
    format: 'vrm-player.face-track',
    version: 1,
    fps: track.fps,
    frames: track.frames.map((f) => ({ blinkLeft: r(f.blinkLeft), blinkRight: r(f.blinkRight), aa: r(f.aa) })),
  });
}
