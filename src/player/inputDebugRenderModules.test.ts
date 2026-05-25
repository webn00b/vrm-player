/**
 * @vitest-environment happy-dom
 */
import { beforeEach, expect, test, vi } from 'vitest';
import { mountDebugPanel } from '../debugPanel';
import { startRenderLoop } from '../renderLoop';
import { sceneControlsState } from '../playerVue/sceneControlsState';
import { notify, setStatus } from '../ui';
import { debugModule } from './modules/debugModule';
import { inputModule } from './modules/inputModule';
import { renderLoopModule } from './modules/renderLoopModule';
import type { AnimationBridge, PlayerContext } from './types';

vi.mock('../debugPanel', () => ({
  mountDebugPanel: vi.fn(() => vi.fn()),
}));

vi.mock('../renderLoop', () => ({
  startRenderLoop: vi.fn(() => vi.fn()),
}));

vi.mock('../playerVue/sceneControlsState', () => ({
  sceneControlsState: {
    modelOn: true,
    skeletonOn: true,
    dragOn: false,
  },
}));

vi.mock('../ui', () => ({
  notify: vi.fn(),
  setStatus: vi.fn(),
}));

const PAGE_KEY = 'vrm-player.active-page';

function createAnimationBridge(): AnimationBridge {
  return {
    names: [],
    bvhByIndex: new Map(),
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

function createContext(): PlayerContext {
  return {
    roots: {
      app: document.createElement('div'),
      shell: document.createElement('div'),
    },
    options: {
      selectedVrmUrl: null,
      selectedVrmName: '',
      onVrmFileSelected: vi.fn(),
    },
    scene: {
      scene: { name: 'scene' },
    } as PlayerContext['scene'],
    vrm: {
      scene: { visible: true },
    } as PlayerContext['vrm'],
    playback: {
      controller: {
        currentQueuePos: 2,
        togglePaused: vi.fn(),
      },
    } as unknown as PlayerContext['playback'],
    mocap: {
      mocap: {},
      debugViz: {},
      dbgRecorder: {},
    } as PlayerContext['mocap'],
    tooling: {
      skelViz: { setVisible: vi.fn() },
      validator: {},
      bonePanel: {},
      boneDrag: {
        setEnabled: vi.fn(),
        resetAll: vi.fn(),
      },
      hipForce: {},
      hipBalance: {},
    } as unknown as PlayerContext['tooling'],
    animation: createAnimationBridge(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sceneControlsState.modelOn = true;
  sceneControlsState.skeletonOn = true;
  sceneControlsState.dragOn = false;
  localStorage.removeItem(PAGE_KEY);
});

test('debugModule mounts the debug panel with playback, mocap, tooling, model visibility, and animation import wiring', () => {
  const ctx = createContext();
  const cleanup = vi.fn();
  vi.mocked(mountDebugPanel).mockReturnValueOnce(cleanup);

  const result = debugModule.setup(ctx);
  const args = vi.mocked(mountDebugPanel).mock.calls[0];

  expect(args[0]).toBe(ctx.playback);
  expect(args[1]).toBe(ctx.mocap);
  expect(args[2]).toBe(ctx.tooling);
  expect(args[4]).toBe(ctx.animation?.handleAnimationFile);
  args[3](false);
  expect(ctx.vrm?.scene.visible).toBe(false);
  expect(result).toBe(cleanup);
});

test('renderLoopModule starts the render loop with required player systems and returns its cleanup', () => {
  const ctx = createContext();
  const cleanup = vi.fn();
  vi.mocked(startRenderLoop).mockReturnValueOnce(cleanup);

  const result = renderLoopModule.setup(ctx);

  expect(startRenderLoop).toHaveBeenCalledWith(ctx.scene, ctx.vrm, ctx.playback, ctx.mocap, ctx.tooling);
  expect(result).toBe(cleanup);
});

test('inputModule owns shortcuts, VRM file validation, page changes, drag/drop animation import, and cleanup', () => {
  const ctx = createContext();
  const cleanup = inputModule.setup(ctx);
  const controller = ctx.playback?.controller;
  const boneDrag = ctx.tooling?.boneDrag;
  const skelViz = ctx.tooling?.skelViz;
  const animation = ctx.animation;

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(controller?.togglePaused).toHaveBeenCalled();

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
  expect(sceneControlsState.modelOn).toBe(false);
  expect(ctx.vrm?.scene.visible).toBe(false);

  sceneControlsState.skeletonOn = false;
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
  expect(sceneControlsState.dragOn).toBe(true);
  expect(boneDrag?.setEnabled).toHaveBeenCalledWith(true);
  expect(sceneControlsState.skeletonOn).toBe(true);
  expect(skelViz?.setVisible).toHaveBeenCalledWith(true);

  const unsupported = new File(['avatar'], 'avatar.glb');
  window.dispatchEvent(new CustomEvent<File>('vrm-player:load-vrm-file', { detail: unsupported }));
  expect(ctx.options.onVrmFileSelected).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith({
    severity: 'error',
    summary: 'Unsupported avatar file',
    detail: 'Choose a .vrm file.',
  });

  const vrmFile = new File(['avatar'], 'avatar.vrm');
  window.dispatchEvent(new CustomEvent<File>('vrm-player:load-vrm-file', { detail: vrmFile }));
  expect(ctx.options.onVrmFileSelected).toHaveBeenCalledWith(vrmFile);

  window.dispatchEvent(new CustomEvent<string>('vrm-player:page-changed', { detail: 'retarget' }));
  expect(animation?.openQueueItemInRetargetLab).toHaveBeenCalledWith(2, false);

  window.dispatchEvent(new CustomEvent<string>('vrm-player:page-changed', { detail: 'player' }));
  const animationFile = new File(['HIERARCHY'], 'walk.bvh');
  const drop = new Event('drop') as DragEvent;
  Object.defineProperty(drop, 'dataTransfer', {
    value: {
      files: [animationFile],
      items: [{ kind: 'file' }],
    },
  });
  window.dispatchEvent(drop);
  expect(animation?.handleAnimationFiles).toHaveBeenCalledWith([animationFile]);

  cleanup?.();
  vi.clearAllMocks();

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
  expect(skelViz?.setVisible).not.toHaveBeenCalled();
  expect(setStatus).not.toHaveBeenCalled();
});

test('inputModule ignores player shortcuts and animation drops outside the player page', () => {
  const ctx = createContext();
  const cleanup = inputModule.setup(ctx);
  const controller = ctx.playback?.controller;
  const animation = ctx.animation;

  window.dispatchEvent(new CustomEvent<string>('vrm-player:page-changed', { detail: 'hosts' }));

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(controller?.togglePaused).not.toHaveBeenCalled();

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
  expect(sceneControlsState.modelOn).toBe(true);
  expect(ctx.vrm?.scene.visible).toBe(true);

  const animationFile = new File(['HIERARCHY'], 'walk.bvh');
  const drop = new Event('drop') as DragEvent;
  Object.defineProperty(drop, 'dataTransfer', {
    value: {
      files: [animationFile],
      items: [{ kind: 'file' }],
    },
  });
  window.dispatchEvent(drop);
  expect(animation?.handleAnimationFiles).not.toHaveBeenCalled();

  window.dispatchEvent(new CustomEvent<string>('vrm-player:page-changed', { detail: 'player' }));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(controller?.togglePaused).toHaveBeenCalledTimes(1);

  cleanup?.();
});

test('inputModule initializes page gate from persisted active page', () => {
  localStorage.setItem(PAGE_KEY, 'hosts');
  const ctx = createContext();
  const cleanup = inputModule.setup(ctx);
  const controller = ctx.playback?.controller;

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(controller?.togglePaused).not.toHaveBeenCalled();

  window.dispatchEvent(new CustomEvent<string>('vrm-player:page-changed', { detail: 'player' }));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(controller?.togglePaused).toHaveBeenCalledTimes(1);

  cleanup?.();
});

test('inputModule tracks programmatic page changes', () => {
  const ctx = createContext();
  const cleanup = inputModule.setup(ctx);
  const controller = ctx.playback?.controller;

  window.dispatchEvent(new CustomEvent<string>('vrm-player:set-page', { detail: 'hosts' }));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(controller?.togglePaused).not.toHaveBeenCalled();

  window.dispatchEvent(new CustomEvent<string>('vrm-player:set-page', { detail: 'player' }));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(controller?.togglePaused).toHaveBeenCalledTimes(1);

  cleanup?.();
});

test('inputModule does not auto-open the current queue item for programmatic retarget navigation', () => {
  const ctx = createContext();
  const cleanup = inputModule.setup(ctx);
  const animation = ctx.animation;

  window.dispatchEvent(new CustomEvent<string>('vrm-player:set-page', { detail: 'retarget' }));

  expect(animation?.openQueueItemInRetargetLab).not.toHaveBeenCalled();

  cleanup?.();
});
