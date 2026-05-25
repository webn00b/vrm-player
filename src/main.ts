import './styles/player.css';
import { notify, setStatus } from './ui';
import { sceneControlsState } from './playerVue/sceneControlsState';
import { mountDebugPanel } from './debugPanel';
import { startRenderLoop } from './renderLoop';
import type { ToolingSystems } from './playerSystems';
import { runPlayerModules } from './player/bootstrap';
import type { PlayerContext } from './player/types';
import { coreSceneModule } from './player/modules/coreSceneModule';
import { shellModule } from './player/modules/shellModule';
import { vrmModule } from './player/modules/vrmModule';
import { playbackModule } from './player/modules/playbackModule';
import { toolingModule } from './player/modules/toolingModule';
import { animationImportModule } from './player/modules/animationImportModule';
import { playerUiModule } from './player/modules/playerUiModule';
import { mocapModule } from './player/modules/mocapModule';

type CleanupFn = () => void;
let selectedVrmUrl: string | null = null;
let selectedVrmName = '';

declare global {
  interface Window {
    __vrmPlayerCleanup?: CleanupFn;
    __skelLog?: ToolingSystems['skeletonLogger'];
    __motionTrace?: ToolingSystems['motionTraceRecorder'];
  }
}

function installGlobalCleanup(cleanup: CleanupFn): void {
  let disposed = false;
  const wrapped = (): void => {
    if (disposed) return;
    disposed = true;
    cleanup();
    if (window.__vrmPlayerCleanup === wrapped) delete window.__vrmPlayerCleanup;
  };
  window.__vrmPlayerCleanup = wrapped;
  import.meta.hot?.dispose(() => wrapped());
}

async function main() {
  const previousCleanup = window.__vrmPlayerCleanup as CleanupFn | undefined;
  previousCleanup?.();
  const container = document.getElementById('app');
  if (!container) throw new Error('#app not found');
  const shellHost = document.getElementById('ui-shell');
  if (!shellHost) throw new Error('#ui-shell not found');

  const playerCtx: PlayerContext = {
    roots: { app: container, shell: shellHost },
    options: {
      selectedVrmUrl,
      selectedVrmName,
      onVrmFileSelected: (file) => { selectedVrmName = file.name; },
    },
  };
  const app = await runPlayerModules(playerCtx, [
    coreSceneModule,
    shellModule,
    vrmModule,
    playbackModule,
    toolingModule,
    animationImportModule,
    playerUiModule,
    mocapModule,
  ]);
  const ctx = playerCtx.scene;
  const vrm = playerCtx.vrm;
  const playback = playerCtx.playback;
  const tooling = playerCtx.tooling;
  const animation = playerCtx.animation;
  const mocapSys = playerCtx.mocap;
  const controller = playback?.controller;
  if (!ctx) throw new Error('Player scene failed to initialize');
  if (!vrm) throw new Error('Player VRM failed to initialize');
  if (!playback || !controller) throw new Error('Player playback failed to initialize');
  if (!tooling) throw new Error('Player tooling failed to initialize');
  if (!animation) throw new Error('Player animation bridge failed to initialize');
  if (!mocapSys) throw new Error('Player mocap failed to initialize');
  const {
    skelViz,
    boneDrag,
  } = tooling;

  const cleanupFns: CleanupFn[] = [];
  const registerCleanup = (...fns: Array<CleanupFn | undefined>): void => {
    for (const fn of fns) if (fn) cleanupFns.push(fn);
  };
  const cleanup = (): void => {
    for (let i = cleanupFns.length - 1; i >= 0; i--) cleanupFns[i]();
    cleanupFns.length = 0;
  };
  registerCleanup(
    () => app.dispose(),
  );

  const isTypingTarget = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  };
  const onShortcutKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
    const key = e.key.toLowerCase();
    if (key === ' ') {
      e.preventDefault();
      controller.togglePaused();
    } else if (key === 'm') {
      sceneControlsState.modelOn = !sceneControlsState.modelOn;
      vrm.scene.visible = sceneControlsState.modelOn;
    } else if (key === 's') {
      sceneControlsState.skeletonOn = !sceneControlsState.skeletonOn;
      skelViz.setVisible(sceneControlsState.skeletonOn);
    } else if (key === 'd') {
      sceneControlsState.dragOn = !sceneControlsState.dragOn;
      boneDrag.setEnabled(sceneControlsState.dragOn);
      if (sceneControlsState.dragOn && !sceneControlsState.skeletonOn) {
        sceneControlsState.skeletonOn = true;
        skelViz.setVisible(true);
      }
    } else if (key === 'r') {
      boneDrag.resetAll();
    } else if (key === 'z') {
      window.dispatchEvent(new Event('vrm-player:toggle-zen'));
    } else if (key === '?' || (e.code === 'Slash' && e.shiftKey)) {
      window.dispatchEvent(new Event('vrm-player:toggle-help'));
    }
  };
  window.addEventListener('keydown', onShortcutKey);
  registerCleanup(() => window.removeEventListener('keydown', onShortcutKey));

  const onLoadVrmFile = (e: Event): void => {
    const file = (e as CustomEvent<File>).detail;
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.vrm')) {
      notify({ severity: 'error', summary: 'Unsupported avatar file', detail: 'Choose a .vrm file.' });
      return;
    }
    if (selectedVrmUrl?.startsWith('blob:')) URL.revokeObjectURL(selectedVrmUrl);
    selectedVrmUrl = URL.createObjectURL(file);
    selectedVrmName = file.name;
    sceneControlsState.modelOn = true;
    sceneControlsState.skeletonOn = true;
    sceneControlsState.dragOn = false;
    setStatus(`loading ${file.name}…`);
    notify({ severity: 'info', summary: 'Loading VRM', detail: file.name, life: 1800 });
    void main().catch((err) => {
      console.error(err);
      setStatus(`error: ${(err as Error).message}`);
      notify({ severity: 'error', summary: 'VRM load failed', detail: (err as Error).message, life: 6000 });
    });
  };
  window.addEventListener('vrm-player:load-vrm-file', onLoadVrmFile);
  registerCleanup(() => window.removeEventListener('vrm-player:load-vrm-file', onLoadVrmFile));

  const onPageChanged = (e: Event): void => {
    const page = (e as CustomEvent<string>).detail;
    if (page !== 'retarget') return;
    const queueIndex = controller.currentQueuePos;
    if (queueIndex < 0) return;
    animation.openQueueItemInRetargetLab(queueIndex, false);
  };
  window.addEventListener('vrm-player:page-changed', onPageChanged);
  registerCleanup(() => window.removeEventListener('vrm-player:page-changed', onPageChanged));

  // ── Debug panel ────────────────────────────────────────────────────────────
  registerCleanup(
    mountDebugPanel(
      playback,
      mocapSys,
      tooling,
      (v) => { vrm.scene.visible = v; },
      animation.handleAnimationFile,
    ),
  );

  // ── Window-drop import (BVH / VRMA / FBX) ─────────────────────────────────
  const onWindowDragOver = (e: DragEvent): void => {
    if (Array.from(e.dataTransfer?.items ?? []).some((it) => it.kind === 'file')) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    }
  };
  const onWindowDrop = (e: DragEvent): void => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    void animation.handleAnimationFiles(files);
  };
  window.addEventListener('dragover', onWindowDragOver);
  window.addEventListener('drop', onWindowDrop);
  registerCleanup(() => {
    window.removeEventListener('dragover', onWindowDragOver);
    window.removeEventListener('drop', onWindowDrop);
  });

  registerCleanup(
    startRenderLoop(ctx, vrm, playback, mocapSys, tooling),
  );
  installGlobalCleanup(cleanup);
}

main().catch((err) => {
  console.error(err);
  setStatus(`error: ${(err as Error).message}`);
  notify({ severity: 'error', summary: 'Startup error', detail: (err as Error).message, life: 6000 });
});
