#!/usr/bin/env node
import { main as videoToBvhMain } from './video-to-bvh.mjs';

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = argv.includes('--validation-pair') || argv.includes('--pair')
    ? argv
    : [...argv, '--validation-pair'];
  return videoToBvhMain(args, cwd);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
