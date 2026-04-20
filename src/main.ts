import * as THREE from 'three';
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

  const entries = resolveAnimations();
  if (entries.length === 0) {
    setStatus('no .bvh files — idle mode active');
    vrm.scene.visible = false;
    mountDebugPanel(micro, idleLoop, pa, () => null, () => mocap, skelViz, validator, mocapDebugViz, dbgRecorder, (v) => { vrm.scene.visible = v; });
    startRenderLoop(ctx, null, vrm, pa, micro, idleLoop, skelViz, validator, mocap, bonePanel, mocapDebugViz, dbgRecorder);
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
  vrm.scene.visible = false;
  mountDebugPanel(micro, idleLoop, pa, () => controller, () => mocap, skelViz, validator, mocapDebugViz, dbgRecorder, (v) => { vrm.scene.visible = v; });

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

  startRenderLoop(ctx, controller, vrm, pa, micro, idleLoop, skelViz, validator, mocap, bonePanel, mocapDebugViz, dbgRecorder);
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

    // 2b. Clamp all bone rotations to anatomical ROM
    validator.clampAll();

    // 3. Mocap overlay — runs AFTER BVH mixer so it overwrites animation bones.
    //    Face expressions also applied here (blendshapes don't conflict with BVH).
    mocap.applyLatestFrame();

    // 3b. Debug recorder — snapshot landmarks + IK targets + bone quaternions.
    if (dbgRecorder.active) {
      const frame = mocap.latestFrame;
      if (frame) dbgRecorder.capture(frame, mocap.debugTargets, mocap.calibration);
    }

    // 3c. Manual bone pose offsets (post-multiplied on top of mocap/animation).
    bonePanel.apply();

    // 3d. Debug skeleton — show performer landmarks mapped to avatar world space.
    if (mocapDebugViz.visible) {
      const frame = mocap.latestFrame;
      if (frame) {
        const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips' as any);
        const hipWorld = new THREE.Vector3();
        hipsNode?.getWorldPosition(hipWorld);

        // Actual avatar bone endpoints for comparison with IK targets
        const lhNode = vrm.humanoid.getNormalizedBoneNode('leftHand'  as any);
        const rhNode = vrm.humanoid.getNormalizedBoneNode('rightHand' as any);
        const lfNode = vrm.humanoid.getNormalizedBoneNode('leftFoot'  as any);
        const rfNode = vrm.humanoid.getNormalizedBoneNode('rightFoot' as any);
        const actualBones = {
          leftHand:  new THREE.Vector3(), rightHand: new THREE.Vector3(),
          leftFoot:  new THREE.Vector3(), rightFoot: new THREE.Vector3(),
        };
        lhNode?.getWorldPosition(actualBones.leftHand);
        rhNode?.getWorldPosition(actualBones.rightHand);
        lfNode?.getWorldPosition(actualBones.leftFoot);
        rfNode?.getWorldPosition(actualBones.rightFoot);

        mocapDebugViz.update(
          frame, hipWorld, mocap.calibration.bodyScale(), mocap.hipsBaseWorld,
          mocap.debugTargets, actualBones,
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
    requestAnimationFrame(tick);
  };
  tick();
}

main().catch((err) => {
  console.error(err);
  setStatus(`error: ${(err as Error).message}`);
});
