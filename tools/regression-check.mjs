#!/usr/bin/env node
/**
 * regression-check — lock in retarget quality against silent regressions.
 *
 *   node tools/regression-check.mjs            # check vs golden, exit 1 on regression
 *   node tools/regression-check.mjs --update   # capture current scores as the new golden
 *
 * For each fixture it converts the video (tools/video-to-bvh.mjs) and scores:
 *   - match  : screen-plane limb-direction error vs the video's 2D (match-score)
 *   - anat   : reference-free plausibility violations/frame (anatomy-check)
 *   - mpjpe  : 3D error vs ground truth, mm (bvh-vs-gt, only fixtures with gt)
 * Then compares to tools/regression-golden.json; a score worse than golden by
 * more than the tolerance fails the run.
 *
 * Fixtures live under data/ (gitignored), so this is a LOCAL / nightly guard,
 * not CI. think/ges are excluded — they are 1 fps stock slideshows, not motion.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = join(root, 'tools/regression-golden.json');

const FIXTURES = [
  { name: 'ted1',  video: 'data/test-videos/ted1.mp4' },
  { name: 'video', video: 'data/test-videos/video.mp4' },
  { name: 'aist',  video: 'data/multiview-test/aist/gBR_sBM_d04_mBR0_ch01/gBR_sBM_c02_d04_mBR0_ch01.mp4',
    gt: 'data/multiview-test/aist/gt/gBR_sBM_cAll_d04_mBR0_ch01.gt.json', gtOffset: '1.479' },
];

// Allowed worsening before a fixture fails.
const TOL = { match: 2.0, anat: 0.03, mpjpe: 15 };

const update = process.argv.includes('--update');

function sh(args) {
  return execFileSync('node', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}
function num(re, s) { const m = s.match(re); return m ? Number(m[1]) : NaN; }

const results = {};
for (const fx of FIXTURES) {
  if (!existsSync(join(root, fx.video))) { console.warn(`[skip] ${fx.name}: video missing`); continue; }
  console.log(`\n[regression] ${fx.name} …`);
  const bvh = join(root, `data/.regression-${fx.name}.bvh`);
  sh(['tools/video-to-bvh.mjs', join(root, fx.video), '-o', bvh, '--timeout', '1200000']);
  const ext = `${bvh}.external.bvh`;
  const dump = `${bvh}.lifted.json`;
  const r = {};
  if (existsSync(dump)) r.match = num(/MATCH SCORE[^:]*:\s*([\d.]+)/, sh(['tools/match-score.mjs', ext, dump]));
  r.anat = num(/anatomy score:\s*([\d.]+)/, sh(['tools/anatomy-check.mjs', ext]));
  if (fx.gt) r.mpjpe = num(/MPJPE[^:]*:\s*([\d.]+)/, sh(['tools/bvh-vs-gt.mjs', ext, join(root, fx.gt), '--offset', fx.gtOffset]));
  results[fx.name] = r;
}

if (update) {
  writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
  console.log(`\n[regression] golden updated: ${GOLDEN}`);
  process.exit(0);
}

if (!existsSync(GOLDEN)) { console.error('no golden — run with --update first'); process.exit(2); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
let failed = false;
console.log('\n=== REGRESSION REPORT (current vs golden, Δ; tolerance) ===');
for (const [name, cur] of Object.entries(results)) {
  const g = golden[name] ?? {};
  for (const [k, tol] of Object.entries(TOL)) {
    if (cur[k] === undefined || g[k] === undefined) continue;
    const d = cur[k] - g[k];
    const bad = d > tol;
    if (bad) failed = true;
    console.log(`  ${name}.${k.padEnd(5)} ${cur[k].toFixed(3)} vs ${g[k].toFixed(3)}  Δ${d >= 0 ? '+' : ''}${d.toFixed(3)} (±${tol})${bad ? '  ✗ REGRESSED' : ''}`);
  }
}
console.log(failed ? '\nFAIL: a fixture regressed beyond tolerance' : '\nOK: no regressions');
process.exit(failed ? 1 : 0);
