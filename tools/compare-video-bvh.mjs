#!/usr/bin/env node
/**
 * Visual A/B: source video next to the avatar's BVH render, time-aligned.
 *
 *   node tools/compare-video-bvh.mjs <video> [options]
 *
 * Options:
 *   --bvh <path>      Reuse an existing BVH (skip conversion)
 *   --out <dir>       Output directory. Default: <video dir>/compare
 *   --offset <sec>    Source time of BVH frame 0. Default: 1.5 (preroll)
 *   --sheet-fps <n>   Contact-sheet sampling rate. Default: 1
 *   --cols <n>        Contact-sheet columns (pairs per row). Default: 2
 *   --headed          Show Chromium during conversion/render
 *
 * Outputs into <out>:
 *   take.bvh / take.bvh.external.bvh / take.bvh.lifted.json   (if converted)
 *   avatar.webm       avatar render of the BVH
 *   compare.mp4       side-by-side video (source | avatar)
 *   contact.png       grid of side-by-side stills — agent/human reviewable
 *
 * Requires ffmpeg on PATH.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const o = { video: undefined, bvh: undefined, out: undefined, offset: 1.5, sheetFps: 1, cols: 2, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bvh') o.bvh = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--offset') o.offset = Number(argv[++i]);
    else if (a === '--sheet-fps') o.sheetFps = Number(argv[++i]);
    else if (a === '--cols') o.cols = Number(argv[++i]);
    else if (a === '--headed') o.headed = true;
    else if (!a.startsWith('-') && !o.video) o.video = a;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!o.video) throw new Error('Usage: node tools/compare-video-bvh.mjs <video> [--bvh x.bvh] [--out dir]');
  return o;
}

function run(cmd, args, label) {
  console.log(`[compare] ${label}`);
  const res = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], cwd: root });
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status})`);
}

function ffprobeDuration(path) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path,
  ]).toString().trim();
  return Number(out);
}

const opts = parseArgs(process.argv.slice(2));
const video = resolve(opts.video);
if (!existsSync(video)) throw new Error(`Video not found: ${video}`);
const outDir = resolve(opts.out ?? join(dirname(video), 'compare'));
mkdirSync(outDir, { recursive: true });

// 1. Convert (unless a BVH was supplied).
let bvh = opts.bvh ? resolve(opts.bvh) : join(outDir, 'take.bvh');
if (!opts.bvh) {
  run('node', [
    'tools/video-to-bvh.mjs', video, '-o', bvh, '--timeout', '900000',
    ...(opts.headed ? ['--headed'] : []),
  ], `converting ${basename(video)} → BVH`);
}

// 2. Render the avatar.
const avatarWebm = join(outDir, 'avatar.webm');
run('node', [
  'tools/bvh-to-video.mjs', bvh, '-o', avatarWebm, '--timeout', '600000',
  ...(opts.headed ? ['--headed'] : []),
], 'rendering avatar');

// 3. Side-by-side video, source trimmed to the BVH's start offset.
const compareMp4 = join(outDir, 'compare.mp4');
const avatarDur = ffprobeDuration(avatarWebm);
run('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-ss', String(opts.offset), '-i', video,
  '-i', avatarWebm,
  '-filter_complex',
  // Scale by HEIGHT: hstack needs equal heights and source aspect varies
  // (portrait phone videos vs the 16:9 avatar render).
  '[0:v]scale=-2:480,fps=30[a];[1:v]scale=-2:480,fps=30[b];[a][b]hstack=inputs=2[v]',
  '-map', '[v]', '-t', String(avatarDur),
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
  compareMp4,
], 'building side-by-side compare.mp4');

// 4. Contact sheet — one PNG grid of synchronized pairs.
const contact = join(outDir, 'contact.png');
const pairCount = Math.max(1, Math.floor(avatarDur * opts.sheetFps));
const rows = Math.ceil(pairCount / opts.cols);
run('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-i', compareMp4,
  '-vf', `fps=${opts.sheetFps},scale=720:-2,tile=${opts.cols}x${rows}`,
  '-frames:v', '1', contact,
], `building contact sheet (${pairCount} pairs)`);

console.log(`\n[compare] done:\n  ${compareMp4}\n  ${contact}`);
