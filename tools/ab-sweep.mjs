#!/usr/bin/env node
/**
 * ab-sweep — convert one video under several pipeline configs and score each,
 * so retarget tuning is driven by numbers instead of eyeballing.
 *
 *   node tools/ab-sweep.mjs <video> [--configs baseline,no-lift,no-smooth,...]
 *                           [--keep] [--timeout ms]
 *
 * For each config it runs tools/video-to-bvh.mjs with the matching flags, then
 * tools/match-score.mjs (screen-plane fidelity) and tools/anatomy-check.mjs
 * (reference-free plausibility) on the result, and prints a comparison table.
 *
 * Built-in configs (each flips ONE stage off the all-on baseline, isolating
 * its contribution):
 *   baseline   — everything on (lifting, chain-scale, offline-smoothing, auto-trim)
 *   no-lift    — --lifting off
 *   no-smooth  — --offline-smoothing off
 *   crop       — --crop-redetect on
 *
 * Outputs land in <video dir>/sweep/<config>.bvh* (removed unless --keep).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CONFIGS = {
  baseline:  [],
  'no-lift': ['--lifting', 'off'],
  'no-smooth': ['--offline-smoothing', 'off'],
  crop:      ['--crop-redetect', 'on'],
};

function parseArgs(argv) {
  const o = { video: undefined, configs: ['baseline', 'no-lift', 'no-smooth'], keep: false, timeout: 1200000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--configs') o.configs = argv[++i].split(',');
    else if (a === '--keep') o.keep = true;
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else if (!a.startsWith('-') && !o.video) o.video = a;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!o.video) throw new Error('Usage: node tools/ab-sweep.mjs <video> [--configs a,b,c] [--keep]');
  return o;
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

const opts = parseArgs(process.argv.slice(2));
const video = resolve(opts.video);
const outDir = join(dirname(video), 'sweep');
mkdirSync(outDir, { recursive: true });

const rows = [];
for (const name of opts.configs) {
  const flags = CONFIGS[name];
  if (!flags) { console.error(`unknown config "${name}" — skipping`); continue; }
  const bvh = join(outDir, `${name}.bvh`);
  console.log(`\n[ab-sweep] === ${name} === ${flags.join(' ') || '(baseline)'}`);
  sh('node', ['tools/video-to-bvh.mjs', video, '-o', bvh, '--timeout', String(opts.timeout), ...flags]);

  const ext = `${bvh}.external.bvh`;
  const dump = `${bvh}.lifted.json`;
  // match-score needs the 2D dump, which only the two-pass path writes; the
  // single-pass (offline-smoothing off) config has none → score n/a there.
  let match = NaN;
  if (existsSync(dump)) {
    const matchOut = sh('node', ['tools/match-score.mjs', ext, dump]);
    match = Number(matchOut.match(/MATCH SCORE[^:]*:\s*([\d.]+)/)?.[1] ?? NaN);
  }
  const anatOut = sh('node', ['tools/anatomy-check.mjs', ext]);
  const anat = Number(anatOut.match(/anatomy score:\s*([\d.]+)/)?.[1] ?? NaN);
  const flags2 = [...anatOut.matchAll(/^ {2}([a-z][a-z ]+?) {2,}(\d+) hits/gm)]
    .map((m) => `${m[1].trim()}:${m[2]}`);
  rows.push({ name, match, anat, flags: flags2.join(' ') || 'clean' });
}

console.log(`\n\n=== A/B SWEEP: ${basename(video)} ===`);
console.log('config        match°   anatomy   flags');
for (const r of rows) {
  console.log(
    `${r.name.padEnd(13)} ${Number.isFinite(r.match) ? r.match.toFixed(1).padStart(6) : '   n/a'}` +
    `  ${Number.isFinite(r.anat) ? r.anat.toFixed(3).padStart(7) : '    n/a'}   ${r.flags}`,
  );
}
const best = rows.filter((r) => Number.isFinite(r.match)).sort((a, b) => a.match - b.match)[0];
if (best) console.log(`\nbest screen-plane match: ${best.name} (${best.match.toFixed(1)}°)`);

if (!opts.keep) {
  rmSync(outDir, { recursive: true, force: true });
  console.log('(sweep artifacts removed; pass --keep to retain)');
}
