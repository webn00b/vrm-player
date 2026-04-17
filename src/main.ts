import { createScene } from './scene';
import { loadVRM } from './vrmLoader';
import { loadBVH, parseBVH } from './bvhLoader';
import { retargetBvhToVrm } from './retarget';
import { AnimationController } from './animationController';
import { PriorityAnimator } from './priorityAnimator';
import { MicroAnimations } from './microAnimations';
import { IdleLoop } from './idleLoop';
import { mountLibrary, mountQueue, setStatus } from './ui';
import { mountDebugPanel } from './debugPanel';
import { MocapController } from './mocap/mocapController';
import { SkeletonVisualizer } from './skeletonVisualizer';

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

function resolveAnimations(): AnimationEntry[] {
  return Object.entries(bvhModules)
    .map(([path, url]) => {
      const file = path.split('/').pop() ?? path;
      return { name: file.replace(/\.bvh$/i, ''), url };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
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

  // ── Skeleton visualizer ────────────────────────────────────────────────────
  const skelViz = new SkeletonVisualizer(vrm, ctx.scene);

  // ── Mocap ──────────────────────────────────────────────────────────────────
  const videoEl = document.getElementById('mocap-video') as HTMLVideoElement;
  const mocap   = new MocapController(vrm, videoEl);

  const entries = resolveAnimations();
  if (entries.length === 0) {
    setStatus('no .bvh files — idle mode active');
    mountDebugPanel(micro, idleLoop, pa, () => null, () => mocap, skelViz);
    startRenderLoop(ctx, null, vrm, pa, micro, idleLoop, skelViz);
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

  // ── Debug panel ────────────────────────────────────────────────────────────
  mountDebugPanel(micro, idleLoop, pa, () => controller, () => mocap, skelViz);

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

  startRenderLoop(ctx, controller, vrm, pa, micro, idleLoop, skelViz);
}

function startRenderLoop(
  ctx: ReturnType<typeof createScene>,
  controller: AnimationController | null,
  vrm: Awaited<ReturnType<typeof loadVRM>>,
  pa: PriorityAnimator,
  micro: MicroAnimations,
  idleLoop: IdleLoop,
  skelViz: SkeletonVisualizer,
): void {
  const tick = () => {
    const delta = ctx.clock.getDelta();

    // 1. BVH mixer
    controller?.update(delta);

    // 2. Idle priority poses — only when BVH mixer is muted or absent
    if (!controller || controller.muted) {
      idleLoop.update(vrm, pa);
      pa.applyAll();
    }

    // 3. Micro-animations — always, delta-based
    micro.update(vrm);

    // 4. VRM systems
    vrm.update(delta);

    // 5. Skeleton overlay (after vrm.update so world matrices are fresh)
    skelViz.update();

    ctx.controls.update();
    ctx.renderer.render(ctx.scene, ctx.camera);
    requestAnimationFrame(tick);
  };
  tick();
}

main().catch((err) => {
  console.error(err);
  setStatus(`error: ${(err as Error).message}`);
});
