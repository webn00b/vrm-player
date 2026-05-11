/**
 * Page-load smoke. Verifies the dev server serves a working build and the
 * VRM scene mounts without runtime errors. Pre-requisite for every other
 * e2e test — if this is red, everything downstream is meaningless.
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

  // Wait for the debug panel to populate (its HTML is built by JS at runtime).
  await expect(page.locator('#capture-primary-btn')).toBeVisible({ timeout: 10_000 });

  // Core mocap controls. The mirror/face/symmetry toggles live inside the
  // Video tab (collapsed by default), so we only assert they EXIST in DOM —
  // not that they're currently visible. The actual mocap test exercises
  // them via clicks which auto-handle the tab switch.
  await expect(page.locator('#mocap-mirror-btn')).toBeAttached();
  await expect(page.locator('#mocap-face-btn')).toBeAttached();
  await expect(page.locator('#mocap-symmetry-btn')).toBeAttached();
});
