import { expect, test, vi } from 'vitest';
import type { PlayerContext, QueueHandle } from './types';
import { animationImportModule } from './modules/animationImportModule';

function createQueue(): QueueHandle {
  return {
    push: vi.fn(),
    remove: vi.fn(),
    setActive: vi.fn(),
    reorder: vi.fn(),
    clear: vi.fn(),
  };
}

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
    vrm: {
      scene: { visible: true },
    } as PlayerContext['vrm'],
    playback: {
      controller: {
        queueLength: 2,
        register: vi.fn(),
        addToQueue: vi.fn(),
        getItemIndexAtQueuePos: vi.fn((queueIndex: number) => queueIndex + 10),
      },
    } as unknown as PlayerContext['playback'],
  };
}

test('animationImportModule stores a bridge that registers clips and mirrors queue panels', () => {
  const ctx = createContext();
  animationImportModule.setup(ctx);
  const animation = ctx.animation;
  if (!animation) throw new Error('animation bridge missing');
  const queue = createQueue();
  const reexportQueue = createQueue();
  const parsedBvh = { frames: [] } as never;
  const clip = { duration: 1.25 } as never;
  const sourceFile = new File(['x'], 'walk.bvh');

  animation.queue = queue;
  animation.reexportQueue = reexportQueue;
  const queuePos = animation.registerAndEnqueue('walk', parsedBvh, clip, sourceFile);

  expect(queuePos).toBe(2);
  expect(ctx.playback?.controller?.register).toHaveBeenCalledWith('walk', clip);
  expect(ctx.playback?.controller?.addToQueue).toHaveBeenCalledWith(0);
  expect(animation.names).toEqual(['walk']);
  expect(animation.bvhByIndex.get(0)).toBe(parsedBvh);
  expect(animation.sourceFileByIndex.get(0)).toBe(sourceFile);
  expect(queue.push).toHaveBeenCalledWith('walk', 1.25);
  expect(reexportQueue.push).toHaveBeenCalledWith('walk', 1.25);
});
