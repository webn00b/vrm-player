/**
 * Per-bone visibility-loss state machine for mocap retargeting.
 *
 * Solves the "snap-freeze" problem in `directPoseApplier`: when a landmark's
 * visibility drops below threshold, the bone's previous early-return strategy
 * locks the bone instantly to whatever pose it was in and resumes mid-jump
 * when the landmark returns. With this state machine the bone instead:
 *
 *   FRESH      (< HOLD_MS since loss):
 *     hold last accepted live target verbatim
 *   DECAYING   (HOLD_MS .. HOLD_MS + RELAX_MS since loss):
 *     slerp linearly from last-good toward identity (rest pose)
 *   RESTED     (> HOLD_MS + RELAX_MS since loss):
 *     stay at identity
 *
 * When visibility returns, the streak's onset is recorded and the output is
 * blended from "wherever we landed when visibility came back" toward the
 * fresh live target over RECOVER_MS — preventing the snap-back jump.
 *
 * The whole thing is THREE-dependent for ergonomics but state is owned by
 * the caller so the module is trivially testable (pass mock time values).
 */

import * as THREE from 'three';

/** Hold last-good pose verbatim for this long after visibility loss (ms). */
export const HOLD_MS = 200;
/** Linear fade from last-good to rest over this duration after HOLD_MS (ms). */
export const RELAX_MS = 600;
/** When visibility returns, blend from where we landed back to live live target
 *  over this duration (ms). */
export const RECOVER_MS = 200;

export interface BoneTrackState {
  /** Last live target accepted while visible. Identity if never observed. */
  lastGoodQuat: THREE.Quaternion;
  /** Time (ms) of last visible-frame observation. -Infinity = never observed. */
  lastVisibleTime: number;
  /** Whether the previous frame's input was visible — used to detect transitions. */
  wasVisible: boolean;
  /** Time the current visibility-streak began (ms). Used for recovery progress. */
  visibleStreakStart: number;
  /** Frozen "where we landed" quaternion captured at the moment visibility returned.
   *  The recovery slerp starts here and ends at the live target. */
  recoveryFromQuat: THREE.Quaternion;
  /** The target we wrote last frame — used as recovery starting point when
   *  visibility transitions off→on (so the next-frame output starts from the
   *  frozen/decayed pose, not from somewhere arbitrary). */
  lastOutputQuat: THREE.Quaternion;
}

export function createBoneTrackState(): BoneTrackState {
  return {
    lastGoodQuat: new THREE.Quaternion(),
    lastVisibleTime: -Infinity,
    wasVisible: false,
    visibleStreakStart: -Infinity,
    recoveryFromQuat: new THREE.Quaternion(),
    lastOutputQuat: new THREE.Quaternion(),
  };
}

const _restQuat = new THREE.Quaternion(); // identity, never mutated
const _identityQuat = new THREE.Quaternion(); // module-level identity for fade()

/**
 * Compute the effective target quaternion for this frame given the live
 * target (only relevant when visible) and the current frame's visibility.
 * Mutates `state`. Writes result into `outTarget` (caller-owned, no allocation).
 *
 * @param state      per-bone state, persistent across frames
 * @param visible    whether the inputs for this bone are tracked this frame
 * @param liveQuat   live target if visible; ignored otherwise
 * @param now        current time in ms (performance.now() at runtime; mockable in tests)
 * @param outTarget  caller-owned quaternion receiving the result
 * @returns          outTarget for fluent chaining
 */
export function computeFadeTarget(
  state: BoneTrackState,
  visible: boolean,
  liveQuat: THREE.Quaternion,
  now: number,
  outTarget: THREE.Quaternion,
): THREE.Quaternion {
  if (visible) {
    // off → on transition: capture recovery starting point as the LAST OUTPUT we
    // produced (i.e. the frozen-or-decayed pose). Subsequent frames slerp from
    // here to liveQuat over RECOVER_MS.
    if (!state.wasVisible) {
      state.recoveryFromQuat.copy(state.lastOutputQuat);
      state.visibleStreakStart = now;
    }
    state.lastGoodQuat.copy(liveQuat);
    state.lastVisibleTime = now;
    state.wasVisible = true;

    const sinceRecover = now - state.visibleStreakStart;
    if (sinceRecover < RECOVER_MS) {
      const t = sinceRecover / RECOVER_MS;
      outTarget.slerpQuaternions(state.recoveryFromQuat, liveQuat, t);
    } else {
      outTarget.copy(liveQuat);
    }
  } else {
    state.wasVisible = false;
    const sinceLoss = now - state.lastVisibleTime;
    if (sinceLoss < HOLD_MS) {
      // FRESH — hold last good verbatim.
      outTarget.copy(state.lastGoodQuat);
    } else if (sinceLoss < HOLD_MS + RELAX_MS) {
      // DECAYING — slerp linearly toward identity over RELAX_MS.
      const t = (sinceLoss - HOLD_MS) / RELAX_MS;
      outTarget.slerpQuaternions(state.lastGoodQuat, _restQuat, t);
    } else {
      // RESTED — sit at identity.
      outTarget.copy(_restQuat);
    }
  }
  state.lastOutputQuat.copy(outTarget);
  return outTarget;
}

/** Phase enum mostly for the diagnostic readout (D1-lite). Computed on demand
 *  from state + current time without mutating anything. */
export type TrackPhase = 'live' | 'recovering' | 'fresh' | 'decaying' | 'rested';

export function trackPhase(state: BoneTrackState, now: number): TrackPhase {
  if (state.wasVisible) {
    const sinceRecover = now - state.visibleStreakStart;
    return sinceRecover < RECOVER_MS ? 'recovering' : 'live';
  }
  const sinceLoss = now - state.lastVisibleTime;
  if (sinceLoss < HOLD_MS) return 'fresh';
  if (sinceLoss < HOLD_MS + RELAX_MS) return 'decaying';
  return 'rested';
}

/** Milliseconds since the most recent visibility loss (0 if currently visible). */
export function msSinceLoss(state: BoneTrackState, now: number): number {
  if (state.wasVisible) return 0;
  if (!isFinite(state.lastVisibleTime)) return Infinity;
  return now - state.lastVisibleTime;
}

/**
 * Lightweight tracker that owns the Map<boneName, BoneTrackState>.
 * Single instance per applier. Allocates state lazily on first access.
 */
export class BoneTracker {
  private readonly _states = new Map<string, BoneTrackState>();

  /** Get-or-allocate state for the named bone. */
  state(name: string): BoneTrackState {
    let s = this._states.get(name);
    if (!s) {
      s = createBoneTrackState();
      this._states.set(name, s);
    }
    return s;
  }

  /** Convenience: compute fade target for the named bone (handles both
   *  visible and invisible cases, with recovery-blend on visibility return). */
  resolve(
    name: string,
    visible: boolean,
    liveQuat: THREE.Quaternion,
    now: number,
    outTarget: THREE.Quaternion,
  ): THREE.Quaternion {
    return computeFadeTarget(this.state(name), visible, liveQuat, now, outTarget);
  }

  /**
   * Visibility-on update WITHOUT producing a recovery-blended target. Use
   * when the bone is already being driven by a separate path (e.g. IK chain
   * application writes the bone directly) and we only need to update the
   * tracker's state so the next visibility-loss frame knows what to hold.
   *
   * The trade-off: skips the RECOVER_MS smooth-blend on visibility return,
   * relying on the bone's own slerp(target, lerp) loop to settle naturally
   * over ~3-4 frames.
   */
  markObserved(name: string, liveQuat: THREE.Quaternion, now: number): void {
    const s = this.state(name);
    s.lastGoodQuat.copy(liveQuat);
    s.lastVisibleTime = now;
    s.wasVisible = true;
    s.lastOutputQuat.copy(liveQuat);
    // Initialize visibleStreakStart so trackPhase() correctly reports 'live'.
    if (s.visibleStreakStart === -Infinity) s.visibleStreakStart = now;
  }

  /** Invisible-frame target only (FRESH / DECAYING / RESTED). Caller is
   *  responsible for applying it (typically slerp into bone). */
  fade(name: string, now: number, outTarget: THREE.Quaternion): THREE.Quaternion {
    return computeFadeTarget(this.state(name), false, _identityQuat, now, outTarget);
  }

  /** Read-only iterator over (name, state) for diagnostic readout (D1-lite). */
  entries(): IterableIterator<[string, BoneTrackState]> {
    return this._states.entries();
  }

  /** Reset all bones (e.g. on mocap restart). */
  reset(): void {
    this._states.clear();
  }
}
