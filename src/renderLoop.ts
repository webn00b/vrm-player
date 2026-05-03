import * as THREE from 'three';
import type { createScene } from './scene';
import type { loadVRM } from './vrmLoader';
import type { PlaybackSystems, MocapSystems, ToolingSystems } from './playerSystems';
import { MOCAP_VALIDATION_EXCLUDED_BONES } from './mocap/mocapValidationBones';
import { renderLoopHooks } from './renderLoopHooks';

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
  const { skelViz, validator, bonePanel, boneDrag, hipForce } = tooling;

  let stopped = false;
  let rafId = 0;
  const tick = () => {
    if (stopped) return;
    const delta = ctx.clock.getDelta();

    // 1. BVH mixer
    controller?.update(delta);

    // 1b. Optional extra mixer (e.g. verifier's production-path replay clip).
    renderLoopHooks.extraMixer?.update(delta);

    const overlaysSuspended = renderLoopHooks.suspendOverlays;
    const hasBvhActive = !!controller && controller.hasBvhActive && !controller.muted;

    // 2. Idle priority poses — only when BVH mixer is muted or absent
    if (!overlaysSuspended && (!controller || controller.muted)) {
      idle.update(vrm, pa);
      pa.applyAll();
    }

    // 3. Mocap overlay — runs AFTER BVH mixer so it overwrites animation bones.
    //    Skipped when an active BVH clip is playing so playback isn't perturbed
    //    by live mocap. Face expressions also applied here (blendshapes don't
    //    conflict with BVH).
    if (!overlaysSuspended && !hasBvhActive) {
      mocap.applyLatestFrame();
    }

    // 3b. Manual bone pose offsets (post-multiplied on top of mocap/animation).
    if (!overlaysSuspended) {
      bonePanel.apply();
      // In-scene rotation gizmo: reposition onto the selected joint, then
      // post-multiply each stored delta. Same layering as bonePanel — sits
      // on top of mocap/BVH, before validator clamp.
      boneDrag.update();
      boneDrag.apply();
    }

    // 3b2. Optional final wrist/finger overlay from hand tracking. This keeps
    // tracked hands as the highest-priority authored layer even if another
    // tool wrote hand bones earlier in the frame. Suppressed during playback
    // for the same reason as 3.
    if (!overlaysSuspended && !hasBvhActive) {
      mocap.applyTrackedHandsOverlay();
    }

    // 3c. Clamp the final authored pose (BVH / idle / mocap / manual offsets)
    // before debug capture and before micro-animations add their small deltas.
    // Use the same exclusion mask whenever a mocap source OR a BVH clip is
    // active — this guarantees record and playback see identical clamp logic
    // on arms/legs/hands/fingers, so a self-recorded clip plays back to the
    // same on-screen pose it was captured from.
    if (!renderLoopHooks.suspendValidatorClamp) {
      const skipMocapClampZone = mocap.state !== 'off' || hasBvhActive;
      validator.clampAll(skipMocapClampZone ? MOCAP_VALIDATION_EXCLUDED_BONES : undefined);
    }

    // 3c2. Record the on-screen pose (post-clamp, post-overlays) into the live
    // recorder. Doing this AFTER clamp ensures the BVH file matches exactly
    // what the user saw during capture.
    mocap.captureRecordedFrame();

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
    if (!overlaysSuspended) {
      micro.update(vrm);
    }

    // 5. VRM systems
    vrm.update(delta);

    // 5b. Verifier hook — runs after bones have their final production values.
    renderLoopHooks.onAfterVrmUpdate?.(delta);
    // 5c. BVH-export sink — same timing, separate slot so the verifier and the
    // export recorder don't have to share a single callback.
    renderLoopHooks.poseCaptureSink?.(delta);

    // 5d. Hip force tracker — diagnostic only. Reads final world positions of
    // upper-body bones, accumulates gravity + inertia, exposes via .latest for
    // the debug panel. Cheap (~10 bones × a few Vector3 ops).
    hipForce.update(delta);

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
