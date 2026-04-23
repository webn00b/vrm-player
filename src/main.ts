import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
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

const LIVE_MOCAP_HAND_BONE_SUFFIXES = [
  'ThumbMetacarpal',
  'ThumbProximal',
  'ThumbDistal',
  'IndexProximal',
  'IndexIntermediate',
  'IndexDistal',
  'MiddleProximal',
  'MiddleIntermediate',
  'MiddleDistal',
  'RingProximal',
  'RingIntermediate',
  'RingDistal',
  'LittleProximal',
  'LittleIntermediate',
  'LittleDistal',
] as const;

const LIVE_MOCAP_VALIDATION_EXCLUDED_BONES = new Set<VRMHumanBoneName>([
  VRMHumanBoneName.LeftShoulder,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.RightShoulder,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.RightHand,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.RightFoot,
  ...(['Left', 'Right'] as const).flatMap((side) =>
    LIVE_MOCAP_HAND_BONE_SUFFIXES.map(
      (suffix) => VRMHumanBoneName[`${side}${suffix}` as keyof typeof VRMHumanBoneName],
    ),
  ),
]);

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
    registerCleanup(
      mountDebugPanel(micro, idleLoop, pa, () => null, () => mocap, skelViz, validator, mocapDebugViz, dbgRecorder, (v) => { vrm.scene.visible = v; }),
      startRenderLoop(ctx, null, vrm, pa, micro, idleLoop, skelViz, validator, mocap, bonePanel, mocapDebugViz, dbgRecorder),
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

  // ── Transport bar ─────────────────────────────────────────────────────────
  registerCleanup(mountTransport(controller));

  // ── Debug panel ────────────────────────────────────────────────────────────
  vrm.scene.visible = false;
  registerCleanup(
    mountDebugPanel(micro, idleLoop, pa, () => controller, () => mocap, skelViz, validator, mocapDebugViz, dbgRecorder, (v) => { vrm.scene.visible = v; }),
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

  mountLibrary({
    names,
    onDragToQueue: (itemIdx) => {
      controller.addToQueue(itemIdx);
      queue.push(names[itemIdx]);
    },
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
      const idx = names.length - 1;
      controller.addToQueue(idx);
      queue.push(name);
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
    startRenderLoop(ctx, controller, vrm, pa, micro, idleLoop, skelViz, validator, mocap, bonePanel, mocapDebugViz, dbgRecorder),
  );
  installGlobalCleanup(cleanup);
}

function startRenderLoop(
  ctx: ReturnType<typeof createScene>,
  controller: AnimationController | null,
  vrm: Awaited<ReturnType<typeof loadVRM>>,
  pa: PriorityAnimator,
  micro: MicroAnimations,
  idleLoop: IdleLoop,
  skelViz: SkeletonVisualizer,
  validator: BoneValidator,
  mocap: MocapController,
  bonePanel: BonePosePanel,
  mocapDebugViz: MocapDebugViz,
  dbgRecorder: MocapDebugRecorder,
): CleanupFn {
  let stopped = false;
  let rafId = 0;
  const tick = () => {
    if (stopped) return;
    const delta = ctx.clock.getDelta();

    // 1. BVH mixer
    controller?.update(delta);

    // 2. Idle priority poses — only when BVH mixer is muted or absent
    if (!controller || controller.muted) {
      idleLoop.update(vrm, pa);
      pa.applyAll();
    }

    // 3. Mocap overlay — runs AFTER BVH mixer so it overwrites animation bones.
    //    Face expressions also applied here (blendshapes don't conflict with BVH).
    mocap.applyLatestFrame();

    // 3b. Manual bone pose offsets (post-multiplied on top of mocap/animation).
    bonePanel.apply();

    // 3b2. Optional final wrist/finger overlay from hand tracking. This keeps
    // tracked hands as the highest-priority authored layer even if another
    // tool wrote hand bones earlier in the frame.
    mocap.applyTrackedHandsOverlay();

    // 3c. Clamp the final authored pose (BVH / idle / mocap / manual offsets)
    // before debug capture and before micro-animations add their small deltas.
    validator.clampAll(mocap.state === 'off' ? undefined : LIVE_MOCAP_VALIDATION_EXCLUDED_BONES);

    // 3d. Debug recorder — snapshot landmarks + IK targets + final bone quaternions.
    if (dbgRecorder.active) {
      const frame = mocap.latestFrame;
      if (frame) dbgRecorder.capture(frame, mocap.debugTargets, mocap.calibration);
    }

    // 3e. Debug skeleton — show performer landmarks mapped to avatar world space.
    if (mocapDebugViz.visible) {
      const frame = mocap.latestFrame;
      if (frame) {
        // Cache bone nodes + scratch vectors on first call to avoid lookups/allocations each frame.
        const cache = (tick as any)._dbgVizCache ??= {
          hipsNode:  vrm.humanoid.getNormalizedBoneNode('hips'      as any),
          lhNode:    vrm.humanoid.getNormalizedBoneNode('leftHand'  as any),
          rhNode:    vrm.humanoid.getNormalizedBoneNode('rightHand' as any),
          lfNode:    vrm.humanoid.getNormalizedBoneNode('leftFoot'  as any),
          rfNode:    vrm.humanoid.getNormalizedBoneNode('rightFoot' as any),
          hipWorld:  new THREE.Vector3(),
          actualBones: {
            leftHand:  new THREE.Vector3(), rightHand: new THREE.Vector3(),
            leftFoot:  new THREE.Vector3(), rightFoot: new THREE.Vector3(),
          },
        };
        const hipWorld = cache.hipWorld;
        cache.hipsNode?.getWorldPosition(hipWorld);
        const actualBones = cache.actualBones;
        cache.lhNode?.getWorldPosition(actualBones.leftHand);
        cache.rhNode?.getWorldPosition(actualBones.rightHand);
        cache.lfNode?.getWorldPosition(actualBones.leftFoot);
        cache.rfNode?.getWorldPosition(actualBones.rightFoot);

        const cal = mocap.calibration;
        mocapDebugViz.update(
          frame, hipWorld, cal.bodyScale(), mocap.hipsBaseWorld,
          mocap.debugTargets, actualBones,
          {
            armL: cal.armScale('left'),
            armR: cal.armScale('right'),
            legL: cal.legScale(),
            legR: cal.legScale(),
          },
        );
      }
    }

    // 4. Micro-animations — always, delta-based
    micro.update(vrm);

    // 5. VRM systems
    vrm.update(delta);

    // 6. Skeleton overlay (after vrm.update so world matrices are fresh)
    skelViz.update();

    ctx.controls.update();
    ctx.renderer.render(ctx.scene, ctx.camera);
    rafId = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
  };
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function mountTransport(controller: AnimationController): CleanupFn {
  const bar      = document.getElementById('transport');
  const nameEl   = document.getElementById('tp-name');
  const prevBtn  = document.getElementById('tp-prev');
  const playBtn  = document.getElementById('tp-play');
  const nextBtn  = document.getElementById('tp-next');
  const timeline = document.getElementById('tp-timeline');
  const progress = document.getElementById('tp-progress');
  const timeEl   = document.getElementById('tp-time');
  if (!bar || !nameEl || !prevBtn || !playBtn || !nextBtn || !timeline || !progress || !timeEl) return () => {};

  const listenerAbort = new AbortController();
  const listenerOpts: AddEventListenerOptions = { signal: listenerAbort.signal };

  prevBtn.addEventListener('click', () => controller.prev(), listenerOpts);
  nextBtn.addEventListener('click', () => controller.next(), listenerOpts);
  playBtn.addEventListener('click', () => {
    controller.togglePaused();
    playBtn.textContent = controller.paused ? '▶' : '⏸';
  }, listenerOpts);

  const seekFromEvent = (ev: PointerEvent): void => {
    const dur = controller.currentDuration;
    if (dur <= 0) return;
    const rect = timeline.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    controller.seek(frac * dur);
  };
  timeline.addEventListener('pointerdown', (ev) => {
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    seekFromEvent(ev as PointerEvent);
  }, listenerOpts);
  timeline.addEventListener('pointermove', (ev) => {
    if ((ev as PointerEvent).pressure > 0 || (ev.buttons & 1)) seekFromEvent(ev as PointerEvent);
  }, listenerOpts);

  // Refresh UI 10× per second
  const intervalId = window.setInterval(() => {
    const hasActive = controller.hasBvhActive;
    bar.classList.toggle('empty', !hasActive);
    if (!hasActive) {
      nameEl.textContent   = '—';
      timeEl.textContent   = '0:00 / 0:00';
      (progress as HTMLElement).style.width = '0%';
      playBtn.textContent  = '▶';
      return;
    }
    const t    = controller.currentTime;
    const dur  = controller.currentDuration;
    const frac = dur > 0 ? Math.min(t / dur, 1) : 0;
    nameEl.textContent   = formatLibraryName(controller.currentName);
    timeEl.textContent   = `${formatTime(t)} / ${formatTime(dur)}`;
    (progress as HTMLElement).style.width = `${frac * 100}%`;
    playBtn.textContent  = controller.paused ? '▶' : '⏸';
  }, 100);

  return () => {
    listenerAbort.abort();
    clearInterval(intervalId);
  };
}

main().catch((err) => {
  console.error(err);
  setStatus(`error: ${(err as Error).message}`);
});
