import * as THREE from 'three';
import type { createScene } from './scene';
import type { loadVRM } from './vrmLoader';
import type { PlaybackSystems, MocapSystems, ToolingSystems } from './playerSystems';
import { MOCAP_VALIDATION_EXCLUDED_BONES } from './mocap/mocapValidationBones';

type CleanupFn = () => void;

export function startRenderLoop(
  ctx: ReturnType<typeof createScene>,
  vrm: Awaited<ReturnType<typeof loadVRM>>,
  playback: PlaybackSystems,
  mocapSys: MocapSystems,
  tooling: ToolingSystems,
): CleanupFn {
  const { controller, pa, micro, idle } = playback;
  const { mocap, debugViz: mocapDebugViz, dbgRecorder } = mocapSys;
  const { skelViz, validator, bonePanel } = tooling;

  let stopped = false;
  let rafId = 0;
  const tick = () => {
    if (stopped) return;
    const delta = ctx.clock.getDelta();

    // 1. BVH mixer
    controller?.update(delta);

    // 2. Idle priority poses — only when BVH mixer is muted or absent
    if (!controller || controller.muted) {
      idle.update(vrm, pa);
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
    validator.clampAll(mocap.state === 'off' ? undefined : MOCAP_VALIDATION_EXCLUDED_BONES);

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
