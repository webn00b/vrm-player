#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 5333;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_RECORDING_CLAMP_MODE = 'safe';
const VALIDATION_SETTINGS_STORAGE_KEY = 'vrm-player.validation-settings';
const VALIDATION_MODES = new Set(['safe', 'full', 'off']);

export function usage() {
  return [
    'Usage:',
    '  node tools/video-to-bvh.mjs <video> [--output out.bvh] [--vrm avatar.vrm] [--headed]',
    '',
    'Options:',
    '  -o, --output <path>   BVH output path. Defaults to <video basename>.bvh',
    '  --vrm <path>          Optional local VRM file loaded through the existing UI',
    '  --url <url>           Use an already-running vrm-player app instead of starting Vite',
    `  --port <number>       Vite port when --url is omitted. Default: ${DEFAULT_PORT}`,
    `  --timeout <ms>        Browser conversion timeout. Default: ${DEFAULT_TIMEOUT_MS}`,
    `  --validation-mode <mode> Recording validation mode for single output: safe, full, off. Default: ${DEFAULT_RECORDING_CLAMP_MODE}`,
    '  --validation-pair     Write two BVH files: .corrected.bvh with validation and .raw.bvh without it',
    '  --headed              Show Chromium while converting',
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

function parseValidationMode(value, flag) {
  if (!VALIDATION_MODES.has(value)) {
    throw new Error(`${flag} must be one of: safe, full, off`);
  }
  return value;
}

export function parseCliArgs(argv) {
  const parsed = {
    video: undefined,
    output: undefined,
    vrm: undefined,
    url: undefined,
    port: DEFAULT_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    recordingClampMode: DEFAULT_RECORDING_CLAMP_MODE,
    validationPair: false,
    headed: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
    } else if (arg === '--headed') {
      parsed.headed = true;
    } else if (arg === '--validation-pair' || arg === '--pair') {
      parsed.validationPair = true;
    } else if (arg === '-o' || arg === '--output') {
      parsed.output = readFlagValue(argv, i, arg);
      i += 1;
    } else if (arg === '--vrm') {
      parsed.vrm = readFlagValue(argv, i, arg);
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
    } else if (arg === '--validation-mode') {
      parsed.recordingClampMode = parseValidationMode(readFlagValue(argv, i, arg), arg);
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!parsed.video) {
      parsed.video = arg;
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

function defaultOutputFor(video) {
  const extension = extname(video);
  return join(dirname(video), `${basename(video, extension)}.bvh`);
}

function outputVariantPath(output, variant) {
  const extension = extname(output) || '.bvh';
  return join(dirname(output), `${basename(output, extname(output))}.${variant}${extension}`);
}

export function readBvhFrameCount(text) {
  const match = /^Frames:\s*(\d+)\s*$/m.exec(text);
  return match ? Number(match[1]) : null;
}

export function assertBvhHasFrames(text, output) {
  const frames = readBvhFrameCount(text);
  if (frames === null) throw new Error(`Downloaded file is not a BVH motion file: ${output}`);
  if (frames <= 0) {
    throw new Error(
      `Downloaded BVH has 0 frames: ${output}. ` +
      'MediaPipe did not detect a usable body pose in the video.',
    );
  }
}

export function resolveCliOptions(parsed, cwd = process.cwd()) {
  if (parsed.help) {
    return {
      port: parsed.port,
      headed: parsed.headed,
      timeoutMs: parsed.timeoutMs,
      recordingClampMode: parsed.recordingClampMode,
      validationPair: parsed.validationPair,
      help: true,
    };
  }
  if (!parsed.video) throw new Error('A video file is required');

  const video = resolvePath(cwd, parsed.video);
  assertReadableFile(video, 'Video');

  const output = parsed.output
    ? resolvePath(cwd, parsed.output)
    : defaultOutputFor(video);

  let vrm;
  if (parsed.vrm) {
    vrm = resolvePath(cwd, parsed.vrm);
    assertReadableFile(vrm, 'VRM');
    if (extname(vrm).toLowerCase() !== '.vrm') throw new Error(`VRM file must end with .vrm: ${vrm}`);
  }

  return {
    video,
    output,
    ...(parsed.validationPair
      ? {
          outputs: {
            corrected: outputVariantPath(output, 'corrected'),
            raw: outputVariantPath(output, 'raw'),
          },
        }
      : {}),
    ...(vrm ? { vrm } : {}),
    ...(parsed.url ? { url: parsed.url } : {}),
    port: parsed.port,
    headed: parsed.headed,
    timeoutMs: parsed.timeoutMs,
    recordingClampMode: parsed.recordingClampMode,
    validationPair: parsed.validationPair,
  };
}

async function startViteServer(options) {
  const { createServer } = await import('vite');
  const server = await createServer({
    logLevel: 'warn',
    server: {
      host: '127.0.0.1',
      port: options.port,
      strictPort: false,
    },
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${options.port}/`;
  return {
    url,
    close: () => server.close(),
  };
}

async function loadOptionalVrm(page, vrmPath, timeoutMs) {
  if (!vrmPath) return;
  const firstVrmInput = page.locator('input[type="file"][accept=".vrm"]').first();
  await firstVrmInput.setInputFiles(vrmPath);
  await page.locator('#app canvas').waitFor({ state: 'visible', timeout: timeoutMs });
  await page.waitForTimeout(500);
}

function installPageDiagnostics(page, errors) {
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push(text);
    if (msg.type() === 'warning' && /MediaPipe|Holistic|BVH|mocap/i.test(text)) {
      console.warn(`[browser:${msg.type()}] ${text}`);
    }
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
}

async function installValidationSettings(context, recordingClampMode) {
  await context.addInitScript(
    ({ key, mode }) => {
      localStorage.setItem(key, JSON.stringify({
        profileId: 'default',
        playbackClampMode: 'safe',
        recordingClampMode: mode,
        importClampMode: 'validate',
      }));
    },
    { key: VALIDATION_SETTINGS_STORAGE_KEY, mode: recordingClampMode },
  );
}

export async function runVideoToBvh(options) {
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
      permissions: ['camera'],
      viewport: { width: 1440, height: 1000 },
    });
    await installValidationSettings(context, options.recordingClampMode ?? DEFAULT_RECORDING_CLAMP_MODE);
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    page.setDefaultNavigationTimeout(options.timeoutMs);

    const browserErrors = [];
    installPageDiagnostics(page, browserErrors);

    await page.goto(server.url);
    await page.locator('#app canvas').waitFor({ state: 'visible', timeout: options.timeoutMs });
    await loadOptionalVrm(page, options.vrm, options.timeoutMs);

    await page.getByRole('button', { name: 'Capture', exact: true }).click();
    await page.getByTestId('capture-primary').waitFor({ state: 'visible', timeout: options.timeoutMs });
    await page.getByTestId('capture-src-video').click();
    await page.getByTestId('capture-primary').waitFor({ state: 'visible', timeout: options.timeoutMs });

    mkdirSync(dirname(options.output), { recursive: true });
    const downloadPromise = page.waitForEvent('download', { timeout: options.timeoutMs });
    await page.getByTestId('capture-video-input').setInputFiles(options.video);
    const download = await downloadPromise;
    await download.saveAs(options.output);
    assertBvhHasFrames(readFileSync(options.output, 'utf8'), options.output);

    return {
      output: options.output,
      suggestedFilename: download.suggestedFilename(),
      browserErrors,
      url: server.url,
      recordingClampMode: options.recordingClampMode ?? DEFAULT_RECORDING_CLAMP_MODE,
    };
  } finally {
    await browser?.close();
    await server.close();
  }
}

export async function runValidationPair(options) {
  const correctedOutput = options.outputs?.corrected ?? outputVariantPath(options.output, 'corrected');
  const rawOutput = options.outputs?.raw ?? outputVariantPath(options.output, 'raw');
  const corrected = await runVideoToBvh({
    ...options,
    output: correctedOutput,
    recordingClampMode: options.recordingClampMode ?? DEFAULT_RECORDING_CLAMP_MODE,
    validationPair: false,
  });
  const raw = await runVideoToBvh({
    ...options,
    output: rawOutput,
    recordingClampMode: 'off',
    validationPair: false,
  });
  return { corrected, raw };
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const parsed = parseCliArgs(argv);
  if (parsed.help) {
    console.log(usage());
    return 0;
  }

  const options = resolveCliOptions(parsed, cwd);
  console.log(`[video-to-bvh] opening ${options.url ?? `local Vite:${options.port}`}`);
  console.log(`[video-to-bvh] processing ${options.video}`);
  if (options.validationPair) {
    const result = await runValidationPair(options);
    console.log(`[video-to-bvh] saved corrected ${result.corrected.output}`);
    console.log(`[video-to-bvh] saved raw ${result.raw.output}`);
    const errors = result.corrected.browserErrors.length + result.raw.browserErrors.length;
    if (errors > 0) {
      console.warn(`[video-to-bvh] browser reported ${errors} error(s) during conversion`);
    }
  } else {
    const result = await runVideoToBvh(options);
    console.log(`[video-to-bvh] saved ${result.output}`);
    if (result.browserErrors.length > 0) {
      console.warn(`[video-to-bvh] browser reported ${result.browserErrors.length} error(s) during conversion`);
    }
  }
  return 0;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
function isUsageError(message) {
  return /^(Unknown option|Unexpected extra argument|.+ requires a value|.+ must be a positive integer|.+ must be one of|A video file is required|Video file does not exist|Video path is not a file|VRM file)/.test(message);
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
