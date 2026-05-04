import type * as THREE from 'three';

/**
 * Shared flags + callbacks honoured by the main render loop. Normally all
 * values are inert (suspendOverlays=false, callbacks=null) and the loop runs
 * at full fidelity.
 *
 * The BVH round-trip verifier flips these temporarily to drive a clip through
 * the *production* pipeline (AnimationController → validator.clampAll → vrm.update)
 * while suppressing overlays (idle, mocap, bonePanel, micro) that would write
 * competing bone data and invalidate the measurement.
 */
export const renderLoopHooks: {
  /** Skip idle, mocap.applyLatestFrame, bonePanel.apply, tracked-hand overlay, micro.update. */
  suspendOverlays: boolean;
  /** Additional mixer updated each tick before validator.clampAll. */
  extraMixer: THREE.AnimationMixer | null;
  /**
   * If true, `validator.clampAll` is skipped entirely on this tick. The verifier
   * uses this during replay to match the per-bone exclusion behaviour of the
   * capture phase exactly — without it, leftUpperArm is clamped during replay
   * (state='off' → no excluded set) while it was free during capture
   * (state='recording' → MOCAP_VALIDATION_EXCLUDED_BONES) and round-trip values
   * can drift by 60–80°.
   */
  suspendValidatorClamp: boolean;
  /** Fires once per tick after vrm.update(delta). */
  onAfterVrmUpdate: ((delta: number) => void) | null;
  /**
   * Per-frame capture sink — fires after vrm.update so world matrices and
   * normalized bone quaternions reflect the final on-screen pose. Used by
   * the BVH-export recorder to grab live frames while a clip plays through
   * the standard render path. Distinct from onAfterVrmUpdate so the verifier
   * and the export recorder can coexist.
   */
  poseCaptureSink: ((delta: number) => void) | null;
  /**
   * SkeletonLogger tick — fires immediately after `validator.clampAll(...)`
   * (so it sees the final on-screen pose) and before any per-frame recorder.
   * Inert when no logger is mounted; the logger gates itself by `active`.
   */
  skeletonLoggerTick: (() => void) | null;
} = {
  suspendOverlays: false,
  extraMixer: null,
  suspendValidatorClamp: false,
  onAfterVrmUpdate: null,
  poseCaptureSink: null,
  skeletonLoggerTick: null,
};
