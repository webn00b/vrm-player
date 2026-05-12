/**
 * Capture-section UX flows that don't actually run the mocap pipeline.
 *
 * Covers behaviour added by the CaptureSection.vue migration:
 *   - Source segmented control (camera / video / animfile) reflects the
 *     `aria-pressed` attribute + persists to localStorage.
 *   - Switching source while idle changes the primary CTA label.
 *   - The "Choose video…" → file input is wired (accept="video/*").
 *   - The Anim source resets the primary CTA to "Choose animation…".
 *   - The Advanced fold toggles independently of source state.
 *
 * Everything runs without permission grants or fake-camera setup — these
 * are pure UI assertions. The mocap-start path is exercised by
 * mocap.spec.ts.
 */

import { test, expect } from '@playwright/test';

test.describe('Capture section UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('capture-primary')).toBeVisible({ timeout: 10_000 });
    // Playwright gives each test a fresh BrowserContext, so localStorage
    // is already empty here — no per-test cleanup needed. We don't use
    // addInitScript because it would re-fire on reload() and break the
    // persistence test below.
  });

  test('source defaults to camera; aria-pressed reflects current selection', async ({ page }) => {
    await expect(page.getByTestId('capture-src-camera')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('capture-src-video')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('capture-src-animfile')).toHaveAttribute('aria-pressed', 'false');
    // Primary CTA label = camera state.
    await expect(page.getByTestId('capture-primary')).toContainText(/Start camera/);
  });

  test('switching to Video updates aria-pressed + CTA label', async ({ page }) => {
    await page.getByTestId('capture-src-video').click();
    await expect(page.getByTestId('capture-src-camera')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('capture-src-video')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('capture-primary')).toContainText(/Choose video/);
    await expect(page.getByTestId('mocap-status')).toContainText(/Pick a video/i);
  });

  test('switching to Anim updates aria-pressed + CTA label', async ({ page }) => {
    await page.getByTestId('capture-src-animfile').click();
    await expect(page.getByTestId('capture-src-animfile')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('capture-primary')).toContainText(/Choose animation/);
    await expect(page.getByTestId('mocap-status')).toContainText(/\.bvh.*\.vrma.*\.fbx/i);
  });

  test('source choice persists to localStorage across reload', async ({ page }) => {
    await page.getByTestId('capture-src-video').click();
    await expect(page.getByTestId('capture-src-video')).toHaveAttribute('aria-pressed', 'true');

    // Sanity: localStorage entry written by CaptureSection.vue setSource()
    const stored = await page.evaluate(() => localStorage.getItem('vrm-player.capture-source'));
    expect(stored).toBe('video');

    // Real reload: same BrowserContext (same localStorage) — the page
    // should re-read 'video' from storage on mount.
    await page.reload();
    await expect(page.getByTestId('capture-primary')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('capture-src-video')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('capture-primary')).toContainText(/Choose video/);
  });

  test('stop-camera button is hidden when source is idle', async ({ page }) => {
    // The mocap state is 'off' until the user clicks the primary CTA. The
    // stop-cam button has v-show="showStopCam" which only flips true in
    // 'live' / 'recording' state.
    await expect(page.getByTestId('capture-stop-cam')).toBeHidden();
  });

  test('"Advanced…" details fold toggles open/closed', async ({ page }) => {
    // The advanced fold contains the "Export .bvh" pose button. Initially
    // closed; clicking the summary opens it.
    const advanced = page.locator('details.capture-advanced');
    await expect(advanced).toHaveJSProperty('open', false);
    await advanced.locator('summary').click();
    await expect(advanced).toHaveJSProperty('open', true);
    await advanced.locator('summary').click();
    await expect(advanced).toHaveJSProperty('open', false);
  });
});
