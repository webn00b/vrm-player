import { expect, test, vi } from 'vitest';
import { runPlayerModules } from './bootstrap';
import type { PlayerContext, PlayerModule } from './types';

function createContext(): PlayerContext {
  return {
    roots: {
      app: {} as HTMLElement,
      shell: {} as HTMLElement,
    },
    options: {
      selectedVrmUrl: null,
      selectedVrmName: '',
      onVrmFileSelected: () => {},
    },
  };
}

test('runPlayerModules runs modules in order and cleanup in reverse order', async () => {
  const calls: string[] = [];
  const modules: PlayerModule[] = [
    {
      name: 'a',
      setup: () => {
        calls.push('setup-a');
        return () => calls.push('cleanup-a');
      },
    },
    {
      name: 'b',
      setup: () => {
        calls.push('setup-b');
        return () => calls.push('cleanup-b');
      },
    },
  ];

  const app = await runPlayerModules(createContext(), modules);
  app.dispose();

  expect(calls).toEqual(['setup-a', 'setup-b', 'cleanup-b', 'cleanup-a']);
});

test('runPlayerModules disposes initialized modules when a later module fails', async () => {
  const calls: string[] = [];
  const modules: PlayerModule[] = [
    {
      name: 'a',
      setup: () => {
        calls.push('setup-a');
        return () => calls.push('cleanup-a');
      },
    },
    {
      name: 'b',
      setup: () => {
        throw new Error('boom');
      },
    },
  ];

  await expect(runPlayerModules(createContext(), modules)).rejects.toThrow('boom');
  expect(calls).toEqual(['setup-a', 'cleanup-a']);
});

test('runPlayerModules rethrows setup failure when failure cleanup throws', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const modules: PlayerModule[] = [
    {
      name: 'a',
      setup: () => () => {
        throw new Error('cleanup boom');
      },
    },
    {
      name: 'b',
      setup: () => {
        throw new Error('setup boom');
      },
    },
  ];

  try {
    await expect(runPlayerModules(createContext(), modules)).rejects.toThrow('setup boom');
  } finally {
    consoleError.mockRestore();
  }
});
