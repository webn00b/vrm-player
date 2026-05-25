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
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15191d);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 1.32, 3.1);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.id = 'language-host-preview-canvas';
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
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

  const grid = new THREE.GridHelper(3.2, 8, 0x53616d, 0x26313a);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.38;
  scene.add(grid);

  const manager = new AvatarCharacterManager({ scene, loadVrm: loadVRM });
  const clock = new THREE.Clock();
  let rafId = 0;
  let disposed = false;

  const resize = (): void => {
    if (disposed) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
  };

  const tick = (): void => {
    if (disposed) return;
    const delta = clock.getDelta();
    controls.update();
    manager.current?.vrm.update(delta);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  };

  const onResize = (): void => resize();
  window.addEventListener('resize', onResize);
  resize();
  tick();

  return {
    canvas: renderer.domElement,
    manager,
    async load(profile: LanguageHostProfile): Promise<void> {
      if (disposed) {
        throw new Error('language host preview scene has been disposed');
      }
      await manager.swapTo(profile);
    },
    resize,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      manager.dispose();
      controls.dispose();
      grid.geometry.dispose();
      if (Array.isArray(grid.material)) {
        grid.material.forEach((material) => material.dispose());
      } else {
        grid.material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
