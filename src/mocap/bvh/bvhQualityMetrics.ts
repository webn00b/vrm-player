import * as THREE from 'three';

/**
 * Post-recording quality metrics for BVH motion.
 *
 * The key number is **roughness**: for each interior frame, the angular
 * distance (deg) between the actual rotation q[i] and the slerp midpoint of
 * its neighbours slerp(q[i-1], q[i+1], 0.5). Smooth motion — even fast motion
 * — is locally near-linear in quaternion space, so its roughness is ~0; frame
 * jitter shows up directly. This separates "noisy" from "dynamic", which raw
 * frame-to-frame deltas cannot.
 *
 * Velocity stats (deg/s) are reported alongside so a joint that barely moves
 * but vibrates is distinguishable from one sweeping fast and clean.
 */

export interface JointQuality {
  name: string;
  /** Mean angular speed, deg/s. */
  meanVelDegPerSec: number;
  /** Peak angular speed, deg/s. */
  maxVelDegPerSec: number;
  /** Mean deviation from the neighbour slerp midpoint, deg. ~0 for smooth motion. */
  roughnessDeg: number;
  /** Worst single-frame deviation, deg. */
  maxRoughnessDeg: number;
}

export interface BvhQualityReport {
  frames: number;
  frameTimeSec: number;
  /** Mean roughness across all joints, deg. The single-number jitter score. */
  overallRoughnessDeg: number;
  /** Hips position roughness (deviation from neighbour midpoint), millimetres. */
  hipsPositionRoughnessMm: number;
  /** Joints sorted by roughness, worst first. */
  perJoint: JointQuality[];
}

interface ParsedMotion {
  jointNames: string[];
  frameTimeSec: number;
  /** rows[frame] = [posX, posY, posZ, then per joint Zrot Yrot Xrot (deg)]. */
  rows: number[][];
}

/** Parse the HIERARCHY joint order + MOTION rows of a BVH file. */
export function parseBvhMotion(text: string): ParsedMotion | null {
  const jointNames: string[] = [];
  const jointRe = /(?:ROOT|JOINT)\s+(\S+)/g;
  const motionIdx = text.indexOf('\nMOTION');
  if (motionIdx < 0) return null;
  const hierarchy = text.slice(0, motionIdx);
  for (let m = jointRe.exec(hierarchy); m; m = jointRe.exec(hierarchy)) {
    jointNames.push(m[1]);
  }
  if (!jointNames.length) return null;

  const lines = text.slice(motionIdx).split('\n');
  const ftLine = lines.find((l) => l.startsWith('Frame Time:'));
  const frameTimeSec = ftLine ? Number(ftLine.split(':')[1]) : 1 / 30;
  const ftIdx = lines.findIndex((l) => l.startsWith('Frame Time:'));
  const expected = 3 + jointNames.length * 3;
  const rows: number[][] = [];
  for (let i = ftIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length !== expected || parts.some((v) => !Number.isFinite(v))) return null;
    rows.push(parts);
  }
  return { jointNames, frameTimeSec, rows };
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

const _e = new THREE.Euler();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _qm = new THREE.Quaternion();

function quatAt(rows: number[][], frame: number, joint: number, out: THREE.Quaternion): void {
  const base = 3 + joint * 3;
  _e.set(
    rows[frame][base + 2] * DEG2RAD, // X
    rows[frame][base + 1] * DEG2RAD, // Y
    rows[frame][base + 0] * DEG2RAD, // Z
    'ZYX',
  );
  out.setFromEuler(_e);
}

function angleBetween(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const dot = Math.min(1, Math.abs(a.dot(b)));
  return 2 * Math.acos(dot) * RAD2DEG;
}

/** Compute the quality report for a BVH text. Null when the file has <3 frames. */
export function computeBvhQuality(text: string): BvhQualityReport | null {
  const parsed = parseBvhMotion(text);
  if (!parsed || parsed.rows.length < 3) return null;
  const { jointNames, frameTimeSec, rows } = parsed;
  const n = rows.length;
  const fps = 1 / frameTimeSec;

  const perJoint: JointQuality[] = [];
  for (let j = 0; j < jointNames.length; j++) {
    let velSum = 0;
    let velMax = 0;
    let roughSum = 0;
    let roughMax = 0;
    for (let i = 1; i < n; i++) {
      quatAt(rows, i - 1, j, _qa);
      quatAt(rows, i, j, _qb);
      const vel = angleBetween(_qa, _qb) * fps;
      velSum += vel;
      if (vel > velMax) velMax = vel;
      if (i < n - 1) {
        quatAt(rows, i + 1, j, _qc);
        _qm.copy(_qa).slerp(_qc, 0.5);
        const rough = angleBetween(_qb, _qm);
        roughSum += rough;
        if (rough > roughMax) roughMax = rough;
      }
    }
    perJoint.push({
      name: jointNames[j],
      meanVelDegPerSec: velSum / (n - 1),
      maxVelDegPerSec: velMax,
      roughnessDeg: roughSum / (n - 2),
      maxRoughnessDeg: roughMax,
    });
  }

  let posRoughSum = 0;
  for (let i = 1; i < n - 1; i++) {
    let d2 = 0;
    for (let c = 0; c < 3; c++) {
      const mid = (rows[i - 1][c] + rows[i + 1][c]) / 2;
      d2 += (rows[i][c] - mid) ** 2;
    }
    posRoughSum += Math.sqrt(d2);
  }

  const overall = perJoint.reduce((s, q) => s + q.roughnessDeg, 0) / perJoint.length;
  return {
    frames: n,
    frameTimeSec,
    overallRoughnessDeg: overall,
    hipsPositionRoughnessMm: (posRoughSum / (n - 2)) * 1000,
    perJoint: [...perJoint].sort((a, b) => b.roughnessDeg - a.roughnessDeg),
  };
}

/** Compact single-line summary for console logging. */
export function formatBvhQualitySummary(report: BvhQualityReport): string {
  const worst = report.perJoint.slice(0, 5)
    .map((q) => `${q.name}=${q.roughnessDeg.toFixed(2)}°`)
    .join(' ');
  return (
    `roughness=${report.overallRoughnessDeg.toFixed(3)}° ` +
    `hipsPos=${report.hipsPositionRoughnessMm.toFixed(1)}mm ` +
    `worst: ${worst}`
  );
}
