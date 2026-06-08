#!/usr/bin/env node
import { basename, isAbsolute, join, resolve } from 'node:path';
import { listConvertibleFiles, MOTION_EXTENSIONS, runMotionJsonToBvh } from './video-to-bvh.mjs';

function valueAfter(argv, flag, fallback = undefined) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : fallback;
}

function stripMotionExtension(path) {
  const lower = path.toLowerCase();
  for (const suffix of ['.motion.json', '.wham.json', '.gvhmr.json', '.json']) {
    if (lower.endsWith(suffix)) return basename(path).slice(0, -suffix.length);
  }
  return basename(path);
}

export function parseBatchMotionArgs(argv, cwd = process.cwd()) {
  const input = valueAfter(argv, '--input') ?? argv.find((arg) => !arg.startsWith('-'));
  if (!input) throw new Error('Batch motion conversion requires an input file or directory');
  const outputDir = valueAfter(argv, '--output-dir', 'converted-bvh');
  const vrm = valueAfter(argv, '--vrm');
  const url = valueAfter(argv, '--url');
  return {
    input: isAbsolute(input) ? input : resolve(cwd, input),
    outputDir: isAbsolute(outputDir) ? outputDir : resolve(cwd, outputDir),
    ...(vrm ? { vrm: isAbsolute(vrm) ? vrm : resolve(cwd, vrm) } : {}),
    ...(url ? { url } : {}),
    port: Number(valueAfter(argv, '--port', '5333')),
    timeoutMs: Number(valueAfter(argv, '--timeout', '180000')),
    headed: argv.includes('--headed'),
  };
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseBatchMotionArgs(argv, cwd);
  const files = listConvertibleFiles(options.input, MOTION_EXTENSIONS);
  if (files.length === 0) throw new Error(`No motion JSON files found in ${options.input}`);

  console.log(`[batch-motion-to-bvh] ${files.length} file(s)`);
  for (const file of files) {
    const output = join(options.outputDir, `${stripMotionExtension(file)}.bvh`);
    await runMotionJsonToBvh({ ...options, input: file, output });
    console.log(`[batch-motion-to-bvh] converted ${file}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
