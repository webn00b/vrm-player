/**
 * Page-load smoke. Verifies the dev server serves a working build and the
 * VRM scene mounts without runtime errors. Pre-requisite for every other
 * e2e test — if this is red, everything downstream is meaningless.
 *
 * Selectors here use `data-testid` because after the Vue migration most
 * id'd elements have been removed in favour of class-based styling +
 * Vue-bound state. See playerVue/CaptureSection.vue + DebugPanelRoot.vue.
 */

import { test, expect } from '@playwright/test';

test('page loads, viewport canvas is mounted, no console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(`pageerror: ${err.message}`);
  });

  await page.goto('/');

  // Two canvases on the page — `#app canvas` (Three.js viewport) and
  // `#mocap-canvas` (camera preview, hidden until mocap starts). Scope to
  // the Three.js one.
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });

  // Give the VRM model + scene a moment to bootstrap.
  await page.waitForTimeout(2_000);

  // Filter out known-noisy warnings (MediaPipe AsyncIfaceInflater preload, etc.)
  // that aren't actionable — we care about hard errors.
  const filtered = consoleErrors.filter((line) => {
    if (/Failed to load resource/i.test(line)) return false;   // 404s on optional assets
    if (/AbortError/i.test(line)) return false;                // common during navigation
    return true;
  });

  expect(filtered, `console errors found:\n${filtered.join('\n')}`).toEqual([]);
});

test('debug panel is rendered with expected mocap controls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Capture$/ }).click();

  // The primary CTA is the one universally-visible element in the tuning panel.
  await expect(page.getByTestId('capture-primary')).toBeVisible({ timeout: 10_000 });

  // The three source-segmented-control buttons.
  await expect(page.getByTestId('capture-src-camera')).toBeVisible();
  await expect(page.getByTestId('capture-src-video')).toBeVisible();
  await expect(page.getByTestId('capture-src-animfile')).toBeVisible();

  await page.getByRole('button', { name: /^Inspect$/ }).click();

  // Tab buttons (Main / Video) in the left-side debug panel.
  await expect(page.getByTestId('dbg-tab-main')).toBeVisible();
  await expect(page.getByTestId('dbg-tab-video')).toBeVisible();

  // Mirror / face / symmetry toggles live in the Video tab (collapsed by
  // default for tab visibility, but always-attached in DOM via v-show).
  await expect(page.getByTestId('mocap-mirror')).toBeAttached();
  await expect(page.getByTestId('mocap-face')).toBeAttached();
  await expect(page.getByTestId('mocap-symmetry')).toBeAttached();
});
