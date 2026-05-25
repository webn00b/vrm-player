import { beforeEach, expect, test, vi } from 'vitest';
import type { AnimationBridge, PlayerContext } from './types';
import { mocapModule } from './modules/mocapModule';

const mocapState = vi.hoisted(() => ({
  controllers: [] as Array<{
    vrm: unknown;
    videoEl: unknown;
    onBvhReady?: (bvhText: string, name: string) => Promise<void>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  debugViz: [] as Array<{ scene: unknown; dispose: ReturnType<typeof vi.fn> }>,
  recorders: [] as Array<{
    vrm: unknown;
    maxFrames: number;
    onStop?: (frames: unknown[]) => void;
    logSummary: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../mocap/pipeline/mocapController', () => ({
  MocapController: class MocapController {
    onBvhReady?: (bvhText: string, name: string) => Promise<void>;
    readonly dispose = vi.fn();

    constructor(readonly vrm: unknown, readonly videoEl: unknown) {
      mocapState.controllers.push(this);
    }
  },
}));

vi.mock('../mocap/diagnostics/mocapDebugViz', () => ({
  MocapDebugViz: class MocapDebugViz {
    readonly dispose = vi.fn();

    constructor(readonly scene: unknown) {
      mocapState.debugViz.push(this);
    }
  },
}));

vi.mock('../mocap/diagnostics/mocapDebugRecorder', () => ({
  MocapDebugRecorder: class MocapDebugRecorder {
    onStop?: (frames: unknown[]) => void;
    readonly logSummary = vi.fn();
    readonly download = vi.fn();

    constructor(readonly vrm: unknown, readonly maxFrames: number) {
      mocapState.recorders.push(this);
    }
  },
}));

vi.mock('../bvhLoader', () => ({
  parseBVH: vi.fn((text: string) => ({ text })),
}));

vi.mock('../retarget', () => ({
  retargetBvhToVrm: vi.fn(async (_vrm: unknown, _bvh: unknown, name: string) => ({ name, duration: 2 })),
}));

vi.mock('../ui', () => ({
  notify: vi.fn(),
  setStatus: vi.fn(),
}));

function createAnimationBridge(registerAndEnqueue = vi.fn(() => 4)): AnimationBridge {
  return {
    names: [],
    bvhByIndex: new Map(),
    sourceFileByIndex: new Map(),
    queue: null,
    reexportQueue: null,
    registerAndEnqueue,
    loadAnimationIntoQueue: vi.fn(),
    handleAnimationFile: vi.fn(),
    handleAnimationFiles: vi.fn(),
    previewRetargetFile: vi.fn(),
    openQueueItemInRetargetLab: vi.fn(),
  };
}

function createContext(animation = createAnimationBridge()): PlayerContext {
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
    scene: {
      scene: { name: 'scene' },
    } as PlayerContext['scene'],
    vrm: {
      scene: { visible: true },
    } as PlayerContext['vrm'],
    playback: {
      controller: {
        jumpTo: vi.fn(),
      },
    } as unknown as PlayerContext['playback'],
    animation,
  };
}

beforeEach(() => {
  mocapState.controllers.length = 0;
  mocapState.debugViz.length = 0;
  mocapState.recorders.length = 0;
  vi.stubGlobal('document', {
    getElementById: vi.fn(() => ({ tagName: 'VIDEO' })),
  });
  vi.stubGlobal('window', {});
});

test('mocapModule stores mocap systems and replays recorded BVH through the animation bridge', async () => {
  const registerAndEnqueue = vi.fn(() => 4);
  const animation = createAnimationBridge(registerAndEnqueue);
  const ctx = createContext(animation);

  mocapModule.setup(ctx);
  await mocapState.controllers[0].onBvhReady?.('HIERARCHY', 'take-1');

  expect(ctx.mocap?.mocap).toBe(mocapState.controllers[0]);
  expect(ctx.mocap?.debugViz).toBe(mocapState.debugViz[0]);
  expect(ctx.mocap?.dbgRecorder).toBe(mocapState.recorders[0]);
  expect(registerAndEnqueue).toHaveBeenCalledWith(
    'take-1',
    { text: 'HIERARCHY' },
    { name: 'take-1', duration: 2 },
    expect.any(File),
  );
  expect(ctx.playback?.controller?.jumpTo).toHaveBeenCalledWith(4, { immediate: true });
  expect(window.__mocapDbg).toBe(mocapState.recorders[0]);
});
