import './styles/player.css';
import { exportBvhAsVrma } from './retarget';
import type { ParsedBVH } from './bvhLoader';
import { exportClipAsBvh } from './bvhExportRecorder';
import { exportClipAsGlb } from './gltfExportRecorder';
import type { AnimationController, QueueLoopMode } from './animationController';
import { notify, setStatus } from './ui';
import { createApp } from 'vue';
import QueuePanel from './playerVue/QueuePanel.vue';
import BottomBar from './playerVue/BottomBar.vue';
import RetargetLab from './playerVue/RetargetLab.vue';
import SceneToolbar from './playerVue/SceneToolbar.vue';
import PlayerStartPanel from './playerVue/PlayerStartPanel.vue';
import { installPrimeVueOn } from './playerVue/plugin';
import { sceneControlsState } from './playerVue/sceneControlsState';
import { mountDebugPanel } from './debugPanel';
import { startRenderLoop } from './renderLoop';
import type { ToolingSystems } from './playerSystems';
import { runPlayerModules } from './player/bootstrap';
import type { PlayerContext, QueueHandle } from './player/types';
import { coreSceneModule } from './player/modules/coreSceneModule';
import { shellModule } from './player/modules/shellModule';
import { vrmModule } from './player/modules/vrmModule';
import { playbackModule, writeQueueLoopMode } from './player/modules/playbackModule';
import { toolingModule } from './player/modules/toolingModule';
import { animationImportModule } from './player/modules/animationImportModule';
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
    validator,
    bonePanel,
    boneDrag,
    hipForce,
    hipBalance,
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

  const bottomBarApp = createApp(BottomBar, { controller });
  installPrimeVueOn(bottomBarApp);
  bottomBarApp.mount('#bottom-bar');
  registerCleanup(() => bottomBarApp.unmount());

  const sceneToolbarApp = createApp(SceneToolbar, {
    skelViz,
    boneDrag,
    setModelVisible: (v: boolean) => { vrm.scene.visible = v; },
  });
  installPrimeVueOn(sceneToolbarApp);
  sceneToolbarApp.mount('#scene-toolbar-root');
  registerCleanup(() => sceneToolbarApp.unmount());

  const playerStartApp = createApp(PlayerStartPanel, {
    controller,
    setModelVisible: (v: boolean) => { vrm.scene.visible = v; },
  });
  installPrimeVueOn(playerStartApp);
  playerStartApp.mount('#player-start-root');
  registerCleanup(() => playerStartApp.unmount());

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

  // Per-item parsed BVH cache, keyed by library item index. Used by the ⬇
  // export-as-VRMA button so we can re-run convertBVHToVRMAnimation on demand
  // without re-fetching/parsing.
  const bvhByIndex = animation.bvhByIndex;
  // Display names per library item index (controller already stores these
  // internally, but we mirror locally so we can pass the user-facing alias to
  // setStatus / queue.push without going through the controller).
  const names = animation.names;

  setStatus('drop a .bvh file or record from mocap to start');

  vrm.scene.visible = sceneControlsState.modelOn;

  // ── Queue (playback) — Vue island on #queue-panel ─────────────────────────
  // Replaced the imperative `mountQueue()` with QueuePanel.vue. The same
  // QueueHandle shape (push/remove/setActive/reorder) is exposed via
  // `defineExpose` inside the component, so the rest of main.ts uses the
  // returned `queue` reference identically.
  interface QueuePanelProps extends Record<string, unknown> {
    mode?: 'full' | 'exportsOnly';
    onJump?: (queueIndex: number) => void;
    onReorder?: (fromIndex: number, toIndex: number) => void;
    onRemove?: (queueIndex: number) => void;
    onClear?: () => void;
    onDuplicate?: (queueIndex: number) => void;
    onRetarget?: (queueIndex: number) => void;
    loopMode?: QueueLoopMode;
    onLoopModeChange?: (mode: QueueLoopMode) => void;
    onExportVrma?: (queueIndex: number) => void | Promise<unknown>;
    onExportBvh?: (queueIndex: number) => void | Promise<unknown>;
    onExportGlb?: (queueIndex: number) => void | Promise<unknown>;
    onRename?: (queueIndex: number, newDisplayName: string) => void;
  }

  function mountQueuePanel(
    mountTarget: string | Element,
    props: QueuePanelProps,
  ): { handle: QueueHandle; unmount: () => void } {
    const queueApp = createApp(QueuePanel, props);
    installPrimeVueOn(queueApp);
    const handle = queueApp.mount(mountTarget) as unknown as QueueHandle;
    return {
      handle,
      unmount: () => queueApp.unmount(),
    };
  }

  const createExportCallbacks = (
    vrmInst: Parameters<typeof exportBvhAsVrma>[0],
    namesRef: string[],
    bvhByIndexRef: Map<number, ParsedBVH>,
    controllerRef: AnimationController,
  ): Pick<QueuePanelProps, 'onExportVrma' | 'onExportBvh' | 'onExportGlb'> => ({
    onExportVrma: async (qi: number) => {
      const itemIdx = controllerRef.getItemIndexAtQueuePos(qi);
      const bvh = bvhByIndexRef.get(itemIdx);
      const name = namesRef[itemIdx];
      if (!bvh || !name) {
        const msg = 'No source BVH for this item. Use BVH export instead.';
        setStatus('no source BVH for this item — use ⬇bvh instead');
        notify({ severity: 'warn', summary: 'VRMA unavailable', detail: msg, life: 4200 });
        throw new Error(msg);
      }
      try {
        await exportBvhAsVrma(vrmInst, bvh, name);
        setStatus(`saved ${name}.vrma`);
        notify({ severity: 'success', summary: 'VRMA saved', detail: `${name}.vrma` });
      } catch (e) {
        const msg = (e as Error).message;
        setStatus(`vrma export failed: ${msg}`);
        notify({ severity: 'error', summary: 'VRMA export failed', detail: msg, life: 4200 });
        throw e;
      }
    },
    onExportBvh: async (qi: number) => {
      setStatus('recording BVH…');
      const handle = exportClipAsBvh(qi, controllerRef, vrmInst);
      try {
        const filename = await handle.promise;
        setStatus(`saved ${filename}`);
        notify({ severity: 'success', summary: 'BVH saved', detail: filename });
      } catch (e) {
        const msg = (e as Error).message;
        setStatus(`bvh export failed: ${msg}`);
        notify({ severity: 'error', summary: 'BVH export failed', detail: msg, life: 4200 });
        throw e;
      }
    },
    onExportGlb: async (qi: number) => {
      const clip = controllerRef.getClipAtQueuePos(qi);
      if (!clip) {
        const msg = 'No animation clip for this item.';
        setStatus('no animation clip for this item');
        notify({ severity: 'warn', summary: 'GLB unavailable', detail: msg, life: 4200 });
        throw new Error(msg);
      }
      const itemIdx = controllerRef.getItemIndexAtQueuePos(qi);
      const name = namesRef[itemIdx] || 'export';
      setStatus('exporting GLB…');
      try {
        const filename = await exportClipAsGlb(vrmInst, clip, name);
        setStatus(`saved ${filename}`);
        notify({ severity: 'success', summary: 'GLB saved', detail: filename });
      } catch (e) {
        const msg = (e as Error).message;
        setStatus(`glb export failed: ${msg}`);
        notify({ severity: 'error', summary: 'GLB export failed', detail: msg, life: 4200 });
        throw e;
      }
    },
  });

  const queueExportCallbacks = createExportCallbacks(vrm, names, bvhByIndex, controller);

  const onPageChanged = (e: Event): void => {
    const page = (e as CustomEvent<string>).detail;
    if (page !== 'retarget') return;
    const queueIndex = controller.currentQueuePos;
    if (queueIndex < 0) return;
    animation.openQueueItemInRetargetLab(queueIndex, false);
  };
  window.addEventListener('vrm-player:page-changed', onPageChanged);
  registerCleanup(() => window.removeEventListener('vrm-player:page-changed', onPageChanged));

  const { handle: queue, unmount: unmountQueue } = mountQueuePanel('#queue-panel-root', {
    loopMode: controller.currentLoopMode,
    onLoopModeChange: (mode: QueueLoopMode) => {
      controller.setLoopMode(mode);
      writeQueueLoopMode(mode);
      setStatus(mode === 'one' ? 'looping current clip' : 'looping queue');
    },
    onJump:    (qi: number)              => controller.jumpTo(qi),
    onReorder: (from: number, to: number) => {
      controller.reorderQueue(from, to);
      animation.reexportQueue?.reorder(from, to);
    },
    onRemove:  (qi: number) => {
      controller.removeFromQueue(qi);
      animation.reexportQueue?.remove(qi);
      // The component removes itself from its reactive list; we just sync
      // the underlying controller state. No `queue.remove(qi)` needed.
    },
    onClear: () => {
      controller.clearQueue();
      animation.reexportQueue?.clear();
      setStatus('queue cleared');
    },
    onDuplicate: (qi: number) => {
      const itemIdx = controller.getItemIndexAtQueuePos(qi);
      if (itemIdx < 0) return;
      controller.addToQueue(itemIdx);
      const name = names[itemIdx] || controller.getItemName(itemIdx);
      const duration = controller.getClipAtItemIndex(itemIdx)?.duration ?? 0;
      animation.queue?.push(name, duration);
      animation.reexportQueue?.push(name, duration);
    },
    onRetarget: (qi: number) => {
      animation.openQueueItemInRetargetLab(qi, true);
    },
    ...queueExportCallbacks,
    onRename: (_qi: number, _name: string) => {
      // Display alias is persisted to localStorage inside the component; the
      // hook is here in case future logic wants the new name as well.
    },
  });
  animation.queue = queue;
  registerCleanup(unmountQueue);

  const reexportRoot = document.getElementById('tools-reexport-root');
  if (reexportRoot) {
    const { handle, unmount: unmountReexportQueue } = mountQueuePanel(reexportRoot, {
      mode: 'exportsOnly',
      onJump: (qi: number) => controller.jumpTo(qi),
      onReorder: (from: number, to: number) => controller.reorderQueue(from, to),
      ...queueExportCallbacks,
    });
    animation.reexportQueue = handle;
    registerCleanup(unmountReexportQueue);
  }

  const onQueueAddAnimationFile = (e: Event): void => {
    const file = (e as CustomEvent<File>).detail;
    if (!file) return;
    void animation.handleAnimationFiles([file]);
  };
  const onQueueAddAnimationFiles = (e: Event): void => {
    const files = (e as CustomEvent<File[]>).detail;
    if (!Array.isArray(files) || files.length === 0) return;
    void animation.handleAnimationFiles(files);
  };
  window.addEventListener('vrm-player:add-animation-file', onQueueAddAnimationFile);
  window.addEventListener('vrm-player:add-animation-files', onQueueAddAnimationFiles);
  registerCleanup(() => {
    window.removeEventListener('vrm-player:add-animation-file', onQueueAddAnimationFile);
    window.removeEventListener('vrm-player:add-animation-files', onQueueAddAnimationFiles);
  });

  const retargetLabRoot = document.getElementById('retarget-lab-root');
  let retargetLabApp: ReturnType<typeof createApp> | null = null;
  if (retargetLabRoot) {
    retargetLabApp = createApp(RetargetLab, {
      vrm,
      onImport: animation.handleAnimationFile,
      onPreview: animation.previewRetargetFile,
      onPreviewSeek: (seconds: number) => controller.seek(seconds),
      onPreviewStop: () => {
        controller.stopPreview();
        vrm.scene.visible = false;
        setStatus('preview stopped');
      },
    });
    installPrimeVueOn(retargetLabApp);
    retargetLabApp.mount(retargetLabRoot);
    registerCleanup(() => retargetLabApp?.unmount());
  }

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

  // Queue-panel tabs (Queue / Exports) live entirely inside QueuePanel.vue
  // — the component owns its own activeTab ref + click handlers + scoped
  // CSS rules driving per-item button visibility.

  // File-to-file converters (FBX/BVH/GLB/VRMA → JSON) now live in the
  // standalone /exports.html page. The Exports tab here just links to it.

  controller.onChange((queuePos, item) => {
    animation.queue?.setActive(queuePos);
    animation.reexportQueue?.setActive(queuePos);
    setStatus(`${queuePos + 1}/${controller.queueLength} · ${item.name} · ${item.duration.toFixed(1)}s`);
    // Drop accumulated bone velocities — the new clip starts from a fresh pose
    // so any inertia computed across the boundary would be a teleport spike.
    hipForce.reset();
    hipBalance.reset();
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
