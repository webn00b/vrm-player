#!/usr/bin/env node
import {
  parseCliArgs,
  resolveCliOptions,
  resolveMatrixOutputs,
  runValidationMatrix,
  usage as baseUsage,
} from './video-to-bvh.mjs';

export function usage() {
  return [
    baseUsage(),
    '',
    'Matrix mode writes safe/full/off variants:',
    '  output.safe.bvh',
    '  output.full.bvh',
    '  output.off.bvh',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const parsed = parseCliArgs(argv);
  if (parsed.help) {
    console.log(usage());
    return 0;
  }
  const options = resolveCliOptions(parsed, cwd);
  const outputs = resolveMatrixOutputs(options.output);
  console.log(`[video-to-bvh:matrix] processing ${options.video}`);
  const results = await runValidationMatrix({ ...options, outputs });
  for (const mode of ['safe', 'full', 'off']) {
    console.log(`[video-to-bvh:matrix] saved ${mode} ${results[mode].output}`);
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
