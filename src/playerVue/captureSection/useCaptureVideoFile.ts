import type { Ref } from 'vue';
import type { MocapController } from '../../mocap/pipeline/mocapController';
import type { MocapDebugRecorder } from '../../mocap/diagnostics/mocapDebugRecorder';
import { notify } from '../../ui';
import { friendlyCaptureError } from './captureErrors';

interface CaptureVideoFileOptions {
  getMocap: () => MocapController | null;
  dbgRecorder: MocapDebugRecorder;
  agentOgiEnabled: Ref<boolean>;
  statusText: Ref<string>;
}

export function useCaptureVideoFile(options: CaptureVideoFileOptions) {
  /** Run the two-pass conversion on a staged file. The picker no longer
   *  starts this directly — the user reviews the conversion settings first,
   *  then triggers it from the primary CTA. */
  async function convertVideo(file: File): Promise<void> {
    const mocap = options.getMocap();
    if (!mocap || mocap.state !== 'off') return;
    mocap.exportAgentOgiJsonForVideo = options.agentOgiEnabled.value;
    options.dbgRecorder.start(Infinity);
    notify({ severity: 'info', summary: 'Processing video', detail: file.name, life: 2200 });
    try {
      await mocap.startFromFile(file);
    } catch (e) {
      options.dbgRecorder.stop();
      const f = friendlyCaptureError(e);
      options.statusText.value = f.status;
      notify({ severity: 'error', summary: f.status.replace(/^\S+\s/, ''), detail: f.detail, life: 5000 });
    }
  }

  return { convertVideo };
}
