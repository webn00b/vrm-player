import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AvatarCharacterManager } from './avatarCharacterManager';
import type { LanguageHostProfile } from './languageHosts';
import { loadVRM } from './vrmLoader';

export interface LanguageHostPreviewScene {
  readonly canvas: HTMLCanvasElement;
  readonly manager: AvatarCharacterManager;
  load(profile: LanguageHostProfile): Promise<void>;
  resize(): void;
  dispose(): void;
}

export function createLanguageHostPreviewScene(container: HTMLElement): LanguageHostPreviewScene {
  let renderer: THREE.WebGLRenderer | undefined;
  let controls: OrbitControls | undefined;
  let grid: THREE.GridHelper | undefined;
  let manager: AvatarCharacterManager | undefined;
  let onResize: (() => void) | undefined;
  let canvasAppended = false;
  let resizeListenerAdded = false;
  let rafId = 0;
  let disposed = false;

  const disposeGrid = (): void => {
    if (!grid) return;
    grid.geometry.dispose();
    if (Array.isArray(grid.material)) {
      grid.material.forEach((material) => material.dispose());
    } else {
      grid.material.dispose();
    }
    grid = undefined;
  };

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(rafId);
    if (resizeListenerAdded && onResize) {
      window.removeEventListener('resize', onResize);
      resizeListenerAdded = false;
    }
    manager?.dispose();
    manager = undefined;
    controls?.dispose();
    controls = undefined;
    disposeGrid();
    renderer?.dispose();
    if (canvasAppended) {
      renderer?.domElement.remove();
      canvasAppended = false;
    }
    renderer = undefined;
  };

  try {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15191d);

    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 1.32, 3.1);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.id = 'language-host-preview-canvas';
    container.appendChild(renderer.domElement);
    canvasAppended = true;

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.08, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 4.2;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x283044, 1.1);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(1.4, 2.4, 2.2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9ccfff, 0.55);
    fill.position.set(-1.8, 1.2, 1.6);
    scene.add(fill);

    grid = new THREE.GridHelper(3.2, 8, 0x53616d, 0x26313a);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.38;
    scene.add(grid);

    manager = new AvatarCharacterManager({ scene, loadVrm: loadVRM });
    const clock = new THREE.Clock();
    const activeRenderer = renderer;
    const activeControls = controls;
    const activeManager = manager;

    const resize = (): void => {
      if (disposed) return;
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      activeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      activeRenderer.setSize(width, height, false);
    };

    const tick = (): void => {
      if (disposed) return;
      const delta = clock.getDelta();
      activeControls.update();
      activeManager.beforeRender();
      activeManager.current?.vrm.update(delta);
      activeRenderer.render(scene, camera);
      activeManager.afterRender();
      rafId = requestAnimationFrame(tick);
    };

    onResize = (): void => resize();
    window.addEventListener('resize', onResize);
    resizeListenerAdded = true;
    resize();
    tick();

    return {
      canvas: activeRenderer.domElement,
      manager: activeManager,
      async load(profile: LanguageHostProfile): Promise<void> {
        if (disposed) {
          throw new Error('language host preview scene has been disposed');
        }
        await activeManager.swapTo(profile);
      },
      resize,
      dispose: cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
