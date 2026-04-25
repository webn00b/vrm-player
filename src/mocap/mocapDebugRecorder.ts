/**
 * MocapDebugRecorder — captures per-frame mocap state to a downloadable JSON.
 *
 * Records:
 *   - World landmarks (33 body joints, metres)
 *   - IK targets (wrists + ankles, world space)
 *   - Key bone quaternions (hips → limbs)
 *   - Calibration scale factors
 *
 * Usage: call capture() each render frame while active, then download().
 * Analyse with the Read tool on the downloaded file or pipe to console.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { PoseFrame } from './poseDetector';
import type { MocapCalibration } from './mocapCalibration';
import type { MocapDebugTargets } from './mocapDiagnostics';

// Compact types for minimal file size
type V3 = [number, number, number];
type V4 = [number, number, number, number];

export interface DebugFrame {
  /** Seconds since recorder started. */
  t: number;
  /** 33 world landmarks: [x, y, z, visibility]. Missing → null. */
  lm: Array<[number, number, number, number] | null>;
  /** IK targets in world space. Null when IK hasn't fired yet. */
  ik: {
    lWrist: V3 | null;
    rWrist: V3 | null;
    lAnkle: V3 | null;
    rAnkle: V3 | null;
    hasArm: boolean;
    hasLeg: boolean;
  };
  /** Bone local quaternions [x,y,z,w] for key bones. */
  bones: Partial<Record<string, V4>>;
  /** Bone world quaternions for shoulder/hip IK roots (useful for debug). */
  bonesWorld: Partial<Record<string, V4>>;
  /** Calibration state. */
  calib: {
    body: number;
    lArm: number;
    rArm: number;
    calibrated: boolean;
  };
}

const KEY_BONES = [
  'hips', 'spine', 'chest', 'upperChest',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg',
  'rightUpperLeg', 'rightLowerLeg',
];

export class MocapDebugRecorder {
  private _frames: DebugFrame[] = [];
  private _active = false;
  private _t0 = 0;
  private _maxFrames: number;
  private _vrm: VRM;
  // Dedup: skip capture if the PoseFrame object hasn't changed since last tick
  private _lastFrame: PoseFrame | null = null;

  /** Called when recording stops (auto-stop at maxFrames or manual). */
  onStop: ((frames: DebugFrame[]) => void) | null = null;

  constructor(vrm: VRM, maxFrames = 600) {
    this._vrm = vrm;
    this._maxFrames = maxFrames;
  }

  get active(): boolean { return this._active; }
  get frameCount(): number { return this._frames.length; }

  /** @param maxFrames Override cap for this session. Pass Infinity for no limit. */
  start(maxFrames?: number): void {
    this._frames = [];
    this._lastFrame = null;
    this._t0 = performance.now() / 1000;
    if (maxFrames !== undefined) this._maxFrames = maxFrames;
    this._active = true;
  }

  stop(): DebugFrame[] {
    this._active = false;
    const frames = this._frames;
    this.onStop?.(frames);
    return frames;
  }

  /**
   * Call from the render loop after mocap.applyLatestFrame() so bone quaternions
   * reflect the applied pose, not the previous frame.
   */
  capture(
    frame: PoseFrame,
    ikTargets: Pick<
      MocapDebugTargets,
      'leftWristTarget' | 'rightWristTarget' | 'leftAnkleTarget' | 'rightAnkleTarget' | 'hasArm' | 'hasLeg'
    >,
    calib: MocapCalibration,
  ): void {
    if (!this._active) return;
    // Skip render ticks where detection hasn't produced a new frame yet
    if (frame === this._lastFrame) return;
    this._lastFrame = frame;

    const t = performance.now() / 1000 - this._t0;

    // Landmarks
    const lm: DebugFrame['lm'] = frame.worldLandmarks.map((lmk) =>
      lmk ? [+lmk.x.toFixed(4), +lmk.y.toFixed(4), +lmk.z.toFixed(4), +(lmk.visibility ?? 1).toFixed(3)] : null,
    );

    // IK targets
    const v3 = (v: THREE.Vector3): V3 =>
      [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
    const ik: DebugFrame['ik'] = {
      lWrist: ikTargets.hasArm ? v3(ikTargets.leftWristTarget)  : null,
      rWrist: ikTargets.hasArm ? v3(ikTargets.rightWristTarget) : null,
      lAnkle: ikTargets.hasLeg ? v3(ikTargets.leftAnkleTarget)  : null,
      rAnkle: ikTargets.hasLeg ? v3(ikTargets.rightAnkleTarget) : null,
      hasArm: ikTargets.hasArm,
      hasLeg: ikTargets.hasLeg,
    };

    // Bone local quaternions
    const bones: DebugFrame['bones'] = {};
    const bonesWorld: DebugFrame['bonesWorld'] = {};
    const humanoid = this._vrm.humanoid;
    const tmpQ = new THREE.Quaternion();

    for (const name of KEY_BONES) {
      const node = humanoid.getNormalizedBoneNode(name as any);
      if (!node) continue;
      const q = node.quaternion;
      bones[name] = [+q.x.toFixed(5), +q.y.toFixed(5), +q.z.toFixed(5), +q.w.toFixed(5)];
      node.getWorldQuaternion(tmpQ);
      bonesWorld[name] = [+tmpQ.x.toFixed(5), +tmpQ.y.toFixed(5), +tmpQ.z.toFixed(5), +tmpQ.w.toFixed(5)];
    }

    const cs = calib.status();
    this._frames.push({
      t: +t.toFixed(3),
      lm,
      ik,
      bones,
      bonesWorld,
      calib: {
        body:       +cs.bodyScale.toFixed(4),
        lArm:       +cs.leftArmScale.toFixed(4),
        rArm:       +cs.rightArmScale.toFixed(4),
        calibrated: cs.calibrated,
      },
    });

    if (this._frames.length >= this._maxFrames) {
      this.stop();
    }
  }

  /** Download the recorded frames as a .json file. */
  download(filename = 'mocap_debug.json'): void {
    const blob = new Blob([JSON.stringify(this._frames, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Print a compact per-frame summary to the console.
   * Useful for quick inspection without downloading a file.
   */
  logSummary(): void {
    console.group(`[MocapDebug] ${this._frames.length} frames`);
    for (const f of this._frames) {
      const lh = f.lm[23]; const rh = f.lm[24];
      const hipY = lh && rh ? ((lh[1] + rh[1]) / 2).toFixed(3) : '?';
      const lw = f.lm[15]; const rw = f.lm[16];
      const lwVis = lw ? lw[3].toFixed(2) : '?';
      const rwVis = rw ? rw[3].toFixed(2) : '?';
      const hips = f.bones['hips'];
      const hQ = hips ? hips.map(v => v.toFixed(3)).join(',') : '?';
      console.log(
        `t=${f.t.toFixed(2)}s  hipY=${hipY}  lWvis=${lwVis} rWvis=${rwVis}` +
        `  ikArm=${f.ik.hasArm} ikLeg=${f.ik.hasLeg}` +
        `  body=${f.calib.body.toFixed(3)} lArm=${f.calib.lArm.toFixed(3)}` +
        `  hips=[${hQ}]`,
      );
    }
    console.groupEnd();
  }
}
