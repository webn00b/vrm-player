import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import packageJson from '../../package.json';

const cliModuleUrl = new URL('../../tools/video-to-bvh.mjs', import.meta.url);

async function loadCli() {
  return import(cliModuleUrl.href) as Promise<{
    parseCliArgs: (argv: string[]) => unknown;
    readBvhFrameCount: (text: string) => number | null;
    assertBvhHasFrames: (text: string, output: string) => void;
    listConvertibleFiles: (input: string, extensions: string[]) => string[];
    resolveCliOptions: (parsed: unknown, cwd: string) => {
      video: string;
      output: string;
      outputs?: { corrected: string; raw: string };
      vrm?: string;
      url?: string;
      port: number;
      headed: boolean;
      timeoutMs: number;
      recordingClampMode: 'safe' | 'full' | 'off';
      validationPair: boolean;
    };
    resolveMatrixOutputs: (output: string, modes?: Array<'safe' | 'full' | 'off'>) => Record<string, string>;
  }>;
}

describe('video-to-bvh CLI options', () => {
  test('parses video conversion flags', async () => {
    const { parseCliArgs } = await loadCli();

    expect(parseCliArgs([
      './input.mp4',
      '--output', './out.bvh',
      '--vrm', './avatar.vrm',
      '--url', 'http://127.0.0.1:5333',
      '--port', '5444',
      '--timeout', '12345',
      '--validation-mode', 'full',
      '--validation-pair',
      '--headed',
    ])).toEqual({
      video: './input.mp4',
      output: './out.bvh',
      vrm: './avatar.vrm',
      url: 'http://127.0.0.1:5333',
      port: 5444,
      timeoutMs: 12345,
      recordingClampMode: 'full',
      validationPair: true,
      headed: true,
      help: false,
    });
  });

  test('resolves defaults and validates input files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vrm-video-cli-'));
    const video = join(dir, 'dance.mp4');
    writeFileSync(video, 'fake video placeholder');
    const { parseCliArgs, resolveCliOptions } = await loadCli();

    expect(resolveCliOptions(parseCliArgs([video]), dir)).toEqual({
      video,
      output: join(dir, 'dance.bvh'),
      port: 5333,
      headed: false,
      timeoutMs: 180_000,
      recordingClampMode: 'safe',
      validationPair: false,
    });
  });

  test('resolves validation comparison output pair paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vrm-video-cli-'));
    const video = join(dir, 'dance.mp4');
    writeFileSync(video, 'fake video placeholder');
    const { parseCliArgs, resolveCliOptions } = await loadCli();

    expect(resolveCliOptions(parseCliArgs([
      video,
      '--output', 'exports/dance.bvh',
      '--validation-pair',
    ]), dir)).toMatchObject({
      output: join(dir, 'exports/dance.bvh'),
      outputs: {
        corrected: join(dir, 'exports/dance.corrected.bvh'),
        raw: join(dir, 'exports/dance.raw.bvh'),
      },
      recordingClampMode: 'safe',
      validationPair: true,
    });
  });

  test('rejects invalid validation modes', async () => {
    const { parseCliArgs } = await loadCli();

    expect(() => parseCliArgs(['input.mp4', '--validation-mode', 'sometimes'])).toThrow(/validation-mode/i);
  });

  test('rejects missing video input', async () => {
    const { parseCliArgs, resolveCliOptions } = await loadCli();

    expect(() => resolveCliOptions(parseCliArgs([]), process.cwd())).toThrow(/video/i);
  });

  test('can be imported from a file URL for Node ESM callers', async () => {
    const mod = await import(pathToFileURL(join(process.cwd(), 'tools/video-to-bvh.mjs')).href);

    expect(mod).toHaveProperty('runVideoToBvh');
  });

  test('rejects downloaded BVH files with zero motion frames', async () => {
    const { readBvhFrameCount, assertBvhHasFrames } = await loadCli();

    expect(readBvhFrameCount('HIERARCHY\nMOTION\nFrames: 12\nFrame Time: 0.033333')).toBe(12);
    expect(readBvhFrameCount('not a bvh')).toBeNull();
    expect(() => assertBvhHasFrames('HIERARCHY\nMOTION\nFrames: 0\nFrame Time: 0.033333', 'empty.bvh'))
      .toThrow(/0 frames/i);
  });

  test('discovers convertible video and motion files in deterministic order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vrm-video-cli-'));
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'b.mov'), '');
    writeFileSync(join(dir, 'a.mp4'), '');
    writeFileSync(join(dir, 'notes.txt'), '');
    writeFileSync(join(dir, 'nested/c.webm'), '');
    const { listConvertibleFiles } = await loadCli();

    expect(listConvertibleFiles(dir, ['.mp4', '.mov', '.webm'])).toEqual([
      join(dir, 'a.mp4'),
      join(dir, 'b.mov'),
      join(dir, 'nested/c.webm'),
    ]);
    expect(listConvertibleFiles(dir, ['.motion.json', '.wham.json'])).toEqual([]);
  });

  test('resolves validation matrix output names', async () => {
    const { resolveMatrixOutputs } = await loadCli();

    expect(resolveMatrixOutputs('/tmp/take.bvh')).toEqual({
      safe: '/tmp/take.safe.bvh',
      full: '/tmp/take.full.bvh',
      off: '/tmp/take.off.bvh',
    });
  });

  test('conversion entrypoint scripts are importable and wired to package scripts', async () => {
    const scripts = [
      'video-to-bvh-pair',
      'video-to-bvh-matrix',
      'video-to-bvh-debug',
      'batch-video-to-bvh',
      'motion-json-to-bvh',
      'batch-motion-to-bvh',
    ];

    for (const script of scripts) {
      const mod = await import(pathToFileURL(join(process.cwd(), `tools/${script}.mjs`)).href);
      expect(mod).toHaveProperty('main');
    }

    expect(packageJson.scripts).toMatchObject({
      'video:bvh:pair': 'node tools/video-to-bvh-pair.mjs',
      'video:bvh:matrix': 'node tools/video-to-bvh-matrix.mjs',
      'video:bvh:debug': 'node tools/video-to-bvh-debug.mjs',
      'video:bvh:batch': 'node tools/batch-video-to-bvh.mjs',
      'motion:bvh': 'node tools/motion-json-to-bvh.mjs',
      'motion:bvh:batch': 'node tools/batch-motion-to-bvh.mjs',
    });
  });
});
