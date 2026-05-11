/**
 * Webcam-mocap e2e test driven by Chromium's fake video stream.
 *
 * Without FAKE_VIDEO_PATH env var the test runs against Chromium's built-in
 * synthetic green-pattern video. That stream contains no human body, so
 * MediaPipe won't detect landmarks — but the IMPORTANT PIPELINE STEPS still
 * run end-to-end and we can verify:
 *
 *   1. getUserMedia() succeeds (camera permission granted)
 *   2. MediaPipe HolisticLandmarker initialises (downloads model, sets up
 *      wasm/GPU delegate)
 *   3. The mocap state machine transitions off → live
 *   4. The page doesn't throw or freeze
 *
 * With FAKE_VIDEO_PATH set to a real .y4m / .mjpeg recording, MediaPipe
 * WILL detect landmarks and we can additionally verify avatar bones rotate.
 * See README.md for how to record one.
 */

import { test, expect } from '@playwright/test';

const HAS_REAL_VIDEO = !!process.env.FAKE_VIDEO_PATH;

test('start mocap with fake camera: state transitions to "live" without errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(`pageerror: ${err.message}`);
  });

  await page.goto('/');
  await expect(page.locator('#capture-primary-btn')).toBeVisible({ timeout: 10_000 });

  // The primary button label is the easiest state proxy: starts as "Start"
  // (or similar), transitions to "Recording" / "Stop" when live.
  // For robustness we instead poll a stable indicator via window-exposed
  // mocap controller state. The app doesn't currently expose it globally,
  // so we read the source-info label and primary button text instead.
  const primaryBtn = page.locator('#capture-primary-btn');
  const initialLabel = await primaryBtn.textContent();

  // Click → starts mocap. Awaits the async startLive() pipeline.
  await primaryBtn.click();

  // After kickoff the button briefly shows "…" while MediaPipe loads.
  // Once live, the status label transitions to a camera-active state.
  // We give a generous 30s for the first-time WASM/model download.
  await expect(page.locator('#mocap-status-label')).not.toContainText('Camera off', {
    timeout: 30_000,
  });

  // The button label must have changed from its initial state too.
  await expect(primaryBtn).not.toHaveText(initialLabel ?? '', { timeout: 5_000 });

  // Let mocap run for a few frames so we're not just catching the init transition.
  await page.waitForTimeout(3_000);

  // No hard errors should have been raised during init / first-frame processing.
  const filtered = consoleErrors.filter((line) => {
    if (/Failed to load resource/i.test(line)) return false;
    if (/AbortError/i.test(line)) return false;
    // MediaPipe's GPU delegate sometimes warns about partial fallback — non-fatal.
    if (/GPU delegate/i.test(line)) return false;
    return true;
  });
  expect(filtered, `errors during mocap startup:\n${filtered.join('\n')}`).toEqual([]);
});

test('with real fake-video: avatar bones move when mocap is live', async ({ page }) => {
  test.skip(!HAS_REAL_VIDEO, 'Requires FAKE_VIDEO_PATH env var pointing at a body-motion .y4m');
  await page.goto('/');
  await expect(page.locator('#capture-primary-btn')).toBeVisible();

  // Start mocap.
  await page.locator('#capture-primary-btn').click();
  await expect(page.locator('#mocap-status-label')).not.toContainText('Camera off', {
    timeout: 30_000,
  });

  // Enable the debug skeleton overlay so per-bone visibility readouts populate.
  await page.locator('#mocap-dbgskel-btn').click();

  // Let MediaPipe process a few seconds of the recording.
  await page.waitForTimeout(5_000);

  // Read at least one chain's tracking phase via the on-page diagnostics.
  // When MediaPipe detects a body, leftArm phase should reach 'live'.
  const armStatus = await page.locator('#mocap-scalar-stats').textContent();
  expect(armStatus, `tracking-health readout should mention 'live' phases when a body is in the fake feed`).toMatch(/live/);
});
