import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { BvhRecorder, BVH_FRAME_RATE } from '../bvh/bvhRecorder';
import { getJointOffset, type BvhRecorderCompatibility } from '../bvh/bvhRecorderFactory';
import { getCachedHumanoidRestAxes } from '../../humanoidRestPose';
import { captureSnapshot, type PoseSnapshot } from '../bvh/bvhRoundtripVerifier';

function textHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface FinishedRecording {
  name: string;
  /** External-tool BVH (plain coordinates). */
  externalText: string;
  /** Internal-roundtrip BVH (VRM0 x/z pre-flip cancelled by the loader on import). */
  replayText: string;
}

/**
 * Owns the BVH recorder set of a mocap session: the live recorder, the
 * parallel internal-roundtrip ("replay") recorder, the manual grab-frame
 * recorder, and the round-trip verification snapshots. MocapController keeps
 * the state machine and delegates all recorder bookkeeping here.
 */
export class MocapBvhSession {
  live: BvhRecorder;
  replay: BvhRecorder | null = null;
  readonly grab: BvhRecorder;

  private _vrm: VRM;
  private _getQuaternion: (name: string) => [number, number, number, number] | null;
  private _recordingIndex = 0;
  private _poseExportIndex = 0;

  // ── Round-trip verification (expected-side capture) ─────────────────────────
  // When non-null, every time the live recorder accepts a new frame we also
  // snapshot the full normalized-bone state. Pairs with a deterministic replay
  // in bvhRoundtripVerifier to detect record↔playback divergence.
  private _verifySnapshots: PoseSnapshot[] | null = null;
  private _verifyLastFrameCount = 0;

  constructor(
    vrm: VRM,
    getQuaternion: (name: string) => [number, number, number, number] | null,
  ) {
    this._vrm = vrm;
    this._getQuaternion = getQuaternion;
    this.live = this.createRecorder();
    this.grab = this.createRecorder();
  }

  createRecorder(compatibility: BvhRecorderCompatibility = 'external'): BvhRecorder {
    const correctionInvMap = this._buildCorrectionInvMap();
    // External-tool BVH keeps plain coordinates. Internal round-trip BVH uses
    // the VRM0 x/z pre-flip so `createVRMAnimationClip` cancels it on import.
    const flipForVrm0 = compatibility === 'internal-roundtrip' && this._vrm.meta.metaVersion === '0';
    return new BvhRecorder({
      getJointOffset: (name) => this.getBvhJointOffset(name),
      getRestCorrectionInv: (name) => correctionInvMap.get(name) ?? null,
      flipForVrm0,
    });
  }

  /** Swap the live recorder for a fresh one (e.g. between takes / verify runs). */
  resetLive(compatibility: BvhRecorderCompatibility = 'external'): void {
    this.live = this.createRecorder(compatibility);
  }

  /** Create + start the parallel internal-roundtrip stream. */
  startReplay(): void {
    this.replay = this.createRecorder('internal-roundtrip');
    this.replay.start();
  }

  /** Stop + drop the replay recorder without using its output. */
  discardReplay(): void {
    if (this.replay?.recording) this.replay.stop();
    this.replay = null;
  }

  getBvhJointOffset(name: string): [number, number, number] | null {
    return getJointOffset(this._vrm, name);
  }

  private _buildCorrectionInvMap(): Map<string, [number, number, number, number]> {
    const map = new Map<string, [number, number, number, number]>();
    // Prime the rest-axes cache while the avatar is in (near-)bind pose so the
    // loader sees the same snapshot at replay time. See note on
    // `getCachedHumanoidRestAxes` in humanoidRestPose.ts.
    const restAxes = getCachedHumanoidRestAxes(this._vrm);
    const _q = new THREE.Quaternion();
    for (const [bone, info] of restAxes) {
      // correction = setFromUnitVectors(rawAxis, normalizedAxis)
      // correctionInv rotates normalizedAxis back to rawAxis direction;
      // pre-multiplying by corrInv maps rawAxis-convention q to T-pose-relative q.
      _q.copy(info.correction).invert();
      map.set(bone, [_q.x, _q.y, _q.z, _q.w]);
    }
    return map;
  }

  private _getBvhHipsPosition(): [number, number, number] | null {
    // Write LOCAL position (relative to hips' parent), not world. AnimationMixer
    // on playback writes back into `bone.position` which is local — so for a
    // bit-exact round-trip the value we record must be the same field.
    // Reading world here would silently bake the parent transform into the BVH
    // and re-apply it on playback, producing a constant offset (~9cm in our
    // verifier on rigs where the normalized hips has any parent transform).
    const hips = this._vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (!hips) return null;
    const p = hips.position;
    return [p.x, p.y, p.z];
  }

  /** Rate-limited append (recorder's own 30 Hz clock). True when accepted. */
  addCurrentPoseFrame(recorder: BvhRecorder): boolean {
    const before = recorder.frameCount;
    recorder.addFrame(
      (name) => this._getQuaternion(name),
      () => this._getBvhHipsPosition(),
    );
    return recorder.frameCount > before;
  }

  /** Unconditional append at the synthetic fixed-rate timestamp. */
  captureCurrentPoseFrame(recorder: BvhRecorder): void {
    recorder.captureFrame(
      (name) => this._getQuaternion(name),
      () => this._getBvhHipsPosition(),
    );
  }

  /** Fixed-FPS file capture: write live + replay, snapshot for verification. */
  captureFixedFileFrame(): boolean {
    const before = this.live.frameCount;
    this.captureCurrentPoseFrame(this.live);
    if (this.replay) this.captureCurrentPoseFrame(this.replay);
    const recorded = this.live.frameCount > before;
    if (recorded) this.snapshotIfNewFrame();
    return recorded;
  }

  /**
   * Round-trip verification: snapshot a full pose only when the recorder
   * actually accepted a new frame (rate-limited to 30 Hz) so expected[i]
   * aligns 1:1 with the BVH frame i written to file.
   */
  snapshotIfNewFrame(): void {
    if (this._verifySnapshots === null) return;
    const fc = this.live.frameCount;
    if (fc > this._verifyLastFrameCount) {
      this._verifySnapshots.push(captureSnapshot(this._vrm, fc - 1));
      this._verifyLastFrameCount = fc;
    }
  }

  /** Begin collecting expected-side pose snapshots alongside the live recorder. */
  startVerifyCapture(): void {
    this._verifySnapshots = [];
    this._verifyLastFrameCount = this.live.frameCount;
  }

  /** Stop collecting and return the captured snapshots (one per BVH frame). */
  stopVerifyCapture(): PoseSnapshot[] {
    const out = this._verifySnapshots ?? [];
    this._verifySnapshots = null;
    this._verifyLastFrameCount = 0;
    return out;
  }

  get verifyCapturing(): boolean { return this._verifySnapshots !== null; }
  get verifyCapturedCount(): number { return this._verifySnapshots?.length ?? 0; }

  nextRecordingName(): string { return `mocap_${++this._recordingIndex}`; }
  nextPoseExportName(): string { return `pose_${++this._poseExportIndex}`; }

  /**
   * Stop live + replay recorders, log the take, and return both BVH texts.
   * Download / onBvhReady side effects stay with the controller.
   */
  finishRecording(source: 'camera' | 'video'): FinishedRecording {
    const externalFrames = this.live.frameCount;
    const internalFrames = this.replay?.frameCount ?? externalFrames;
    const externalText = this.live.stop();
    const replayText = this.replay?.stop() ?? externalText;
    this.replay = null;
    const name = this.nextRecordingName();
    console.info('[animation:record]', {
      name,
      source,
      vrmVersion: this._vrm.meta.metaVersion,
      savedFrames: internalFrames,
      externalFrames,
      durationSec: Number((internalFrames / BVH_FRAME_RATE).toFixed(3)),
      savedHash: textHash(replayText),
      externalHash: textHash(externalText),
      savedEqualsExternal: replayText === externalText,
    });
    return { name, externalText, replayText };
  }
}
