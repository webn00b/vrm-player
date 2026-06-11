#!/usr/bin/env node
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import {
  runMotionJsonToBvh,
  usage as videoUsage,
} from './video-to-bvh.mjs';

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
  return value;
}

function stripMotionExtension(path) {
  for (const suffix of ['.motion.json', '.wham.json', '.gvhmr.json', '.json']) {
    if (path.toLowerCase().endsWith(suffix)) return basename(path).slice(0, -suffix.length);
  }
  return basename(path);
}

export function parseMotionArgs(argv, cwd = process.cwd()) {
  const parsed = {
    input: undefined,
    output: undefined,
    vrm: undefined,
    url: undefined,
    port: 5333,
    timeoutMs: 180_000,
    headed: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') parsed.help = true;
    else if (arg === '--headed') parsed.headed = true;
    else if (arg === '-o' || arg === '--output') {
      parsed.output = readFlagValue(argv, i, arg);
      i += 1;
    } else if (arg === '--vrm') {
      parsed.vrm = readFlagValue(argv, i, arg);
      i += 1;
    } else if (arg === '--url') {
      parsed.url = readFlagValue(argv, i, arg);
      i += 1;
    } else if (arg === '--port') {
      parsed.port = Number(readFlagValue(argv, i, arg));
      i += 1;
    } else if (arg === '--timeout') {
      parsed.timeoutMs = Number(readFlagValue(argv, i, arg));
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!parsed.input) {
      parsed.input = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }
  if (parsed.help) return parsed;
  if (!parsed.input) throw new Error('A motion JSON file is required');
  const input = isAbsolute(parsed.input) ? parsed.input : resolve(cwd, parsed.input);
  if (!existsSync(input) || !statSync(input).isFile()) throw new Error(`Motion JSON file does not exist: ${input}`);
  const output = parsed.output
    ? (isAbsolute(parsed.output) ? parsed.output : resolve(cwd, parsed.output))
    : join(dirname(input), `${stripMotionExtension(input)}.bvh`);
  const vrm = parsed.vrm ? (isAbsolute(parsed.vrm) ? parsed.vrm : resolve(cwd, parsed.vrm)) : undefined;
  return {
    input,
    output,
    ...(vrm ? { vrm } : {}),
    ...(parsed.url ? { url: parsed.url } : {}),
    port: parsed.port,
    timeoutMs: parsed.timeoutMs,
    headed: parsed.headed,
  };
}

export function usage() {
  return [
    'Usage:',
    '  node tools/motion-json-to-bvh.mjs <motion.json> [--output out.bvh] [--vrm avatar.vrm] [--headed]',
    '',
    'Shared browser options mirror video-to-bvh:',
    videoUsage().split('\n').slice(3).join('\n'),
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseMotionArgs(argv, cwd);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  mkdirSync(dirname(options.output), { recursive: true });
  const result = await runMotionJsonToBvh(options);
  console.log(`[motion-json-to-bvh] saved ${result.output}`);
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
