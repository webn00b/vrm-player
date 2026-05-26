import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLanguageHostProfile } from './languageHosts';

const rendererSetPixelRatio = vi.fn();
const rendererSetSize = vi.fn();
const rendererRender = vi.fn();
const rendererDispose = vi.fn();
const rendererCanvasRemove = vi.fn();
const controlsUpdate = vi.fn();
const controlsDispose = vi.fn();
const gridGeometryDispose = vi.fn();
const gridMaterialDispose = vi.fn();
const managerSwapTo = vi.fn();
const managerDispose = vi.fn();
const managerBeforeRender = vi.fn();
const managerAfterRender = vi.fn();
let controlsConstructorError: Error | null = null;

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();

  class MockWebGLRenderer {
    domElement = {
      id: '',
      remove: rendererCanvasRemove,
    };

    setPixelRatio = rendererSetPixelRatio;
    setSize = rendererSetSize;
    render = rendererRender;
    dispose = rendererDispose;
  }

  class MockGridHelper extends actual.Object3D {
    geometry = {
      dispose: gridGeometryDispose,
    };

    material = {
      transparent: false,
      opacity: 1,
      dispose: gridMaterialDispose,
    };
  }

  return {
    ...actual,
    GridHelper: MockGridHelper,
    WebGLRenderer: MockWebGLRenderer,
  };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class MockOrbitControls {
    target = {
      set: vi.fn(),
    };

    enableDamping = false;
    enablePan = true;
    minDistance = 0;
    maxDistance = 0;
    update = controlsUpdate;
    dispose = controlsDispose;

    constructor() {
      if (controlsConstructorError) {
        throw controlsConstructorError;
      }
    }
  },
}));

vi.mock('./avatarCharacterManager', () => ({
  AvatarCharacterManager: class MockAvatarCharacterManager {
    current = null;
    swapTo = managerSwapTo;
    beforeRender = managerBeforeRender;
    afterRender = managerAfterRender;
    dispose = managerDispose;
  },
}));

vi.mock('./vrmLoader', () => ({
  loadVRM: vi.fn(),
}));

const makeContainer = () => ({
  appendChild: vi.fn(),
  getBoundingClientRect: vi.fn(() => ({ width: 320, height: 180 })),
});

describe('createLanguageHostPreviewScene', () => {
  afterEach(() => {
    controlsConstructorError = null;
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects load and ignores resize after disposal', async () => {
    vi.stubGlobal('window', {
      devicePixelRatio: 2,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const { createLanguageHostPreviewScene } = await import('./languageHostPreviewScene');
    const container = makeContainer();
    const preview = createLanguageHostPreviewScene(container as unknown as HTMLElement);

    vi.clearAllMocks();
    preview.dispose();
    preview.resize();

    await expect(preview.load(resolveLanguageHostProfile('en-US')))
      .rejects
      .toThrow('language host preview scene has been disposed');
    expect(managerSwapTo).not.toHaveBeenCalled();
    expect(rendererSetPixelRatio).not.toHaveBeenCalled();
    expect(rendererSetSize).not.toHaveBeenCalled();
  });

  it('disposes grid helper resources with scene resources', async () => {
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const { createLanguageHostPreviewScene } = await import('./languageHostPreviewScene');
    const preview = createLanguageHostPreviewScene(makeContainer() as unknown as HTMLElement);

    preview.dispose();

    expect(gridGeometryDispose).toHaveBeenCalledTimes(1);
    expect(gridMaterialDispose).toHaveBeenCalledTimes(1);
  });

  it('applies staged host swaps around the render call', async () => {
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const order: string[] = [];
    managerBeforeRender.mockImplementation(() => order.push('beforeRender'));
    rendererRender.mockImplementation(() => order.push('render'));
    managerAfterRender.mockImplementation(() => order.push('afterRender'));

    const { createLanguageHostPreviewScene } = await import('./languageHostPreviewScene');
    createLanguageHostPreviewScene(makeContainer() as unknown as HTMLElement);

    expect(order).toEqual(['beforeRender', 'render', 'afterRender']);
  });

  it('cleans up renderer resources when setup throws after appending the canvas', async () => {
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    controlsConstructorError = new Error('controls setup failed');

    const { createLanguageHostPreviewScene } = await import('./languageHostPreviewScene');

    expect(() => createLanguageHostPreviewScene(makeContainer() as unknown as HTMLElement))
      .toThrow('controls setup failed');
    expect(rendererDispose).toHaveBeenCalledTimes(1);
    expect(rendererCanvasRemove).toHaveBeenCalledTimes(1);
  });
});
