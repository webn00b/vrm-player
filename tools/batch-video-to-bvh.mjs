#!/usr/bin/env node
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import {
  listConvertibleFiles,
  runValidationPair,
  runVideoToBvh,
  VIDEO_EXTENSIONS,
} from './video-to-bvh.mjs';

function valueAfter(argv, flag, fallback = undefined) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : fallback;
}

export function parseBatchArgs(argv, cwd = process.cwd()) {
  const input = valueAfter(argv, '--input') ?? argv.find((arg) => !arg.startsWith('-'));
  if (!input) throw new Error('Batch video conversion requires an input file or directory');
  const outputDir = valueAfter(argv, '--output-dir', 'converted-bvh');
  const vrm = valueAfter(argv, '--vrm');
  const url = valueAfter(argv, '--url');
  const timeout = Number(valueAfter(argv, '--timeout', '180000'));
  const port = Number(valueAfter(argv, '--port', '5333'));
  return {
    input: isAbsolute(input) ? input : resolve(cwd, input),
    outputDir: isAbsolute(outputDir) ? outputDir : resolve(cwd, outputDir),
    ...(vrm ? { vrm: isAbsolute(vrm) ? vrm : resolve(cwd, vrm) } : {}),
    ...(url ? { url } : {}),
    timeoutMs: timeout,
    port,
    headed: argv.includes('--headed'),
    validationPair: argv.includes('--validation-pair') || argv.includes('--pair'),
  };
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseBatchArgs(argv, cwd);
  const files = listConvertibleFiles(options.input, VIDEO_EXTENSIONS);
  if (files.length === 0) throw new Error(`No video files found in ${options.input}`);

  console.log(`[batch-video-to-bvh] ${files.length} file(s)`);
  for (const file of files) {
    const base = basename(file, extname(file));
    const output = join(options.outputDir, `${base}.bvh`);
    if (options.validationPair) {
      await runValidationPair({ ...options, video: file, output });
    } else {
      await runVideoToBvh({ ...options, video: file, output, recordingClampMode: 'safe' });
    }
    console.log(`[batch-video-to-bvh] converted ${file}`);
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
