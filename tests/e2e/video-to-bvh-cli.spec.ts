import { test, expect } from '@playwright/test';

test('browser video-to-bvh CLI can target the frontend video upload path', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByTestId('capture-primary')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('capture-src-video').click();

  const input = page.getByTestId('capture-video-input');
  await expect(input).toHaveCount(1);
  await expect(input).toHaveAttribute('type', 'file');
  await expect(input).toHaveAttribute('accept', 'video/*');
  await expect(page.getByTestId('capture-primary')).toContainText(/Choose video/);
});
