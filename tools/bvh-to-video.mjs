#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installPageDiagnostics,
  loadOptionalVrm,
  startViteServer,
} from './video-to-bvh.mjs';

const DEFAULT_PORT = 5333;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_FPS = 30;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_PIXEL_RATIO = 1;
const DEFAULT_VIDEO_BITS_PER_SECOND = 12_000_000;
const DEFAULT_PADDING_SECONDS = 0.25;
const SCENE_CONTROLS_STORAGE_KEY = 'vrm-player.scene-controls';

export function usage() {
  return [
    'Usage:',
    '  node tools/bvh-to-video.mjs <input.bvh> [--output out.webm] [--vrm avatar.vrm] [--headed]',
    '',
    'Options:',
    '  -o, --output <path>   WebM output path. Defaults to <bvh basename>.webm',
    '  --vrm <path>          Optional local VRM file loaded through the existing UI',
    '  --url <url>           Use an already-running vrm-player app instead of starting Vite',
    `  --port <number>       Vite port when --url is omitted. Default: ${DEFAULT_PORT}`,
    `  --timeout <ms>        Browser recording timeout. Default: ${DEFAULT_TIMEOUT_MS}`,
    `  --fps <number>        Canvas capture FPS. Default: ${DEFAULT_FPS}`,
    `  --width <number>      Browser viewport width. Default: ${DEFAULT_WIDTH}`,
    `  --height <number>     Browser viewport height. Default: ${DEFAULT_HEIGHT}`,
    `  --pixel-ratio <num>   Browser device scale factor. Default: ${DEFAULT_PIXEL_RATIO}`,
    `  --video-bitrate <bps> WebM video bitrate. Default: ${DEFAULT_VIDEO_BITS_PER_SECOND}`,
    '  --duration <seconds>  Override recording duration. Defaults to BVH Frames * Frame Time',
    `  --padding <seconds>   Extra recording tail after duration. Default: ${DEFAULT_PADDING_SECONDS}`,
    '  --show-debug          Keep skeleton/debug overlays visible in the recorded video',
    '  --headed              Show Chromium while recording',
    '  -h, --help            Show this help',
  ].join('\n');
}

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInt(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parsePositiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function parseNonNegativeNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative number`);
  }
  return parsed;
}

export function parseCliArgs(argv) {
  const parsed = {
    input: undefined,
    output: undefined,
    vrm: undefined,
    url: undefined,
    port: DEFAULT_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    fps: DEFAULT_FPS,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    pixelRatio: DEFAULT_PIXEL_RATIO,
    videoBitsPerSecond: DEFAULT_VIDEO_BITS_PER_SECOND,
    durationSeconds: undefined,
    paddingSeconds: DEFAULT_PADDING_SECONDS,
    cleanScene: true,
    headed: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
    } else if (arg === '--headed') {
      parsed.headed = true;
    } else if (arg === '--show-debug') {
      parsed.cleanScene = false;
    } else if (arg === '-o' || arg === '--output') {
      parsed.output = readFlagValue(argv, i, arg);
      i += 1;
    } else if (arg === '--vrm') {
      parsed.vrm = readFlagValue(argv, i, arg);
      i += 1;
    } else if (arg === '--face') {
      parsed.face = readFlagValue(argv, i, arg);
      i += 1;
    } else if (arg === '--url') {
      parsed.url = readFlagValue(argv, i, arg);
      i += 1;
    } else if (arg === '--port') {
      parsed.port = parsePositiveInt(readFlagValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === '--timeout') {
      parsed.timeoutMs = parsePositiveInt(readFlagValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === '--fps') {
      parsed.fps = parsePositiveInt(readFlagValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === '--width') {
      parsed.width = parsePositiveInt(readFlagValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === '--height') {
      parsed.height = parsePositiveInt(readFlagValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === '--pixel-ratio') {
      parsed.pixelRatio = parsePositiveNumber(readFlagValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === '--video-bitrate') {
      parsed.videoBitsPerSecond = parsePositiveInt(readFlagValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === '--duration') {
      parsed.durationSeconds = parsePositiveNumber(readFlagValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === '--padding') {
      parsed.paddingSeconds = parseNonNegativeNumber(readFlagValue(argv, i, arg), arg);
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!parsed.input) {
      parsed.input = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }

  return parsed;
}

function resolvePath(cwd, value) {
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function assertReadableFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} file does not exist: ${path}`);
  if (!statSync(path).isFile()) throw new Error(`${label} path is not a file: ${path}`);
}

function defaultOutputFor(input) {
  return join(dirname(input), `${basename(input, extname(input))}.webm`);
}

export function parseBvhMotionInfo(text) {
  const framesMatch = /^Frames:\s*(\d+)\s*$/m.exec(text);
  const frameTimeMatch = /^Frame Time:\s*([0-9]*\.?[0-9]+)\s*$/m.exec(text);
  if (!framesMatch || !frameTimeMatch) return null;

  const frames = Number(framesMatch[1]);
  const frameTime = Number(frameTimeMatch[1]);
  if (!Number.isFinite(frames) || frames <= 0 || !Number.isFinite(frameTime) || frameTime <= 0) {
    return null;
  }

  return {
    frames,
    frameTime,
    durationSeconds: frames * frameTime,
  };
}

export function resolveCliOptions(parsed, cwd = process.cwd()) {
  if (parsed.help) {
    return {
      port: parsed.port,
      headed: parsed.headed,
      timeoutMs: parsed.timeoutMs,
      fps: parsed.fps,
      width: parsed.width,
      height: parsed.height,
      pixelRatio: parsed.pixelRatio,
      videoBitsPerSecond: parsed.videoBitsPerSecond,
      paddingSeconds: parsed.paddingSeconds,
      cleanScene: parsed.cleanScene,
      help: true,
    };
  }
  if (!parsed.input) throw new Error('A BVH file is required');

  const input = resolvePath(cwd, parsed.input);
  assertReadableFile(input, 'BVH');
  if (extname(input).toLowerCase() !== '.bvh') throw new Error(`Input file must end with .bvh: ${input}`);

  const output = parsed.output
    ? resolvePath(cwd, parsed.output)
    : defaultOutputFor(input);

  let vrm;
  if (parsed.vrm) {
    vrm = resolvePath(cwd, parsed.vrm);
    assertReadableFile(vrm, 'VRM');
    if (extname(vrm).toLowerCase() !== '.vrm') throw new Error(`VRM file must end with .vrm: ${vrm}`);
  }

  let face;
  if (parsed.face) {
    face = resolvePath(cwd, parsed.face);
    assertReadableFile(face, 'Face track');
  }

  return {
    input,
    output,
    ...(vrm ? { vrm } : {}),
    ...(face ? { face } : {}),
    ...(parsed.url ? { url: parsed.url } : {}),
    port: parsed.port,
    headed: parsed.headed,
    timeoutMs: parsed.timeoutMs,
    fps: parsed.fps,
    width: parsed.width,
    height: parsed.height,
    pixelRatio: parsed.pixelRatio,
    videoBitsPerSecond: parsed.videoBitsPerSecond,
    ...(parsed.durationSeconds ? { durationSeconds: parsed.durationSeconds } : {}),
    paddingSeconds: parsed.paddingSeconds,
    cleanScene: parsed.cleanScene,
  };
}

export async function installSceneRecordingSettings(context, cleanScene) {
  if (!cleanScene) return;
  await context.addInitScript(
    ({ key }) => {
      localStorage.setItem(key, JSON.stringify({
        modelOn: true,
        skeletonOn: false,
        skelBodyOn: false,
        skelFingersOn: false,
        skelLabelsOn: false,
        unclampedSkeletonOn: false,
        dragOn: false,
      }));
    },
    { key: SCENE_CONTROLS_STORAGE_KEY },
  );
}

async function recordCanvasToWebm(page, options) {
  const downloadPromise = page.waitForEvent('download', { timeout: options.timeoutMs });
  await page.evaluate(async ({ fps, durationSeconds, paddingSeconds, outputName, videoBitsPerSecond }) => {
    const api = window.__vrmPlayerCli;
    if (!api) throw new Error('VRM player CLI bridge is not available');
    const canvas = document.querySelector('#app canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Player canvas is not available');
    if (typeof canvas.captureStream !== 'function') throw new Error('Canvas captureStream is not supported');
    if (typeof MediaRecorder !== 'function') throw new Error('MediaRecorder is not supported');

    api.restartPlayback();

    const stream = canvas.captureStream(fps);
    const chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
    const stopped = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => reject(recorder.error ?? new Error('MediaRecorder failed'));
      recorder.onstop = resolve;
    });

    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, Math.ceil((durationSeconds + paddingSeconds) * 1000)));
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());

    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size <= 0) throw new Error('Recorded video is empty');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = outputName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, {
    fps: options.fps,
    durationSeconds: options.durationSeconds,
    paddingSeconds: options.paddingSeconds,
    videoBitsPerSecond: options.videoBitsPerSecond,
    outputName: basename(options.output),
  });
  return downloadPromise;
}

export async function runBvhToVideo(options) {
  const motion = parseBvhMotionInfo(readFileSync(options.input, 'utf8'));
  const durationSeconds = options.durationSeconds ?? motion?.durationSeconds;
  if (!durationSeconds) throw new Error(`Could not read BVH Frames and Frame Time from ${options.input}`);

  const server = options.url
    ? { url: options.url, close: async () => undefined }
    : await startViteServer(options);

  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      headless: !options.headed,
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--enable-features=SharedArrayBuffer',
      ],
    });

    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: options.pixelRatio,
    });
    await installSceneRecordingSettings(context, options.cleanScene);
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    page.setDefaultNavigationTimeout(options.timeoutMs);

    const browserErrors = [];
    installPageDiagnostics(page, browserErrors);

    await page.goto(server.url);
    await page.locator('#app canvas').waitFor({ state: 'visible', timeout: options.timeoutMs });
    await loadOptionalVrm(page, options.vrm, options.timeoutMs);

    await page.getByTestId('start-add-animation-input').setInputFiles(options.input);
    await page.waitForFunction(() => {
      const info = window.__vrmPlayerCli?.getPlaybackInfo();
      return !!info?.active && info.duration > 0;
    }, undefined, { timeout: options.timeoutMs });

    // Optional face-expression sidecar: drive blink/mouth during playback.
    if (options.face) {
      const faceJson = readFileSync(options.face, 'utf8');
      const ok = await page.evaluate((json) => window.__vrmPlayerCli?.setFaceTrack(json) ?? false, faceJson);
      console.log(`[bvh-to-video] face track ${ok ? 'applied' : 'NOT applied (no player)'}: ${options.face}`);
    }

    mkdirSync(dirname(options.output), { recursive: true });
    const download = await recordCanvasToWebm(page, {
      ...options,
      durationSeconds,
    });
    await download.saveAs(options.output);
    const bytes = statSync(options.output).size;
    if (bytes <= 0) throw new Error(`Recorded video is empty: ${options.output}`);

    return {
      input: options.input,
      output: options.output,
      bytes,
      durationSeconds,
      suggestedFilename: download.suggestedFilename(),
      browserErrors,
      url: server.url,
    };
  } finally {
    await browser?.close();
    await server.close();
  }
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const parsed = parseCliArgs(argv);
  if (parsed.help) {
    console.log(usage());
    return 0;
  }

  const options = resolveCliOptions(parsed, cwd);
  console.log(`[bvh-to-video] opening ${options.url ?? `local Vite:${options.port}`}`);
  console.log(`[bvh-to-video] recording ${options.input}`);
  const result = await runBvhToVideo(options);
  console.log(`[bvh-to-video] saved ${result.output}`);
  if (result.browserErrors.length > 0) {
    console.warn(`[bvh-to-video] browser reported ${result.browserErrors.length} error(s) during recording`);
  }
  return 0;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
function isUsageError(message) {
  return /^(Unknown option|Unexpected extra argument|.+ requires a value|.+ must be a positive|.+ must be a non-negative|A BVH file is required|BVH file does not exist|BVH path is not a file|Input file must end with .bvh|VRM file)/.test(message);
}

if (isDirectRun) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    if (isUsageError(message)) {
      console.error('');
      console.error(usage());
    }
    process.exitCode = 1;
  });
}
