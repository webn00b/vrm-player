import { expect, test, type Page } from '@playwright/test';

interface RuntimeErrorEntry {
  text: string;
  url: string;
}

function collectRuntimeErrors(page: Page): RuntimeErrorEntry[] {
  const errors: RuntimeErrorEntry[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push({ text: msg.text(), url: msg.location().url });
    }
  });
  page.on('pageerror', (err) => {
    errors.push({ text: `pageerror: ${err.message}`, url: '' });
  });
  return errors;
}

function formatRuntimeError(error: RuntimeErrorEntry): string {
  return error.url ? `${error.text} (${error.url})` : error.text;
}

function isExpectedHostAssetFailure(error: RuntimeErrorEntry): boolean {
  const target = `${error.text}\n${error.url}`;
  if (!/\/models\/hosts\//i.test(target)) return false;
  return (
    /Failed to load resource/i.test(error.text)
    || /AbortError/i.test(error.text)
    || /No VRM data/i.test(error.text)
  );
}

function filterExpectedRuntimeNoise(errors: RuntimeErrorEntry[]): RuntimeErrorEntry[] {
  return errors.filter((error) => {
    if (isExpectedHostAssetFailure(error)) return false;
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
  expect(
    filtered.map(formatRuntimeError),
    `console errors found:\n${filtered.map(formatRuntimeError).join('\n')}`,
  ).toEqual([]);
});

test('hosts page stays above compact player canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /^Shrink viewport$/ }).click();
  await expect(page.locator('#main-render-canvas')).toHaveClass(/compact-viewport/);

  await page.getByRole('button', { name: /^Hosts$/ }).click();
  await expect(page.locator('#hosts-page')).toBeVisible();

  const stacking = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('#main-render-canvas');
    const hosts = document.querySelector<HTMLElement>('#hosts-page');
    if (!canvas || !hosts) return null;
    return {
      canvasZIndex: getComputedStyle(canvas).zIndex,
      hostsZIndex: getComputedStyle(hosts).zIndex,
    };
  });

  expect(stacking).not.toBeNull();
  expect(Number(stacking?.hostsZIndex)).toBeGreaterThan(Number(stacking?.canvasZIndex));
});

test('persisted hosts page still ignores player shortcuts', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vrm-player.active-page', 'hosts');
    localStorage.removeItem('vrm-player.zen-mode');
  });

  await page.goto('/');
  await expect(page.locator('#hosts-page')).toBeVisible();

  await page.keyboard.press('KeyZ');

  await expect.poll(async () => page.evaluate(() => localStorage.getItem('vrm-player.zen-mode'))).toBeNull();
});

test('hosts preview reports selected status when host assets are ready', async ({ page }) => {
  test.skip(!process.env.VRM_HOST_ASSETS_READY, 'Set VRM_HOST_ASSETS_READY to run host asset status smoke.');

  await page.addInitScript(() => {
    localStorage.removeItem('vrm-player.language-locale');
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Hosts$/ }).click();

  await expect(page.locator('#hosts-page')).toBeVisible();
  await expect(page.locator('#language-host-preview-canvas')).toBeAttached({ timeout: 10_000 });
  await expect(page.locator('.hosts-preview-status')).toContainText(
    /English host selected/i,
    { timeout: 20_000 },
  );
});
