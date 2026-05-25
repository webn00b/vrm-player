/**
 * Owns global player input and file-drop listeners for the player bootstrap.
 * Keeps browser event wiring separate from startup, UI mounting, and rendering.
 */
import { sceneControlsState } from '../../playerVue/sceneControlsState';
import { notify, setStatus } from '../../ui';
import { requireAnimation, requirePlayback, requireTooling, requireVrm } from '../assertions';
import type { CleanupFn, PlayerModule } from '../types';

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
};

export const inputModule: PlayerModule = {
  name: 'input',
  setup(ctx) {
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const tooling = requireTooling(ctx);
    const animation = requireAnimation(ctx);
    const controller = playback.controller;
    if (!controller) throw new Error('Player playback controller is required before input runs');

    const { skelViz, boneDrag } = tooling;
    const cleanupFns: CleanupFn[] = [];
    const registerCleanup = (...fns: Array<CleanupFn | undefined>): void => {
      for (const fn of fns) if (fn) cleanupFns.push(fn);
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

      sceneControlsState.modelOn = true;
      sceneControlsState.skeletonOn = true;
      sceneControlsState.dragOn = false;
      setStatus(`loading ${file.name}…`);
      notify({ severity: 'info', summary: 'Loading VRM', detail: file.name, life: 1800 });
      ctx.options.onVrmFileSelected(file);
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

    return () => {
      for (let i = cleanupFns.length - 1; i >= 0; i -= 1) cleanupFns[i]();
      cleanupFns.length = 0;
    };
  },
};
