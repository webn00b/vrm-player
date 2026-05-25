import { beforeEach, expect, test, vi } from 'vitest';
import { exportClipAsBvh } from '../bvhExportRecorder';
import { notify, setStatus } from '../ui';
import { playerUiModule } from './modules/playerUiModule';
import type { AnimationBridge, PlayerContext, QueueHandle } from './types';

const vueState = vi.hoisted(() => ({
  mounts: [] as Array<{
    component: unknown;
    props: Record<string, unknown>;
    target: string | Element;
    handle: QueueHandle | Record<string, never>;
    unmount: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('vue', () => ({
  createApp: vi.fn((component: unknown, props: Record<string, unknown>) => {
    const unmount = vi.fn();
    return {
      mount(target: string | Element) {
        const handle = component === 'QueuePanel'
          ? {
              push: vi.fn(),
              remove: vi.fn(),
              setActive: vi.fn(),
              reorder: vi.fn(),
              clear: vi.fn(),
            }
          : {};
        vueState.mounts.push({ component, props, target, handle, unmount });
        return handle;
      },
      unmount,
    };
  }),
}));

vi.mock('../playerVue/BottomBar.vue', () => ({ default: 'BottomBar' }));
vi.mock('../playerVue/SceneToolbar.vue', () => ({ default: 'SceneToolbar' }));
vi.mock('../playerVue/PlayerStartPanel.vue', () => ({ default: 'PlayerStartPanel' }));
vi.mock('../playerVue/QueuePanel.vue', () => ({ default: 'QueuePanel' }));
vi.mock('../playerVue/RetargetLab.vue', () => ({ default: 'RetargetLab' }));
vi.mock('../playerVue/plugin', () => ({ installPrimeVueOn: vi.fn() }));
vi.mock('../playerVue/sceneControlsState', () => ({
  sceneControlsState: {
    modelOn: false,
    skeletonOn: false,
    dragOn: false,
  },
}));
vi.mock('../ui', () => ({
  notify: vi.fn(),
  setStatus: vi.fn(),
}));
vi.mock('../bvhExportRecorder', () => ({
  exportClipAsBvh: vi.fn(() => ({ promise: Promise.resolve('take.bvh') })),
}));
vi.mock('../gltfExportRecorder', () => ({
  exportClipAsGlb: vi.fn(async () => 'take.glb'),
}));
vi.mock('../retarget', () => ({
  exportBvhAsVrma: vi.fn(async () => undefined),
}));
vi.mock('./queueLoopMode', () => ({
  writeQueueLoopMode: vi.fn(),
}));

function createQueueHandle(): QueueHandle {
  return {
    push: vi.fn(),
    remove: vi.fn(),
    setActive: vi.fn(),
    reorder: vi.fn(),
    clear: vi.fn(),
  };
}

function createAnimationBridge(): AnimationBridge {
  return {
    names: ['walk'],
    bvhByIndex: new Map([[0, {} as never]]),
    sourceFileByIndex: new Map(),
    queue: null,
    reexportQueue: null,
    registerAndEnqueue: vi.fn(),
    loadAnimationIntoQueue: vi.fn(),
    handleAnimationFile: vi.fn(),
    handleAnimationFiles: vi.fn(),
    previewRetargetFile: vi.fn(),
    openQueueItemInRetargetLab: vi.fn(),
  };
}

function createContext(animation = createAnimationBridge()): PlayerContext {
  let onChange: ((queuePos: number, item: { name: string; duration: number }) => void) | null = null;
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
        currentLoopMode: 'queue',
        currentQueuePos: 0,
        queueLength: 1,
        jumpTo: vi.fn(),
        reorderQueue: vi.fn(),
        removeFromQueue: vi.fn(),
        clearQueue: vi.fn(),
        addToQueue: vi.fn(),
        setLoopMode: vi.fn(),
        getItemIndexAtQueuePos: vi.fn(() => 0),
        getItemName: vi.fn(() => 'walk'),
        getClipAtItemIndex: vi.fn(() => ({ duration: 1.5 })),
        getClipAtQueuePos: vi.fn(() => ({ duration: 1.5 })),
        seek: vi.fn(),
        stopPreview: vi.fn(),
        onChange: vi.fn((listener) => {
          onChange = listener;
          return () => {
            if (onChange === listener) onChange = null;
          };
        }),
        emitChange(queuePos: number, item: { name: string; duration: number }) {
          onChange?.(queuePos, item);
        },
      },
    } as unknown as PlayerContext['playback'],
    tooling: {
      skelViz: {},
      validator: {},
      bonePanel: {},
      boneDrag: {},
      hipForce: { reset: vi.fn() },
      hipBalance: { reset: vi.fn() },
    } as unknown as PlayerContext['tooling'],
    animation,
  };
}

beforeEach(() => {
  vueState.mounts.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal('document', {
    getElementById: vi.fn((id: string) => (
      id === 'tools-reexport-root' || id === 'retarget-lab-root'
        ? ({ id } as unknown as Element)
        : null
    )),
  });
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
});

test('playerUiModule mounts player Vue islands, owns queue handles, and cleans them up in reverse order', () => {
  const animation = createAnimationBridge();
  const ctx = createContext(animation);

  const cleanup = playerUiModule.setup(ctx);
  expect(typeof cleanup).toBe('function');

  expect(vueState.mounts.map((mount) => mount.component)).toEqual([
    'BottomBar',
    'SceneToolbar',
    'PlayerStartPanel',
    'QueuePanel',
    'QueuePanel',
    'RetargetLab',
  ]);
  expect(ctx.vrm?.scene.visible).toBe(false);
  expect(animation.queue).toBe(vueState.mounts[3].handle);
  expect(animation.reexportQueue).toBe(vueState.mounts[4].handle);

  cleanup?.();

  const unmountOrders = vueState.mounts.map((mount) => mount.unmount.mock.invocationCallOrder[0]);
  expect(vueState.mounts.map((mount) => mount.unmount.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 1]);
  expect(unmountOrders).toEqual([...unmountOrders].sort((a, b) => b - a));
  expect(animation.queue).toBeNull();
  expect(animation.reexportQueue).toBeNull();
});

test('playerUiModule syncs active queue state and resets hip helpers when playback changes', () => {
  const primaryQueue = createQueueHandle();
  const reexportQueue = createQueueHandle();
  const animation = createAnimationBridge();
  animation.queue = primaryQueue;
  animation.reexportQueue = reexportQueue;
  const ctx = createContext(animation);

  playerUiModule.setup(ctx);
  ctx.playback?.controller?.emitChange?.(2, { name: 'run', duration: 2.25 });

  expect(animation.queue?.setActive).toHaveBeenCalledWith(2);
  expect(animation.reexportQueue?.setActive).toHaveBeenCalledWith(2);
  expect(ctx.tooling?.hipForce.reset).toHaveBeenCalled();
  expect(ctx.tooling?.hipBalance.reset).toHaveBeenCalled();
});

test('playerUiModule unregisters playback listener during cleanup', () => {
  const ctx = createContext();
  const queue = createQueueHandle();
  const reexportQueue = createQueueHandle();

  const cleanup = playerUiModule.setup(ctx);
  ctx.animation!.queue = queue;
  ctx.animation!.reexportQueue = reexportQueue;
  cleanup?.();
  vi.clearAllMocks();

  ctx.playback?.controller?.emitChange?.(1, { name: 'stale', duration: 3 });

  expect(queue.setActive).not.toHaveBeenCalled();
  expect(reexportQueue.setActive).not.toHaveBeenCalled();
  expect(setStatus).not.toHaveBeenCalled();
  expect(ctx.tooling?.hipForce.reset).not.toHaveBeenCalled();
  expect(ctx.tooling?.hipBalance.reset).not.toHaveBeenCalled();
});

test('playerUiModule keeps BVH export failure status and toast behavior', async () => {
  const error = new Error('recorder failed');
  vi.mocked(exportClipAsBvh).mockReturnValueOnce({ promise: Promise.reject(error) } as never);
  const ctx = createContext();

  playerUiModule.setup(ctx);
  const onExportBvh = vueState.mounts[3].props.onExportBvh as (queueIndex: number) => Promise<unknown>;

  await expect(onExportBvh(0)).rejects.toThrow(error);

  expect(setStatus).toHaveBeenCalledWith('recording BVH…');
  expect(setStatus).toHaveBeenCalledWith('bvh export failed: recorder failed');
  expect(notify).toHaveBeenCalledWith({
    severity: 'error',
    summary: 'BVH export failed',
    detail: 'recorder failed',
    life: 4200,
  });
});
