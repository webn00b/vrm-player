import { expect, test, type Page } from '@playwright/test';

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return errors;
}

function filterExpectedRuntimeNoise(errors: string[]): string[] {
  return errors.filter((line) => {
    if (/Failed to load resource/i.test(line)) return false;
    if (/AbortError/i.test(line)) return false;
    if (/No VRM data/i.test(line)) return false;
    return true;
  });
}

test('hosts tab mounts preview, selects Japanese, and cleans up on return to player', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto('/');
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /^Hosts$/ }).click();

  await expect(page.locator('#hosts-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Hosts$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /English/i })).toBeVisible();

  const japaneseButton = page.getByRole('button', { name: /Japanese/i });
  await expect(japaneseButton).toBeVisible();
  await expect(page.locator('#language-host-preview-canvas')).toBeAttached({ timeout: 10_000 });

  await expect(japaneseButton).toBeEnabled({ timeout: 20_000 });
  await japaneseButton.click();
  await expect(japaneseButton).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /^Player$/ }).click();
  await expect(page.locator('#ui-overlay')).toBeVisible();
  await expect(page.locator('#hosts-page')).toHaveCount(0);
  await expect(page.locator('#language-host-preview-canvas')).toHaveCount(0);

  const filtered = filterExpectedRuntimeNoise(runtimeErrors);
  expect(filtered, `console errors found:\n${filtered.join('\n')}`).toEqual([]);
});

test('hosts preview reports selected or unavailable asset status when host assets are ready', async ({ page }) => {
  test.skip(!process.env.VRM_HOST_ASSETS_READY, 'Set VRM_HOST_ASSETS_READY to run host asset status smoke.');

  await page.goto('/');
  await page.getByRole('button', { name: /^Hosts$/ }).click();

  await expect(page.locator('#hosts-page')).toBeVisible();
  await expect(page.locator('#language-host-preview-canvas')).toBeAttached({ timeout: 10_000 });
  await expect(page.locator('.hosts-preview-status')).toContainText(
    /host selected|asset unavailable/i,
    { timeout: 20_000 },
  );
});
