import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { BVH_JOINTS, BVH_FRAME_TIME } from './bvhRecorder';

// ── Types ─────────────────────────────────────────────────────────────────────

export const EFFECTOR_BONES = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'head'] as const;
export type EffectorName = typeof EFFECTOR_BONES[number];

export interface PoseSnapshot {
  frame: number;
  bones:     Record<string, [number, number, number, number]>; // quat x,y,z,w
  hips:      [number, number, number];                          // world pos
  effectors: Record<string, [number, number, number]>;          // world pos
}

export interface BoneDiff {
  name: string;
  quatAngleMax: number;
  quatAngleMean: number;
  eulerMaxDeg: [number, number, number]; // z,y,x max abs deltas
  nearSingularity: boolean;              // pitch y close to ±90° in any frame
}

export interface FrameDiff {
  frame: number;
  totalQuatAngle: number; // sum across bones
  maxBone: string;
  maxBoneAngle: number;
  hipsError: number;
}

export interface VerificationReport {
  frameCount: number;
  bones: BoneDiff[];
  frames: FrameDiff[];
  effectorMean: Record<string, number>;
  effectorMax:  Record<string, number>;
  hipsMean: number;
  hipsMax:  number;
  worstBone: string;
  worstBoneAngle: number;
  worstFrame: number;
  worstFrameAngle: number;
  meanQuatAngle: number;
  p95QuatAngle: number;
  maxQuatAngle: number;
  notes: string[];
}

// ── Shared diagnostic buffer ──────────────────────────────────────────────────
//
// Drop-in API for ad-hoc per-stage logging during a verify pass: call
// `diagLog(line)` from any pipeline stage and the modal will surface the
// collected lines in a copy-friendly section above the report. Currently no
// production code path calls `diagLog`, but the buffer remains wired through
// the modal so future investigations don't need plumbing.

const _diagBuffer: string[] = [];

/** Append a diagnostic line. Echoes to console.info as well for live tail. */
export function diagLog(line: string): void {
  _diagBuffer.push(line);
  console.info(line);
}

/** Returns and clears the buffered diagnostic lines. */
export function flushDiagBuffer(): string[] {
  const out = _diagBuffer.slice();
  _diagBuffer.length = 0;
  return out;
}

/** Discards any buffered diagnostic lines. */
export function clearDiagBuffer(): void {
  _diagBuffer.length = 0;
}

// ── Snapshot capture ──────────────────────────────────────────────────────────

/**
 * Capture the current normalized-bone pose. Call AFTER `vrm.update()` (or after
 * `applier.apply()` on the recording side) so world matrices + node.quaternion
 * reflect the committed frame.
 */
export function captureSnapshot(vrm: VRM, frameIdx: number): PoseSnapshot {
  const bones: Record<string, [number, number, number, number]> = {};
  const effectors: Record<string, [number, number, number]> = {};
  const hips: [number, number, number] = [0, 0, 0];

  const scratch = new THREE.Vector3();
  for (const joint of BVH_JOINTS) {
    const node = vrm.humanoid.getNormalizedBoneNode(joint.name as any);
    if (!node) { bones[joint.name] = [0, 0, 0, 1]; continue; }
    const q = node.quaternion;
    bones[joint.name] = [q.x, q.y, q.z, q.w];
  }

  // Local position — matches what AnimationMixer reads/writes during playback.
  // (See note in mocapController._getBvhHipsPosition.)
  const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips' as any);
  if (hipsNode) {
    hips[0] = hipsNode.position.x;
    hips[1] = hipsNode.position.y;
    hips[2] = hipsNode.position.z;
  }

  for (const name of EFFECTOR_BONES) {
    const node = vrm.humanoid.getNormalizedBoneNode(name as any);
    if (!node) { effectors[name] = [0, 0, 0]; continue; }
    node.getWorldPosition(scratch);
    effectors[name] = [scratch.x, scratch.y, scratch.z];
  }

  return { frame: frameIdx, bones, hips, effectors };
}

// ── Deterministic replay ──────────────────────────────────────────────────────

/**
 * Replay an AnimationClip frame-by-frame on a scratch mixer, capturing actual
 * bone state after each `vrm.update()`. Synchronous — blocks until done.
 *
 * After this returns, vrm is left in the state of the last replayed frame.
 */
export function replayClipWithSnapshots(
  vrm: VRM,
  clip: THREE.AnimationClip,
  frameCount: number,
): PoseSnapshot[] {
  const mixer = new THREE.AnimationMixer(vrm.scene);
  const action = mixer.clipAction(clip);
  action.play();

  const out: PoseSnapshot[] = [];
  for (let i = 0; i < frameCount; i++) {
    const t = i * BVH_FRAME_TIME;
    mixer.setTime(t);
    vrm.update(BVH_FRAME_TIME);
    out.push(captureSnapshot(vrm, i));
  }

  action.stop();
  mixer.uncacheClip(clip);
  mixer.uncacheRoot(vrm.scene);
  return out;
}

// ── Math helpers ──────────────────────────────────────────────────────────────

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _ea = new THREE.Euler();
const _eb = new THREE.Euler();
const RAD2DEG = 180 / Math.PI;

export function quatAngleDeg(a: [number, number, number, number], b: [number, number, number, number]): number {
  // angle between two unit quaternions (absolute, ignoring double cover)
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return 2 * Math.acos(dot) * RAD2DEG;
}

export function eulerZYXDeg(q: [number, number, number, number]): [number, number, number] {
  _qa.set(q[0], q[1], q[2], q[3]);
  _ea.setFromQuaternion(_qa, 'ZYX');
  return [_ea.z * RAD2DEG, _ea.y * RAD2DEG, _ea.x * RAD2DEG];
}

function vecDist(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

// ── Comparison ────────────────────────────────────────────────────────────────

export function compareSnapshots(
  expected: PoseSnapshot[],
  actual: PoseSnapshot[],
): VerificationReport {
  const n = Math.min(expected.length, actual.length);

  // Per-bone aggregates
  const perBone = new Map<string, { angles: number[]; ezMax: number; eyMax: number; exMax: number; nearSing: boolean }>();
  for (const j of BVH_JOINTS) {
    perBone.set(j.name, { angles: [], ezMax: 0, eyMax: 0, exMax: 0, nearSing: false });
  }

  const frames: FrameDiff[] = [];
  const allAngles: number[] = [];
  const effectorErrs: Record<string, number[]> = {};
  for (const name of EFFECTOR_BONES) effectorErrs[name] = [];
  const hipsErrs: number[] = [];

  for (let i = 0; i < n; i++) {
    const E = expected[i];
    const A = actual[i];
    let totalAngle = 0;
    let maxBone = '';
    let maxBoneAngle = 0;

    for (const j of BVH_JOINTS) {
      const qe = E.bones[j.name];
      const qa_ = A.bones[j.name];
      if (!qe || !qa_) continue;
      const ang = quatAngleDeg(qe, qa_);
      totalAngle += ang;
      if (ang > maxBoneAngle) { maxBoneAngle = ang; maxBone = j.name; }
      const pb = perBone.get(j.name)!;
      pb.angles.push(ang);
      allAngles.push(ang);

      const ze = eulerZYXDeg(qe);
      const za = eulerZYXDeg(qa_);
      pb.ezMax = Math.max(pb.ezMax, Math.abs(ze[0] - za[0]));
      pb.eyMax = Math.max(pb.eyMax, Math.abs(ze[1] - za[1]));
      pb.exMax = Math.max(pb.exMax, Math.abs(ze[2] - za[2]));
      // ZYX Euler has pitch = Y. Singularity near ±90°.
      if (Math.abs(ze[1]) > 85 || Math.abs(za[1]) > 85) pb.nearSing = true;
    }

    for (const name of EFFECTOR_BONES) {
      const ee = E.effectors[name], ea = A.effectors[name];
      if (ee && ea) effectorErrs[name].push(vecDist(ee, ea));
    }
    hipsErrs.push(vecDist(E.hips, A.hips));
    frames.push({ frame: i, totalQuatAngle: totalAngle, maxBone, maxBoneAngle, hipsError: hipsErrs[hipsErrs.length - 1] });
  }

  // Assemble BoneDiff list
  const bones: BoneDiff[] = [];
  let worstBone = '', worstBoneAngle = 0;
  for (const [name, pb] of perBone) {
    if (pb.angles.length === 0) continue;
    const sum = pb.angles.reduce((a, b) => a + b, 0);
    const max = Math.max(...pb.angles);
    const mean = sum / pb.angles.length;
    bones.push({
      name,
      quatAngleMax: max,
      quatAngleMean: mean,
      eulerMaxDeg: [pb.ezMax, pb.eyMax, pb.exMax],
      nearSingularity: pb.nearSing,
    });
    if (mean > worstBoneAngle) { worstBoneAngle = mean; worstBone = name; }
  }
  bones.sort((a, b) => b.quatAngleMean - a.quatAngleMean);

  // Frame worst
  let worstFrame = 0, worstFrameAngle = 0;
  for (const f of frames) {
    if (f.totalQuatAngle > worstFrameAngle) {
      worstFrameAngle = f.totalQuatAngle;
      worstFrame = f.frame;
    }
  }

  // Aggregate percentiles on flattened angle array
  const sortedAngles = [...allAngles].sort((a, b) => a - b);
  const meanQuat = allAngles.length > 0 ? allAngles.reduce((a, b) => a + b, 0) / allAngles.length : 0;
  const p95Quat  = percentile(sortedAngles, 0.95);
  const maxQuat  = sortedAngles[sortedAngles.length - 1] ?? 0;

  const effectorMean: Record<string, number> = {};
  const effectorMax:  Record<string, number> = {};
  for (const name of EFFECTOR_BONES) {
    const arr = effectorErrs[name];
    effectorMean[name] = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    effectorMax[name]  = arr.length > 0 ? Math.max(...arr) : 0;
  }

  const hipsMean = hipsErrs.length > 0 ? hipsErrs.reduce((a, b) => a + b, 0) / hipsErrs.length : 0;
  const hipsMax  = hipsErrs.length > 0 ? Math.max(...hipsErrs) : 0;

  const notes: string[] = [];
  if (expected.length !== actual.length) {
    notes.push(`⚠ frame-count mismatch: expected=${expected.length} actual=${actual.length}; compared first ${n}`);
  }
  if (maxQuat > 5) notes.push(`⚠ maxQuatAngle=${maxQuat.toFixed(2)}° — significant drift`);
  if (hipsMax > 0.02) notes.push(`⚠ hipsMax=${(hipsMax * 1000).toFixed(1)}mm — position drift (check scale units)`);
  const singBones = bones.filter((b) => b.nearSingularity).map((b) => b.name);
  if (singBones.length > 0) {
    notes.push(`ℹ near-gimbal bones (ZYX pitch > 85°): ${singBones.join(', ')} — Euler round-trip may be unstable here`);
  }
  if (notes.length === 0) notes.push('✓ round-trip within expected tolerance');

  return {
    frameCount: n,
    bones, frames,
    effectorMean, effectorMax,
    hipsMean, hipsMax,
    worstBone, worstBoneAngle,
    worstFrame, worstFrameAngle,
    meanQuatAngle: meanQuat,
    p95QuatAngle:  p95Quat,
    maxQuatAngle:  maxQuat,
    notes,
  };
}

// ── Report formatting ─────────────────────────────────────────────────────────

export function formatReport(r: VerificationReport): string {
  const lines: string[] = [];
  lines.push(`=== BVH Round-Trip Verification ===`);
  lines.push(`Frames compared: ${r.frameCount}`);
  lines.push('');
  lines.push(`Mean quat angle: ${r.meanQuatAngle.toFixed(3)}°`);
  lines.push(`p95  quat angle: ${r.p95QuatAngle.toFixed(3)}°`);
  lines.push(`Max  quat angle: ${r.maxQuatAngle.toFixed(3)}°`);
  lines.push(`Worst bone:  ${r.worstBone || '—'}  (mean ${r.worstBoneAngle.toFixed(3)}°)`);
  lines.push(`Worst frame: ${r.worstFrame}  (total ${r.worstFrameAngle.toFixed(2)}°)`);
  lines.push('');
  lines.push(`Hips pos — mean: ${(r.hipsMean * 1000).toFixed(2)}mm  max: ${(r.hipsMax * 1000).toFixed(2)}mm`);
  lines.push('');
  lines.push('Effector position error (mm):');
  for (const name of EFFECTOR_BONES) {
    const m = (r.effectorMean[name] ?? 0) * 1000;
    const x = (r.effectorMax[name]  ?? 0) * 1000;
    lines.push(`  ${name.padEnd(10)} mean=${m.toFixed(2)}  max=${x.toFixed(2)}`);
  }
  lines.push('');
  lines.push('Top 10 bones by mean quat angle:');
  for (const b of r.bones.slice(0, 10)) {
    const flag = b.nearSingularity ? ' ⚠sing' : '';
    lines.push(
      `  ${b.name.padEnd(22)} mean=${b.quatAngleMean.toFixed(3)}°  max=${b.quatAngleMax.toFixed(3)}°` +
      `  euler ΔZ=${b.eulerMaxDeg[0].toFixed(2)}° ΔY=${b.eulerMaxDeg[1].toFixed(2)}° ΔX=${b.eulerMaxDeg[2].toFixed(2)}°${flag}`,
    );
  }
  lines.push('');
  lines.push('Notes:');
  for (const n of r.notes) lines.push(`  ${n}`);
  return lines.join('\n');
}
