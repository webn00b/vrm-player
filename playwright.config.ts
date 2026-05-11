import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e config for vrm-player.
 *
 * Target: local dev server only (Vite on port 5333). The webServer hook
 * spawns `npm run dev` before tests and reuses an already-running instance
 * if one is listening — convenient when iterating with `npx playwright test
 * --ui` alongside `npm run dev` in another terminal.
 *
 * Browser: chromium-only. MediaPipe + SharedArrayBuffer + the WebGPU
 * delegate are Chrome-family-only in practice; the other engines would
 * fail tests for reasons unrelated to our code.
 *
 * Webcam: launched with `--use-fake-device-for-media-stream`. Without
 * `--use-file-for-fake-video-capture`, Chromium provides a synthetic
 * green-pattern test stream — sufficient for verifying that:
 *   - getUserMedia() succeeds and the video element receives frames
 *   - MediaPipe initialises and starts processing (it just won't detect
 *     a human body in the test pattern, which is fine — we test the
 *     PIPELINE, not detection quality)
 *
 * To run with a real recording (drives detection results), set
 * env var FAKE_VIDEO_PATH to a .y4m / .mjpeg file path before invoking
 * playwright. See tests/e2e/README.md.
 */

const FAKE_VIDEO = process.env.FAKE_VIDEO_PATH;

const chromiumArgs = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',  // auto-accepts the permission prompt
  // Optional Y4M file driver:
  ...(FAKE_VIDEO ? [`--use-file-for-fake-video-capture=${FAKE_VIDEO}`] : []),
  // For SharedArrayBuffer-requiring code paths (MediaPipe multi-thread):
  '--enable-features=SharedArrayBuffer',
];

export default defineConfig({
  testDir: './tests/e2e',
  // Each test gets its own browser context — minor isolation overhead but
  // prevents one test polluting another's mocap state.
  fullyParallel: false,                // VRM load is heavy; sequential is friendlier
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,                      // 60s — MediaPipe init can take 10-20s on first run

  use: {
    baseURL: 'http://127.0.0.1:5333',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Capture traces / screenshots / video on failure for diagnostics.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Auto-grant the camera permission (the fake-ui flag also handles this).
    permissions: ['camera'],
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: chromiumArgs,
        },
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5333',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
