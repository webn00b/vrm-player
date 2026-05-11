import type * as THREE from 'three';
import { createScene } from './scene';
import { loadVRM } from './vrmLoader';
import { parseBVH } from './bvhLoader';
import { retargetBvhToVrm, exportBvhAsVrma } from './retarget';
import type { ParsedBVH } from './bvhLoader';
import { loadAnimationFile, isSupportedAnimationFile } from './animationImport';
import { exportClipAsBvh } from './bvhExportRecorder';
import { exportClipAsGlb } from './gltfExportRecorder';
import { AnimationController } from './animationController';
import { PriorityAnimator } from './priorityAnimator';
import { MicroAnimations } from './microAnimations';
import { IdleLoop } from './idleLoop';
import { mountQueue, setStatus } from './ui';
import { mountDebugPanel } from './debugPanel';
import { BonePosePanel } from './bonePosePanel';
import { BoneDragController } from './boneDragController';
import { MocapController } from './mocap/pipeline/mocapController';
import { MocapDebugViz } from './mocap/diagnostics/mocapDebugViz';
import { MocapDebugRecorder } from './mocap/diagnostics/mocapDebugRecorder';
import { SkeletonVisualizer } from './skeletonVisualizer';
import { BoneValidator } from './validation/boneValidator';
import { HipForceTracker } from './physics/hipForce';
import { HipBalanceCorrector } from './physics/hipBalanceCorrector';
import { createSkeletonLogger } from './diagnostics/skeletonLogger';
import { renderLoopHooks } from './renderLoopHooks';
import { startRenderLoop } from './renderLoop';
import { mountTransport } from './transport';
import type { PlaybackSystems, MocapSystems, ToolingSystems } from './playerSystems';

/**
 * Resolve which VRM to load via runtime fetch of `models/index.json`.
 *
 * Why not `import.meta.glob` like before: with the build-time glob, .vrm
 * files had to be present in the repo at CI time for Vite to copy them into
 * `dist/assets/`. We don't want 16-50 MB binaries in git, so .vrm files
 * stay gitignored and live in `public/models/` locally + `/var/www/<site>/
 * models/` on the VPS. The CI rsync deploys excludes `models/*.vrm` so the
 * server-side copies persist; the site reads `models/index.json` (kept in
 * git inside `public/models/`) to know what's available at runtime.
 */
async function resolveVrmUrl(): Promise<string> {
  const res = await fetch('/models/index.json', { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(
      `models/index.json not found (HTTP ${res.status}). ` +
      `Add a JSON array of .vrm filenames to public/models/index.json ` +
      `and place the .vrm files in public/models/ locally / ` +
      `/var/www/<site>/models/ on the server.`,
    );
  }
  const list = await res.json() as string[];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('models/index.json is empty — add at least one .vrm filename');
  }
  // Sort alphabetically for deterministic "first" pick across runs.
  const sorted = [...list].sort();
  return `/models/${sorted[0]}`;
}

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

async function main() {
  const previousCleanup = (window as any)[GLOBAL_CLEANUP_KEY] as CleanupFn | undefined;
  previousCleanup?.();
  const container = document.getElementById('app');
  if (!container) throw new Error('#app not found');
  const ctx = createScene(container);

  setStatus('loading VRM…');
  const vrm = await loadVRM(await resolveVrmUrl());
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

  // ── Bone drag controller (in-scene rotation gizmo) ─────────────────────────
  const boneDrag = new BoneDragController(
    vrm, ctx.scene, ctx.camera, ctx.renderer.domElement, ctx.controls,
  );

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
    () => boneDrag.dispose(),
    () => {
      vrm.scene.parent?.remove(vrm.scene);
      ctx.dispose();
    },
  );

  const controller = new AnimationController(vrm);

  // Per-item parsed BVH cache, keyed by library item index. Used by the ⬇
  // export-as-VRMA button so we can re-run convertBVHToVRMAnimation on demand
  // without re-fetching/parsing.
  const bvhByIndex = new Map<number, ParsedBVH>();
  // Display names per library item index (controller already stores these
  // internally, but we mirror locally so we can pass the user-facing alias to
  // setStatus / queue.push without going through the controller).
  const names: string[] = [];

  setStatus('drop a .bvh file or record from mocap to start');

  // ── Hip force tracker (gravity + inertia diagnostic) ──────────────────────
  // Reads world positions of upper-body bones AFTER the full render pipeline
  // (BVH/mocap/manual offsets/validator clamp/micro), computes Σ-force at the
  // hip in world & hip-local space. Auto-resets on pause→resume; we explicitly
  // reset on clip change below in controller.onChange.
  const hipForce = new HipForceTracker(vrm, { isPaused: () => controller.paused });

  // ── Hip balance corrector (off by default) ────────────────────────────────
  // Closed-loop counter-rotation around hip-local X/Z driven by horizontal
  // components of `hipForce.latest`. Toggle from debug panel; reset shares
  // the same controller.onChange hook as hipForce.
  const hipBalance = new HipBalanceCorrector(vrm);

  // ── Skeleton logger (compact diagnostic, hooked post-clamp) ───────────────
  // Inert until `start()` is called from the debug-panel toggle. Wires into
  // renderLoopHooks.skeletonLoggerTick so the snapshot reflects the same
  // final on-screen pose that the BVH recorder sees.
  const skeletonLogger = createSkeletonLogger(vrm, validator);
  renderLoopHooks.skeletonLoggerTick = () => skeletonLogger.tick();
  registerCleanup(() => { renderLoopHooks.skeletonLoggerTick = null; });
  (window as any).__skelLog = skeletonLogger;

  const playback: PlaybackSystems = { controller, pa, micro, idle: idleLoop };
  const tooling: ToolingSystems   = { skelViz, validator, bonePanel, boneDrag, hipForce, hipBalance, skeletonLogger };

  vrm.scene.visible = false;

  // ── Queue (playback) ───────────────────────────────────────────────────────
  const queue = mountQueue({
    onJump:    (qi)       => controller.jumpTo(qi),
    onReorder: (from, to) => controller.reorderQueue(from, to),
    onRemove:  (qi) => {
      controller.removeFromQueue(qi);
      queue.remove(qi);
    },
    onExport: (qi) => {
      const itemIdx = controller.getItemIndexAtQueuePos(qi);
      const bvh = bvhByIndex.get(itemIdx);
      const name = names[itemIdx];
      if (!bvh || !name) { setStatus('no source BVH for this item — use ⬇bvh instead'); return; }
      exportBvhAsVrma(vrm, bvh, name)
        .then(() => setStatus(`saved ${name}.vrma`))
        .catch((e) => setStatus(`vrma export failed: ${(e as Error).message}`));
    },
    onExportBvh: (qi) => {
      setStatus('recording BVH…');
      const handle = exportClipAsBvh(qi, controller, vrm);
      handle.promise
        .then((filename) => setStatus(`saved ${filename}`))
        .catch((e) => setStatus(`bvh export failed: ${(e as Error).message}`));
    },
    onExportGlb: (qi) => {
      const clip = controller.getClipAtQueuePos(qi);
      if (!clip) { setStatus('no animation clip for this item'); return; }
      const itemIdx = controller.getItemIndexAtQueuePos(qi);
      const name = names[itemIdx] || 'export';
      setStatus('exporting GLB…');
      exportClipAsGlb(vrm, clip, name)
        .then((filename) => setStatus(`saved ${filename}`))
        .catch((e) => setStatus(`glb export failed: ${(e as Error).message}`));
    },
  });

  const registerAndEnqueue = (
    name: string,
    bvh: ParsedBVH | null,
    clip: THREE.AnimationClip,
  ): void => {
    controller.register(name, clip);
    const itemIdx = names.length;
    names.push(name);
    if (bvh) bvhByIndex.set(itemIdx, bvh);
    controller.addToQueue(itemIdx);
    queue.push(name);
  };

  // Single import path used by both Capture-panel file picker and window-drop.
  // Auto-plays via existing addToQueue → activate-first-item logic.
  const handleAnimationFile = async (file: File): Promise<void> => {
    const baseName = file.name;
    setStatus(`loading ${baseName}…`);
    try {
      const loaded = await loadAnimationFile(file, vrm);
      registerAndEnqueue(loaded.name, loaded.parsedBvh, loaded.clip);
      setStatus(`▶ ${loaded.name}`);
    } catch (e) {
      setStatus(`load failed: ${(e as Error).message}`);
    }
  };

  // ── Transport bar ─────────────────────────────────────────────────────────
  registerCleanup(mountTransport(controller));

  // ── Debug panel ────────────────────────────────────────────────────────────
  registerCleanup(
    mountDebugPanel(
      playback,
      mocapSys,
      tooling,
      (v) => { vrm.scene.visible = v; },
      handleAnimationFile,
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
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => isSupportedAnimationFile(f.name));
    if (!files.length) return;
    e.preventDefault();
    files.forEach((f) => void handleAnimationFile(f));
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
      registerAndEnqueue(name, bvh, clip);
      setStatus(`▶ replaying ${name}`);
    } catch (e) {
      setStatus(`replay failed: ${(e as Error).message}`);
    }
  };

  controller.onChange((queuePos, item) => {
    queue.setActive(queuePos);
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
});
