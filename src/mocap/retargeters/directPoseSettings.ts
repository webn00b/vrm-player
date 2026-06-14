const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/**
 * All user-tunable parameters of the direct pose pipeline, with the same
 * clamping rules the DirectPoseApplier setters used to apply inline.
 *
 * sysAnimOnline uses separate filters per body region:
 *   head_chest_rot: minCutoff=0.25 → very heavy torso smoothing (stable trunk)
 *   arm_rot/IK:     minCutoff=0.5, beta=0.5 → responsive arms
 * We mirror this with separate lerp values: low for spine (stable), high for limbs.
 */
export class DirectPoseSettings {
  /** Hips + spine/chest twist — heavily smoothed. */
  spineLerp = 0.25;
  /** Arms + legs IK. */
  bodyLerp = 0.7;
  handLerp = 0.55;
  headLerp = 0.28;
  /** Hip/root position follows the performer, but less eagerly than rotations.
   *  This preserves weight shift while reducing the "floating pelvis" look from
   *  MediaPipe hip-centre jitter. */
  hipPositionLerp = 0.12;

  handTrackingPriorityEnabled = true;
  /** Mirror landmarks left↔right (selfie view). */
  mirrorX = true;
  /** Default to full 3D depth; the panel can still reduce it if Z gets noisy. */
  depthScale = 1;
  /** MediaPipe visibility score below this = skip bone. */
  visibilityThreshold = 0.3;

  /** Shoulder spread: Z-axis rotation applied to leftShoulder / rightShoulder every
   *  frame. Positive = shoulders droop outward (broader silhouette). Range ±20°. */
  shoulderSpreadDeg = 0;
  legSpreadX = 1.0;

  /** Hip position tracking: performer hip centre delta → avatar hips.position. */
  hipPositionEnabled = true;

  /** Derive the hips' WORLD height from hip-above-ankle distance in the world
   *  landmarks instead of the image-space Y delta. Fixes crouches: the screen
   *  Y of the pelvis barely moves in a deep squat, leaving the avatar's legs
   *  straight because the ground-clamped ankle targets stay within reach.
   *  Only sane with REAL ankle landmarks — enabled via setTrustedInputMode. */
  hipHeightFromLegs = false;

  /** Track the hips' vertical (Y) position from the landmarks. Off for
   *  half-body / untrusted footage where the hip landmark sits at the frame
   *  edge and its Y jitters wildly; the avatar holds its rest height. */
  hipVerticalTracking = false;

  // Depth (Z) is MediaPipe's least reliable axis. For narrow joints like
  // elbows this jitter is visible — we attenuate it further inside arm IK.
  // Legs' Z is less problematic (big, well-separated joints) so we leave it.
  armZAttenuation = 1;
  /** Max angle (deg) the wrist target may sit behind the shoulder's coronal
   *  plane. Depth ambiguity (arm toward/away from camera) can fling the hand
   *  far back; this clamps it. 90 = off (no limit). User-tunable per clip. */
  armBackLimitDeg = 90;
  /** Torso-direction Z damping (see setHighQualityMode). 1 = honest depth. */
  torsoDepthDamping = 3;
  /** Treat input world landmarks as geometrically trustworthy (file capture
   *  with the temporal lifter): IK targets become pure similarity transforms
   *  of the input — no per-axis scaling, no anatomical Z recovery, no
   *  pose-specific blends. Those heuristics rescue noisy live-webcam depth
   *  but DESTROY clean input (measured 90°+ arm direction error from the
   *  anisotropic x/y/z scaling alone). */
  trustInputGeometry = false;
  /** Minimum clearance (m) kept between the two forearm segments. Folding the
   *  arms collapses both forearms onto one depth plane (MediaPipe can't separate
   *  two overlapping limbs in Z), so the meshes pass through each other. When the
   *  forearms get closer than this, they are nudged apart in depth. 0 = off.
   *  ~0.07 ≈ a forearm's diameter (two ~3.5cm radii). */
  forearmClearance = 0.07;
  /** Max per-frame change (deg) of a leg bone's world rotation. Half-body
   *  footage has no real leg signal — MediaPipe hallucinates the hidden legs,
   *  and a landmark that momentarily crosses the visibility gate fires a
   *  single-frame teleport (measured up to 43°/frame). A real leg moves
   *  gradually, so this rate-limit kills the teleport without touching genuine
   *  motion. 180 = off; engaged only in the guarded (low-coverage) profile. */
  legStepMaxDeg = 180;
  /** EMA alpha on pole smoothing. 1 = no smoothing (use current frame). */
  poleAlpha = 0.6;
  /** Z-axis weight applied to the arm pole vector (shoulder→elbow direction).
   *  Separate from the target Z attenuation: the pole only hints at the bulge
   *  direction, so more damping here helps stability without shortening reach. */
  armPoleZ = 0.5;

  /** Fraction of residual torso midpoint lean applied to spine/chest as a
   *  side-bend after hips orientation has already been solved. */
  lateralBendScale = 0.35;
  /** For pronounced bends we boost the lateral gain adaptively, while
   *  keeping small/noisy leans on the original lower gain. */
  lateralBendScaleMax = 0.7;
  /** Residual torso forward bend applied to spine/chest after hips orientation.
   *  Uses full torso Z (no /3 damping) so pronounced bows still read correctly. */
  forwardBendScale = 1;
  /** Cap on how far the pelvis cross-axis may diverge from the shoulder line;
   *  beyond it we progressively trust shoulders more (noisy hips when a leg lifts). */
  torsoAxisMaxDivergenceDeg = 20;
  /** Hard cap on the spine/chest yaw (shoulder-vs-hip twist). MediaPipe depth
   *  error can swing the projected torso axes by ~180°; a real human torso
   *  twist rarely exceeds this. Bounds the worst-case "perekrut". */
  torsoTwistMaxDeg = 60;
  /** Max per-frame change of the torso yaw. A genuine z-noise flip is a single-
   *  frame teleport; real twist is gradual. 18°/frame ≈ 540°/s at 30fps — faster
   *  than any human torso turn, but blocks single-frame 180° spikes. */
  torsoTwistMaxStepDeg = 18;
  /** Soft-deadband on the torso yaw. Facing the camera the yaw is the difference
   *  of two depth-noise terms (a few degrees of jitter). Suppress it; real twists
   *  past 2× this keep full amplitude. 0 disables. */
  torsoTwistDeadbandDeg = 4;
  /** Max per-frame change of the HIPS yaw (pelvis facing). A real turn is
   *  gradual; a >this jump is a depth-noise basis flip. */
  hipsYawMaxStepDeg = 9;
  /** Amplitude cap on the HIPS yaw relative to the neutral facing baseline.
   *  Widened by setTrustedInputMode: trusted/lifted footage allows real turns,
   *  untrusted (unreliable hip depth) clamps tight — a large turn there is a
   *  flip artefact, not a real pelvis rotation. */
  hipsYawMaxDeg = 35;

  // Foot locking: freezes the ankle IK target when the performer stands still,
  // removing the foot-sliding artefact caused by MediaPipe landmark jitter.
  footLockEnabled = true;
  footVelocityLockThreshold = 0.007;   // m/frame — below this = lock candidate
  footVelocityUnlockThreshold = 0.018; // m/frame — above this = force unlock
  footLiftThreshold = 0.05;            // m above groundY — foot is being lifted

  /** A3: opt-in symmetry fallback — an invisible arm/leg chain copies its
   *  mirror partner's local quaternions while the partner is live. */
  symmetryFallback = false;

  /** Pose the legs by aligning each bone to its landmark DIRECTION
   *  (hip→knee, knee→ankle) instead of two-bone IK to a scaled ankle position.
   *  Direction is a unit vector, so the knee angle is independent of the
   *  performer's size / camera distance — the SAME motion lays the same way on
   *  the VRM across different videos. (Scaled-IK leaks the per-video legScale
   *  estimate into the knee flexion.) Foot grounding is handled by the standing
   *  hip pin + foot-lock fixup, not by a position target. */
  legDirectionRetarget = true;

  /** Pose the arms by aligning each bone to its landmark DIRECTION
   *  (shoulder→elbow, elbow→wrist) instead of two-bone IK to a scaled wrist
   *  position. Same rationale as legDirectionRetarget: the elbow angle becomes
   *  independent of the performer's size / camera distance, so gestures lay the
   *  same way on the VRM across videos. End-effector precision (hands meeting,
   *  hand-on-body) is recovered by a contact IK fixup when a contact is
   *  detected — see armContactFixup. */
  armDirectionRetarget = true;
  /** Contact IK fixup: when the performer's wrists are close, fall back to
   *  position-IK so the avatar's wrists meet. Measured OFF by default: pure
   *  direction already keeps clasped hands within ~3 cm, while the scaled
   *  position-IK fixup (noisy anisotropic scale on untrusted footage) pushes
   *  them to ~6 cm — it regresses the very case it targets. Kept as an opt-in
   *  hook; a future midpoint-nudge fixup would be the better tool than armIK. */
  armContactFixup = false;

  setShoulderSpread(deg: number): void { this.shoulderSpreadDeg = clamp(deg, -20, 20); }
  setLegSpreadX(v: number): void { this.legSpreadX = clamp(v, 0.5, 2.0); }
  setBodySmoothing(v: number): void { this.bodyLerp = clamp(v, 0.01, 1); }
  setSpineSmoothing(v: number): void { this.spineLerp = clamp(v, 0.01, 1); }
  setArmZAttenuation(v: number): void { this.armZAttenuation = clamp(v, 0, 1); }
  setArmBackLimitDeg(v: number): void { this.armBackLimitDeg = clamp(v, 20, 90); }
  setPoleSmoothing(v: number): void { this.poleAlpha = clamp(v, 0.01, 1); }
  setArmPoleZ(v: number): void { this.armPoleZ = clamp(v, 0, 1); }
  setDepthScale(v: number): void { this.depthScale = clamp(v, 0, 1); }
  setVisibilityThreshold(v: number): void { this.visibilityThreshold = clamp(v, 0, 1); }
  setLateralBendScale(v: number): void { this.lateralBendScale = clamp(v, 0, 1); }

  /** HQ mode: snap to target (no slerp), full amplitude — for BVH recording. */
  setHighQualityMode(enabled: boolean): void {
    this.spineLerp = enabled ? 1 : 0.25;
    this.bodyLerp  = enabled ? 1 : 0.7;
    this.handLerp  = enabled ? 1 : 0.7;
    this.headLerp  = enabled ? 1 : 0.28;
    this.hipPositionLerp = enabled ? 1 : 0.12;
  }

  /**
   * Trusted-input mode: the world landmarks are geometrically reliable
   * (full-body file capture, ideally lifted). Switches the retarget from
   * "rescue noisy webcam data" heuristics to pure-similarity geometry.
   *
   * MUST be gated on actual BODY COVERAGE, not on the capture source:
   * half-body footage makes MediaPipe hallucinate the hidden legs, and
   * trusting that geometry (hip height from fake ankles, undamped torso
   * depth) dismantles the pose. See MocapController's coverage gate.
   */
  setTrustedInputMode(enabled: boolean): void {
    this.trustInputGeometry = enabled;
    // Honest torso Z is EARNED by a successful 3D lift, not by body coverage:
    // raw MediaPipe world z is depth-guessed and noisy even at full coverage,
    // and trusting it (damping 1) over-rotates the torso ("perekrut"). Default
    // to damped here; setTorsoDepthTrusted(true) relaxes it once the lifter ran.
    this.torsoDepthDamping = 3;
    this.hipHeightFromLegs = enabled;
    // Vertical hip translation needs reliable hip/leg geometry. Half-body
    // (untrusted) footage has the hip landmark at the frame edge with garbage
    // Y, drifting the avatar ~0.7 m — hold rest height there.
    this.hipVerticalTracking = enabled;
    // Pelvis facing: trusted/lifted footage can show real turns (allow a wide
    // yaw range, leaving the rate limiter as the only guard); untrusted footage
    // has unreliable hip depth, so a large hips yaw is a flip artefact — clamp.
    this.hipsYawMaxDeg = enabled ? 150 : 35;
    // Legs: trusted footage carries real leg motion (no rate limit); guarded
    // (half-body) footage has only hallucinated legs, so cap their per-frame
    // step to kill single-frame teleport spikes.
    this.legStepMaxDeg = enabled ? 180 : 6;
  }

  /**
   * Relax torso-depth damping to honest (1) only when the world landmarks carry
   * a reliable depth signal — i.e. the MotionBERT lift actually ran. Without it
   * the torso basis stays on damped raw MediaPipe z (3). Call AFTER the lift.
   */
  setTorsoDepthTrusted(enabled: boolean): void {
    this.torsoDepthDamping = enabled ? 1 : 3;
  }

  isVisible(lm?: { visibility?: number }): boolean {
    // Missing visibility (e.g. HandLandmarker outputs) treated as visible.
    return (lm?.visibility ?? 1) >= this.visibilityThreshold;
  }
}
