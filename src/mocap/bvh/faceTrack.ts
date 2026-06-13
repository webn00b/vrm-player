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
