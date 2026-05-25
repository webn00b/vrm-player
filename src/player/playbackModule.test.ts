import { beforeEach, expect, test, vi } from 'vitest';
import { writeQueueLoopMode } from './queueLoopMode';
import type { PlayerContext } from './types';
import { playbackModule } from './modules/playbackModule';

const animationControllerState = vi.hoisted(() => ({
  instances: [] as Array<{
    vrm: unknown;
    setLoopMode: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../animationController', () => ({
  AnimationController: class AnimationController {
    readonly setLoopMode = vi.fn();

    constructor(readonly vrm: unknown) {
      animationControllerState.instances.push(this);
    }
  },
}));

vi.mock('../priorityAnimator', () => ({
  PriorityAnimator: class PriorityAnimator {
    constructor(readonly vrm: unknown) {}
  },
}));

vi.mock('../microAnimations', () => ({
  MicroAnimations: class MicroAnimations {},
}));

vi.mock('../idleLoop', () => ({
  IdleLoop: class IdleLoop {},
}));

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
      scene: {},
    } as PlayerContext['vrm'],
  };
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
    clear: vi.fn(() => storage.clear()),
  });
  animationControllerState.instances.length = 0;
});

test('playbackModule reads persisted queue loop mode and stores playback systems', () => {
  localStorage.setItem('vrm-player.queue-loop-mode', 'one');
  const ctx = createContext();

  playbackModule.setup(ctx);

  expect(ctx.queueLoopMode).toBe('one');
  expect(ctx.playback?.controller).toBe(animationControllerState.instances[0]);
  expect(ctx.playback?.pa).toBeTruthy();
  expect(ctx.playback?.micro).toBeTruthy();
  expect(ctx.playback?.idle).toBeTruthy();
  expect(animationControllerState.instances[0].setLoopMode).toHaveBeenCalledWith('one');
});

test('writeQueueLoopMode persists the chosen queue loop mode', () => {
  writeQueueLoopMode('queue');

  expect(localStorage.getItem('vrm-player.queue-loop-mode')).toBe('queue');
});
