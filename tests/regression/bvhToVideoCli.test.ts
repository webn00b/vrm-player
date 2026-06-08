import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import packageJson from '../../package.json';

const cliModuleUrl = new URL('../../tools/bvh-to-video.mjs', import.meta.url);

async function loadCli() {
  return import(cliModuleUrl.href) as Promise<{
    parseBvhMotionInfo: (text: string) => { frames: number; frameTime: number; durationSeconds: number } | null;
    parseCliArgs: (argv: string[]) => unknown;
    resolveCliOptions: (parsed: unknown, cwd: string) => {
      input: string;
      output: string;
      vrm?: string;
      url?: string;
      port: number;
      headed: boolean;
      timeoutMs: number;
      fps: number;
      width: number;
      height: number;
      durationSeconds?: number;
      paddingSeconds: number;
    };
  }>;
}

describe('bvh-to-video CLI options', () => {
  test('parses BVH motion metadata', async () => {
    const { parseBvhMotionInfo } = await loadCli();

    expect(parseBvhMotionInfo('HIERARCHY\nMOTION\nFrames: 12\nFrame Time: 0.0333333\n')).toEqual({
      frames: 12,
      frameTime: 0.0333333,
      durationSeconds: 0.3999996,
    });
    expect(parseBvhMotionInfo('not a bvh')).toBeNull();
    expect(parseBvhMotionInfo('MOTION\nFrames: 0\nFrame Time: 0.0333333')).toBeNull();
  });

  test('parses browser recording flags', async () => {
    const { parseCliArgs } = await loadCli();

    expect(parseCliArgs([
      './walk.bvh',
      '--output', './walk.webm',
      '--vrm', './avatar.vrm',
      '--url', 'http://127.0.0.1:5333',
      '--port', '5444',
      '--timeout', '12345',
      '--fps', '24',
      '--width', '640',
      '--height', '480',
      '--pixel-ratio', '1.5',
      '--video-bitrate', '20000000',
      '--duration', '2.5',
      '--padding', '0.1',
      '--show-debug',
      '--headed',
    ])).toEqual({
      input: './walk.bvh',
      output: './walk.webm',
      vrm: './avatar.vrm',
      url: 'http://127.0.0.1:5333',
      port: 5444,
      timeoutMs: 12345,
      fps: 24,
      width: 640,
      height: 480,
      pixelRatio: 1.5,
      videoBitsPerSecond: 20_000_000,
      durationSeconds: 2.5,
      paddingSeconds: 0.1,
      cleanScene: false,
      headed: true,
      help: false,
    });
  });

  test('resolves defaults from a readable BVH file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vrm-bvh-video-cli-'));
    const input = join(dir, 'walk.bvh');
    writeFileSync(input, 'HIERARCHY\nMOTION\nFrames: 30\nFrame Time: 0.0333333\n');
    const { parseCliArgs, resolveCliOptions } = await loadCli();

    expect(resolveCliOptions(parseCliArgs([input]), dir)).toEqual({
      input,
      output: join(dir, 'walk.webm'),
      port: 5333,
      headed: false,
      timeoutMs: 180_000,
      fps: 30,
      width: 1920,
      height: 1080,
      pixelRatio: 1,
      videoBitsPerSecond: 12_000_000,
      paddingSeconds: 0.25,
      cleanScene: true,
    });
  });

  test('rejects missing and non-BVH inputs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vrm-bvh-video-cli-'));
    const txt = join(dir, 'notes.txt');
    writeFileSync(txt, 'notes');
    const { parseCliArgs, resolveCliOptions } = await loadCli();

    expect(() => resolveCliOptions(parseCliArgs([]), dir)).toThrow(/BVH/i);
    expect(() => resolveCliOptions(parseCliArgs([txt]), dir)).toThrow(/must end with .bvh/i);
  });

  test('conversion script is importable and wired to package scripts', async () => {
    const mod = await import(pathToFileURL(join(process.cwd(), 'tools/bvh-to-video.mjs')).href);

    expect(mod).toHaveProperty('runBvhToVideo');
    expect(packageJson.scripts).toMatchObject({
      'bvh:video': 'node tools/bvh-to-video.mjs',
    });
  });
});
