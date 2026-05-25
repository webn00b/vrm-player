/**
 * Owns player Vue UI islands and queue/export wiring for the player bootstrap.
 */
import { createApp } from 'vue';
import type { AnimationController, QueueLoopMode } from '../../animationController';
import { exportClipAsBvh } from '../../bvhExportRecorder';
import type { ParsedBVH } from '../../bvhLoader';
import { exportClipAsGlb } from '../../gltfExportRecorder';
import BottomBar from '../../playerVue/BottomBar.vue';
import PlayerStartPanel from '../../playerVue/PlayerStartPanel.vue';
import QueuePanel from '../../playerVue/QueuePanel.vue';
import RetargetLab from '../../playerVue/RetargetLab.vue';
import SceneToolbar from '../../playerVue/SceneToolbar.vue';
import { installPrimeVueOn } from '../../playerVue/plugin';
import { sceneControlsState } from '../../playerVue/sceneControlsState';
import { exportBvhAsVrma } from '../../retarget';
import { notify, setStatus } from '../../ui';
import { requireAnimation, requirePlayback, requireTooling, requireVrm } from '../assertions';
import { writeQueueLoopMode } from '../queueLoopMode';
import type { PlayerModule, QueueHandle } from '../types';

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

export const playerUiModule: PlayerModule = {
  name: 'player-ui',
  setup(ctx) {
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const tooling = requireTooling(ctx);
    const animation = requireAnimation(ctx);
    const controller = playback.controller;
    if (!controller) throw new Error('Player playback controller is required before player UI runs');

    const {
      skelViz,
      boneDrag,
      hipForce,
      hipBalance,
    } = tooling;
    const cleanupFns: Array<() => void> = [];
    const registerCleanup = (...fns: Array<(() => void) | undefined>): void => {
      for (const fn of fns) if (fn) cleanupFns.push(fn);
    };

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

    setStatus('drop a .bvh file or record from mocap to start');

    vrm.scene.visible = sceneControlsState.modelOn;

    const bvhByIndex = animation.bvhByIndex;
    const names = animation.names;
    const queueExportCallbacks = createExportCallbacks(vrm, names, bvhByIndex, controller);

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

    const unsubscribePlaybackChange = controller.onChange((queuePos, item) => {
      animation.queue?.setActive(queuePos);
      animation.reexportQueue?.setActive(queuePos);
      setStatus(`${queuePos + 1}/${controller.queueLength} · ${item.name} · ${item.duration.toFixed(1)}s`);
      // Drop accumulated bone velocities — the new clip starts from a fresh pose
      // so any inertia computed across the boundary would be a teleport spike.
      hipForce.reset();
      hipBalance.reset();
    });
    registerCleanup(unsubscribePlaybackChange);

    return () => {
      for (let i = cleanupFns.length - 1; i >= 0; i -= 1) cleanupFns[i]();
      cleanupFns.length = 0;
      animation.queue = null;
      animation.reexportQueue = null;
    };
  },
};
