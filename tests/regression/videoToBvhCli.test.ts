import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';

const cliModuleUrl = new URL('../../tools/video-to-bvh.mjs', import.meta.url);

async function loadCli() {
  return import(cliModuleUrl.href) as Promise<{
    parseCliArgs: (argv: string[]) => unknown;
    readBvhFrameCount: (text: string) => number | null;
    assertBvhHasFrames: (text: string, output: string) => void;
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
});
