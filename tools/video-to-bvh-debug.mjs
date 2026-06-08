#!/usr/bin/env node
import { bvhSummary, main as videoToBvhMain } from './video-to-bvh.mjs';

function pairOutputPaths(argv) {
  const outputIndex = argv.findIndex((arg) => arg === '--output' || arg === '-o');
  const output = outputIndex >= 0 ? argv[outputIndex + 1] : null;
  if (!output) return [];
  const dot = output.toLowerCase().endsWith('.bvh') ? output.slice(0, -4) : output;
  return [`${dot}.corrected.bvh`, `${dot}.raw.bvh`];
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = [...argv];
  if (!args.includes('--headed')) args.push('--headed');
  if (!args.includes('--validation-pair') && !args.includes('--pair')) args.push('--validation-pair');
  const code = await videoToBvhMain(args, cwd);
  for (const path of pairOutputPaths(args)) {
    try {
      const summary = bvhSummary(path);
      console.log(`[video-to-bvh:debug] ${summary.path} frames=${summary.frames} bytes=${summary.bytes}`);
    } catch {
      // The base command already reported conversion errors.
    }
  }
  return code;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
