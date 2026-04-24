import { createScene } from './scene';
import { loadVRM } from './vrmLoader';
import { loadBVH, parseBVH } from './bvhLoader';
import { retargetBvhToVrm } from './retarget';
import { AnimationController } from './animationController';
import { PriorityAnimator } from './priorityAnimator';
import { MicroAnimations } from './microAnimations';
import { IdleLoop } from './idleLoop';
import { mountLibrary, mountQueue, setStatus, formatLibraryName } from './ui';
import { mountDebugPanel } from './debugPanel';
import { BonePosePanel } from './bonePosePanel';
import { MocapController } from './mocap/mocapController';
import { MocapDebugViz } from './mocap/mocapDebugViz';
import { MocapDebugRecorder } from './mocap/mocapDebugRecorder';
import { SkeletonVisualizer } from './skeletonVisualizer';
import { BoneValidator } from './validation/boneValidator';
import { startRenderLoop } from './renderLoop';
import { mountTransport } from './transport';
import type { PlaybackSystems, MocapSystems, ToolingSystems } from './playerSystems';

const vrmModules = import.meta.glob('/models/*.vrm', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const bvhModules = import.meta.glob('/animations/*.bvh', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function resolveVrmUrl(): string {
  const entries = Object.entries(vrmModules).sort(([a], [b]) => a.localeCompare(b));
  const first = entries[0];
  if (!first) throw new Error('no .vrm files in ./models/ — see README');
  return first[1];
}

interface AnimationEntry { name: string; url: string; }
type CleanupFn = () => void;
const GLOBAL_CLEANUP_KEY = '__vrmPlayerCleanup';

function installGlobalCleanup(cleanup: CleanupFn): void {
  let disposed = false;
  const wrapped = (): void => {
    if (disposed) return;
    disposed = true;
    cleanup();
    if ((window as any)[GLOBAL_CLEANUP_KEY] === wrapped) delete (window as any)[GLOBAL_CLEANUP_KEY];
  };
  (window as any)[GLOBAL_CLEANUP_KEY] = wrapped;
  import.meta.hot?.dispose(() => wrapped());
}

function resolveAnimations(): AnimationEntry[] {
  return Object.entries(bvhModules)
    .map(([path, url]) => {
      const file = path.split('/').pop() ?? path;
      return { name: file.replace(/\.bvh$/i, ''), url };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  const previousCleanup = (window as any)[GLOBAL_CLEANUP_KEY] as CleanupFn | undefined;
  previousCleanup?.();
  const container = document.getElementById('app');
  if (!container) throw new Error('#app not found');
  const ctx = createScene(container);

  setStatus('loading VRM…');
  const vrm = await loadVRM(resolveVrmUrl());
  // NOTE: mirror effect for mocap is applied at the landmark level in
  // DirectPoseApplier (_mirrorX flag) — do NOT scale the scene negatively,
  // that breaks the direct-math's getWorldQuaternion calls on parent bones.
  ctx.scene.add(vrm.scene);

  // ── Procedural systems ─────────────────────────────────────────────────────
  const pa       = new PriorityAnimator(vrm);
  const micro    = new MicroAnimations();
  const idleLoop = new IdleLoop();

  // ── Bone rotation validator (AAOS/ISB ROM) ─────────────────────────────────
  const validator = new BoneValidator(vrm);

  // ── Skeleton visualizer ────────────────────────────────────────────────────
  const skelViz = new SkeletonVisualizer(vrm, ctx.scene);

  // ── Mocap debug skeleton ───────────────────────────────────────────────────
  const mocapDebugViz = new MocapDebugViz(ctx.scene);

  // ── Mocap debug recorder ───────────────────────────────────────────────────
  const dbgRecorder = new MocapDebugRecorder(vrm, 600); // max 600 frames (~10s)
  dbgRecorder.onStop = (frames) => {
    console.log('[MocapDebugRecorder] recording done —', frames.length, 'frames');
    dbgRecorder.logSummary();
    dbgRecorder.download('mocap_debug.json');
  };
  // Expose globally so it can be controlled from the browser console too
  (window as any).__mocapDbg = dbgRecorder;

  // ── Bone pose panel ────────────────────────────────────────────────────────
  const bonePanel = new BonePosePanel(vrm);
  const bonePanelEl = document.getElementById('bone-panel');
  if (bonePanelEl) bonePanel.mount(bonePanelEl);

  // ── Mocap ──────────────────────────────────────────────────────────────────
  const videoEl = document.getElementById('mocap-video') as HTMLVideoElement;
  const mocap   = new MocapController(vrm, videoEl);

  const mocapSys: MocapSystems = { mocap, debugViz: mocapDebugViz, dbgRecorder };

  const cleanupFns: CleanupFn[] = [];
  const registerCleanup = (...fns: Array<CleanupFn | undefined>): void => {
    for (const fn of fns) if (fn) cleanupFns.push(fn);
  };
  const cleanup = (): void => {
    for (let i = cleanupFns.length - 1; i >= 0; i--) cleanupFns[i]();
    cleanupFns.length = 0;
    if ((window as any).__mocapDbg === dbgRecorder) delete (window as any).__mocapDbg;
  };
  registerCleanup(
    () => mocap.dispose(),
    () => mocapDebugViz.dispose(),
    () => skelViz.dispose(),
    () => {
      vrm.scene.parent?.remove(vrm.scene);
      ctx.dispose();
    },
  );

  const entries = resolveAnimations();
  if (entries.length === 0) {
    setStatus('no .bvh files — idle mode active');
    vrm.scene.visible = false;
    const playback: PlaybackSystems = { controller: null, pa, micro, idle: idleLoop };
    const tooling: ToolingSystems   = { skelViz, validator, bonePanel };
    registerCleanup(
      mountDebugPanel(playback, mocapSys, tooling, (v) => { vrm.scene.visible = v; }),
      startRenderLoop(ctx, vrm, playback, mocapSys, tooling),
    );
    installGlobalCleanup(cleanup);
    return;
  }

  setStatus(`loading ${entries.length} animation${entries.length === 1 ? '' : 's'}…`);
  const controller = new AnimationController(vrm);

  for (const entry of entries) {
    const bvh  = await loadBVH(entry.url);
    const clip = await retargetBvhToVrm(vrm, bvh, entry.name);
    controller.register(entry.name, clip);
  }

  setStatus('drag animations from Library → Queue to play');

  const playback: PlaybackSystems = { controller, pa, micro, idle: idleLoop };
  const tooling: ToolingSystems   = { skelViz, validator, bonePanel };

  // ── Transport bar ─────────────────────────────────────────────────────────
  registerCleanup(mountTransport(controller));

  // ── Debug panel ────────────────────────────────────────────────────────────
  vrm.scene.visible = false;
  registerCleanup(
    mountDebugPanel(playback, mocapSys, tooling, (v) => { vrm.scene.visible = v; }),
  );

  // ── Library (source) ───────────────────────────────────────────────────────
  const names = entries.map((e) => e.name);

  // ── Queue (playback) ───────────────────────────────────────────────────────
  const queue = mountQueue({
    onJump:    (qi)       => controller.jumpTo(qi),
    onReorder: (from, to) => controller.reorderQueue(from, to),
    onAdd:     (itemIdx)  => {
      controller.addToQueue(itemIdx);
      queue.push(names[itemIdx]);
    },
    onRemove:  (qi) => {
      controller.removeFromQueue(qi);
      queue.remove(qi);
    },
  });

  const addLibraryItemToQueue = (itemIdx: number): void => {
    controller.addToQueue(itemIdx);
    queue.push(names[itemIdx]);
  };
  const refreshLibrary = (): void => mountLibrary({ names, onDragToQueue: addLibraryItemToQueue });

  refreshLibrary();

  // ── File-system BVH drop ───────────────────────────────────────────────────
  const handleDroppedBvhFile = async (file: File): Promise<void> => {
    const name = file.name.replace(/\.bvh$/i, '');
    setStatus(`loading ${name}…`);
    try {
      const text = await file.text();
      const bvh  = parseBVH(text);
      const clip = await retargetBvhToVrm(vrm, bvh, name);
      controller.register(name, clip);
      names.push(name);
      refreshLibrary();
      addLibraryItemToQueue(names.length - 1);
      setStatus(`▶ ${name}`);
    } catch (e) {
      setStatus(`load failed: ${(e as Error).message}`);
    }
  };

  const onWindowDragOver = (e: DragEvent): void => {
    if (Array.from(e.dataTransfer?.items ?? []).some((it) => it.kind === 'file')) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    }
  };
  const onWindowDrop = (e: DragEvent): void => {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => /\.bvh$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    files.forEach((f) => void handleDroppedBvhFile(f));
  };
  window.addEventListener('dragover', onWindowDragOver);
  window.addEventListener('drop', onWindowDrop);
  registerCleanup(() => {
    window.removeEventListener('dragover', onWindowDragOver);
    window.removeEventListener('drop', onWindowDrop);
  });

  // ── Mocap → auto-replay recorded BVH ───────────────────────────────────────
  // Debugging aid: immediately retargets the just-recorded BVH and plays it on
  // the same VRM. Compare this against what the model did during capture —
  // if they differ, the problem is in BVH encoding / retarget, not detection.
  mocap.onBvhReady = async (bvhText, name) => {
    try {
      const bvh  = parseBVH(bvhText);
      const clip = await retargetBvhToVrm(vrm, bvh, name);
      controller.register(name, clip);
      names.push(name);
      refreshLibrary();
      addLibraryItemToQueue(names.length - 1);
      setStatus(`▶ replaying ${name}`);
    } catch (e) {
      setStatus(`replay failed: ${(e as Error).message}`);
    }
  };

  controller.onChange((queuePos, item) => {
    queue.setActive(queuePos);
    setStatus(`${queuePos + 1}/${controller.queueLength} · ${item.name} · ${item.duration.toFixed(1)}s`);
  });

  registerCleanup(
    startRenderLoop(ctx, vrm, playback, mocapSys, tooling),
  );
  installGlobalCleanup(cleanup);
}

main().catch((err) => {
  console.error(err);
  setStatus(`error: ${(err as Error).message}`);
});
