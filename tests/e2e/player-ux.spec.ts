import { test, expect } from '@playwright/test';

test.describe('Player UX shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  });

  test('start panel exposes first-run asset actions', async ({ page }) => {
    const startPanel = page.locator('.start-panel');

    await expect(startPanel).toBeVisible();
    await expect(startPanel).toContainText(/Assets/i);
    await expect(page.getByRole('button', { name: /Show avatar/i })).toBeVisible();
    await expect(page.getByTestId('start-load-vrm')).toBeVisible();
    await expect(page.getByTestId('start-add-animation')).toBeVisible();
    await expect(startPanel.getByRole('button', { name: /^Play$/i })).toBeDisabled();
  });

  test('scene toolbar buttons and shortcuts share state', async ({ page }) => {
    const model = page.getByLabel('Show model');
    const skeleton = page.getByLabel('Show skeleton');
    const drag = page.getByLabel('Drag bones');

    await expect(model).toHaveAttribute('aria-pressed', 'false');
    await expect(skeleton).toHaveAttribute('aria-pressed', 'true');
    await expect(drag).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('KeyM');
    await expect(model).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('KeyS');
    await expect(skeleton).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('KeyD');
    await expect(drag).toHaveAttribute('aria-pressed', 'true');
    await expect(skeleton).toHaveAttribute('aria-pressed', 'true');

    await page.getByLabel('Reset dragged bones').click();
    await expect(drag).toHaveAttribute('aria-pressed', 'true');
  });

  test('scene toolbar restores saved visibility settings', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('vrm-player.active-page', 'player');
      localStorage.setItem('vrm-player.zen-mode', '0');
      localStorage.setItem('vrm-player.scene-controls', JSON.stringify({
        modelOn: true,
        skeletonOn: false,
        skelBodyOn: true,
        skelFingersOn: false,
        dragOn: false,
      }));
    });
    await page.goto('/');
    await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });

    await expect(page.getByLabel('Show model')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Show skeleton')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByLabel('Drag bones')).toHaveAttribute('aria-pressed', 'false');
  });

  test('help popover opens from button and keyboard, closes with Escape', async ({ page }) => {
    const help = page.locator('#help-popover');

    await expect(help).toBeHidden();
    await page.getByLabel('Open shortcuts help').click();
    await expect(help).toBeVisible();
    await expect(help).toContainText('Space');
    await expect(help).toContainText('Retarget Lab');

    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    await page.dispatchEvent('body', 'keydown', { key: '?', code: 'Slash', shiftKey: true });
    await expect(help).toBeVisible();
    await page.dispatchEvent('body', 'keydown', { key: '?', code: 'Slash', shiftKey: true });
    await expect(help).toBeHidden();
  });

  test('retarget lab shows Player context and returns to Player', async ({ page }) => {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('vrm-player:set-page', { detail: 'retarget' }));
    });
    await expect(page.locator('.retarget-lab')).toBeVisible();

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent<File>('vrm-player:retarget-file', {
        detail: new File(['HIERARCHY\n'], 'queued-walk.bvh', { type: 'text/plain' }),
      }));
    });

    const context = page.locator('.source-context');
    await expect(context).toContainText('Opened from Player queue');
    await expect(context).toContainText('queued-walk.bvh');

    await page.getByRole('button', { name: /Back to Player/i }).click();
    await expect(page.locator('#ui-overlay')).toBeVisible();
  });

  test('retarget tab emits page change for selected player animation bridge', async ({ page }) => {
    const changedPage = page.evaluate(() => new Promise<string>((resolve) => {
      window.addEventListener('vrm-player:page-changed', ((event: Event) => {
        resolve((event as CustomEvent<string>).detail);
      }) as EventListener, { once: true });
    }));

    await page.getByText('Retarget Lab', { exact: true }).click();
    await expect(page.locator('.retarget-lab')).toBeVisible();
    await expect(changedPage).resolves.toBe('retarget');
  });

  test('empty queue highlights as a file drop zone', async ({ page }) => {
    const dropZone = page.locator('.queue-empty').first();

    await expect(dropZone).toBeVisible();
    await page.evaluate(() => {
      const el = document.querySelector('.queue-empty');
      if (!el) throw new Error('queue empty state not found');
      const data = new DataTransfer();
      data.items.add(new File(['HIERARCHY\n'], 'walk.bvh', { type: 'text/plain' }));
      el.dispatchEvent(new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      }));
    });

    await expect(dropZone).toHaveClass(/drag-over/);
  });

  test('empty queue emits a batch import event on drop', async ({ page }) => {
    await expect(page.locator('.queue-empty').first()).toBeVisible();

    const droppedNames = await page.evaluate(() => new Promise<string[]>((resolve) => {
      window.addEventListener('vrm-player:add-animation-files', ((event: Event) => {
        resolve(((event as CustomEvent<File[]>).detail ?? []).map((file) => file.name));
      }) as EventListener, { once: true });

      const el = document.querySelector('.queue-empty');
      if (!el) throw new Error('queue empty state not found');
      const data = new DataTransfer();
      data.items.add(new File(['HIERARCHY\n'], 'walk.bvh', { type: 'text/plain' }));
      data.items.add(new File(['HIERARCHY\n'], 'turn.bvh', { type: 'text/plain' }));
      el.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      }));
    }));

    expect(droppedNames).toEqual(['walk.bvh', 'turn.bvh']);
  });

  test('unsupported dropped animation file shows feedback', async ({ page }) => {
    await expect(page.locator('.queue-empty').first()).toBeVisible();

    await page.evaluate(() => {
      const el = document.querySelector('.queue-empty');
      if (!el) throw new Error('queue empty state not found');
      const data = new DataTransfer();
      data.items.add(new File(['nope'], 'notes.txt', { type: 'text/plain' }));
      el.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      }));
    });

    await expect(page.locator('.p-toast')).toContainText('Unsupported animation file');
    await expect(page.locator('.p-toast')).toContainText('notes.txt');
  });
});
