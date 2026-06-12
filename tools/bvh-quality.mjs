#!/usr/bin/env node
/**
 * BVH quality report: per-joint roughness (jitter) + velocity stats.
 *
 *   node tools/bvh-quality.mjs <file.bvh> [more.bvh ...]
 *
 * Roughness = mean angular deviation (deg) of each frame's rotation from the
 * slerp midpoint of its neighbours. Smooth motion scores ~0 regardless of
 * speed; detection jitter shows up directly. Mirrors
 * src/mocap/bvh/bvhQualityMetrics.ts — keep the math in sync.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function parseBvhMotion(text) {
  const jointNames = [];
  const jointRe = /(?:ROOT|JOINT)\s+(\S+)/g;
  const motionIdx = text.indexOf('\nMOTION');
  if (motionIdx < 0) return null;
  const hierarchy = text.slice(0, motionIdx);
  for (let m = jointRe.exec(hierarchy); m; m = jointRe.exec(hierarchy)) jointNames.push(m[1]);
  if (!jointNames.length) return null;

  const lines = text.slice(motionIdx).split('\n');
  const ftIdx = lines.findIndex((l) => l.startsWith('Frame Time:'));
  const frameTimeSec = ftIdx >= 0 ? Number(lines[ftIdx].split(':')[1]) : 1 / 30;
  const expected = 3 + jointNames.length * 3;
  const rows = [];
  for (let i = ftIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length !== expected || parts.some((v) => !Number.isFinite(v))) return null;
    rows.push(parts);
  }
  return { jointNames, frameTimeSec, rows };
}

const _e = new THREE.Euler();
function quatAt(rows, frame, joint, out) {
  const base = 3 + joint * 3;
  _e.set(rows[frame][base + 2] * DEG2RAD, rows[frame][base + 1] * DEG2RAD, rows[frame][base] * DEG2RAD, 'ZYX');
  out.setFromEuler(_e);
}

function angleBetween(a, b) {
  return 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * RAD2DEG;
}

function computeQuality(text) {
  const parsed = parseBvhMotion(text);
  if (!parsed || parsed.rows.length < 3) return null;
  const { jointNames, frameTimeSec, rows } = parsed;
  const n = rows.length;
  const fps = 1 / frameTimeSec;
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const qc = new THREE.Quaternion();
  const qm = new THREE.Quaternion();

  const perJoint = jointNames.map((name, j) => {
    let velSum = 0, velMax = 0, roughSum = 0, roughMax = 0;
    for (let i = 1; i < n; i++) {
      quatAt(rows, i - 1, j, qa);
      quatAt(rows, i, j, qb);
      const vel = angleBetween(qa, qb) * fps;
      velSum += vel;
      if (vel > velMax) velMax = vel;
      if (i < n - 1) {
        quatAt(rows, i + 1, j, qc);
        qm.copy(qa).slerp(qc, 0.5);
        const rough = angleBetween(qb, qm);
        roughSum += rough;
        if (rough > roughMax) roughMax = rough;
      }
    }
    return {
      name,
      meanVel: velSum / (n - 1),
      maxVel: velMax,
      rough: roughSum / (n - 2),
      maxRough: roughMax,
    };
  });

  let posRoughSum = 0;
  for (let i = 1; i < n - 1; i++) {
    let d2 = 0;
    for (let c = 0; c < 3; c++) {
      const mid = (rows[i - 1][c] + rows[i + 1][c]) / 2;
      d2 += (rows[i][c] - mid) ** 2;
    }
    posRoughSum += Math.sqrt(d2);
  }

  return {
    frames: n,
    overall: perJoint.reduce((s, q) => s + q.rough, 0) / perJoint.length,
    hipsPosMm: (posRoughSum / (n - 2)) * 1000,
    perJoint: perJoint.sort((a, b) => b.rough - a.rough),
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.log('Usage: node tools/bvh-quality.mjs <file.bvh> [more.bvh ...]');
  process.exit(1);
}

for (const file of files) {
  const report = computeQuality(readFileSync(file, 'utf8'));
  if (!report) {
    console.log(`${file}: not a parsable BVH with ≥3 frames`);
    continue;
  }
  console.log(`\n${file}`);
  console.log(`  frames=${report.frames} overallRoughness=${report.overall.toFixed(3)}° hipsPos=${report.hipsPosMm.toFixed(1)}mm`);
  console.log('  worst joints (roughness° / maxRough° / meanVel°/s):');
  for (const q of report.perJoint.slice(0, 10)) {
    console.log(`    ${q.name.padEnd(24)} ${q.rough.toFixed(3).padStart(7)}  ${q.maxRough.toFixed(1).padStart(6)}  ${q.meanVel.toFixed(0).padStart(5)}`);
  }
}
