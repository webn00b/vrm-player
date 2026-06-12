/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from 'vue';
import SceneToolbar from './SceneToolbar.vue';

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

test('toggles the unclamped red skeleton overlay', async () => {
  const skelViz = {
    setVisible: vi.fn(),
    setShowBody: vi.fn(),
    setShowFingers: vi.fn(),
    setShowLabels: vi.fn(),
    setUnclampedVisible: vi.fn(),
  };
  const boneDrag = {
    setEnabled: vi.fn(),
    resetAll: vi.fn(),
  };
  const app = createApp(SceneToolbar, {
    skelViz,
    boneDrag,
    setModelVisible: vi.fn(),
  });
  app.mount('#app');

  const button = document.querySelector<HTMLButtonElement>('[aria-label="Show unclamped red skeleton"]');
  expect(button).toBeTruthy();
  button?.click();
  await Promise.resolve();

  expect(skelViz.setUnclampedVisible).toHaveBeenCalledWith(true);

  app.unmount();
});
