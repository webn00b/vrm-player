import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  clock: THREE.Clock;
  dispose: () => void;
}

export function createScene(container: HTMLElement): SceneContext {
  const VIEWPORT_COMPACT_KEY = 'vrm-player.viewport-compact';
  const VIEWPORT_LOG_PREFIX = '[viewport-compact]';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.3, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.id = 'main-render-canvas';
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.update();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.2);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.5);
  dir.position.set(1, 2, 1.5);
  scene.add(dir);

  const grid = new THREE.GridHelper(4, 8, 0x444444, 0x2a2a2a);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  scene.add(grid);

  let viewportCompact = false;

  const applyViewportSize = (): void => {
    const before = {
      compact: viewportCompact,
      cameraAspect: camera.aspect,
      canvasWidth: renderer.domElement.width,
      canvasHeight: renderer.domElement.height,
      cssClass: renderer.domElement.className,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    };
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.classList.toggle('compact-viewport', viewportCompact);
    const rect = renderer.domElement.getBoundingClientRect();
    console.info(VIEWPORT_LOG_PREFIX, 'apply size', {
      before,
      after: {
        compact: viewportCompact,
        width: window.innerWidth,
        height: window.innerHeight,
        pixelRatio: renderer.getPixelRatio(),
        drawingBufferWidth: renderer.domElement.width,
        drawingBufferHeight: renderer.domElement.height,
        cssClass: renderer.domElement.className,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      },
    });
  };

  const onResize = (): void => {
    console.info(VIEWPORT_LOG_PREFIX, 'window resize', {
      compact: viewportCompact,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    });
    applyViewportSize();
  };

  const onViewportCompactChanged = (event: Event): void => {
    const prev = viewportCompact;
    viewportCompact = !!(event as CustomEvent<boolean>).detail;
    console.info(VIEWPORT_LOG_PREFIX, 'event received', {
      prev,
      next: viewportCompact,
      eventDetail: (event as CustomEvent<boolean>).detail,
    });
    applyViewportSize();
  };

  try {
    const stored = localStorage.getItem(VIEWPORT_COMPACT_KEY);
    viewportCompact = stored === '1';
    console.info(VIEWPORT_LOG_PREFIX, 'scene init', { stored, compact: viewportCompact });
  } catch (err) {
    console.warn(VIEWPORT_LOG_PREFIX, 'scene init failed to read localStorage', err);
  }
  applyViewportSize();

  window.addEventListener('resize', onResize);
  window.addEventListener('vrm-player:viewport-compact-changed', onViewportCompactChanged);

  return {
    scene,
    camera,
    renderer,
    controls,
    clock: new THREE.Clock(),
    dispose: () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('vrm-player:viewport-compact-changed', onViewportCompactChanged);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
