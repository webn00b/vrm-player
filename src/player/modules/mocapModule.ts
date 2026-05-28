/**
 * Owns mocap capture and mocap replay setup for the player bootstrap.
 * Keeps mocap diagnostics and recorded-BVH replay out of main.ts.
 */
import { parseBVH } from '../../bvhLoader';
import { clipToAgentOgiJson, downloadAgentOgiJson } from '../../animationToJsonConverter';
import { MocapDebugRecorder } from '../../mocap/diagnostics/mocapDebugRecorder';
import { MocapDebugViz } from '../../mocap/diagnostics/mocapDebugViz';
import { MocapController } from '../../mocap/pipeline/mocapController';
import type { MocapSystems } from '../../playerSystems';
import { retargetBvhToVrm } from '../../retarget';
import { notify, setStatus } from '../../ui';
import { requireAnimation, requirePlayback, requireScene, requireVrm } from '../assertions';
import type { PlayerModule } from '../types';

declare global {
  interface Window {
    __mocapDbg?: MocapDebugRecorder;
  }
}

export const mocapModule: PlayerModule = {
  name: 'mocap',
  setup(ctx) {
    const scene = requireScene(ctx);
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const animation = requireAnimation(ctx);
    const controller = playback.controller;
    if (!controller) throw new Error('Player playback controller is required before mocap runs');

    const debugViz = new MocapDebugViz(scene.scene);
    const dbgRecorder = new MocapDebugRecorder(vrm, 600);
    dbgRecorder.onStop = (frames) => {
      console.log('[MocapDebugRecorder] recording done —', frames.length, 'frames');
      dbgRecorder.logSummary();
      dbgRecorder.download('mocap_debug.json');
    };
    window.__mocapDbg = dbgRecorder;

    const videoEl = document.getElementById('mocap-video') as HTMLVideoElement;
    const mocap = new MocapController(vrm, videoEl);
    mocap.onBvhReady = async (bvhText, name, options) => {
      try {
        const bvh = parseBVH(bvhText);
        const clip = await retargetBvhToVrm(vrm, bvh, name);
        if (options?.source === 'video' && options.exportAgentOgiJson) {
          const filename = `${name}.agent_ogi.json`;
          downloadAgentOgiJson(
            clipToAgentOgiJson(clip, vrm),
            filename,
          );
          notify({ severity: 'success', summary: 'Agent OGI JSON saved', detail: filename });
        }
        const queuePos = animation.registerAndEnqueue(
          name,
          bvh,
          clip,
          new File([bvhText], `${name}.bvh`, { type: 'text/plain' }),
        );
        controller.jumpTo(queuePos, { immediate: true });
        setStatus(`▶ replaying ${name}`);
        notify({ severity: 'success', summary: 'Mocap BVH ready', detail: name });
      } catch (e) {
        const msg = (e as Error).message;
        setStatus(`replay failed: ${msg}`);
        notify({ severity: 'error', summary: 'Replay failed', detail: msg, life: 4200 });
      }
    };

    const mocapSys: MocapSystems = { mocap, debugViz, dbgRecorder };
    ctx.mocap = mocapSys;

    return () => {
      if (window.__mocapDbg === dbgRecorder) delete window.__mocapDbg;
      if (ctx.mocap === mocapSys) ctx.mocap = undefined;
      mocap.dispose();
      debugViz.dispose();
    };
  },
};
