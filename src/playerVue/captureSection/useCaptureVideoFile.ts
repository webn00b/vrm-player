import type { Ref } from 'vue';
import type { MocapController } from '../../mocap/pipeline/mocapController';
import type { MocapDebugRecorder } from '../../mocap/diagnostics/mocapDebugRecorder';
import { notify } from '../../ui';

interface CaptureVideoFileOptions {
  getMocap: () => MocapController | null;
  dbgRecorder: MocapDebugRecorder;
  agentOgiEnabled: Ref<boolean>;
  statusText: Ref<string>;
}

export function useCaptureVideoFile(options: CaptureVideoFileOptions) {
  async function onVideoFileChange(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const mocap = options.getMocap();
    if (!mocap || mocap.state !== 'off') return;
    mocap.exportAgentOgiJsonForVideo = options.agentOgiEnabled.value;
    options.dbgRecorder.start(Infinity);
    notify({ severity: 'info', summary: 'Processing video', detail: file.name, life: 2200 });
    try {
      await mocap.startFromFile(file);
    } catch (e) {
      options.dbgRecorder.stop();
      const msg = (e instanceof Error ? e.message : String(e)) || 'unknown error';
      options.statusText.value = `❌ ${msg.slice(0, 28)}`;
      notify({ severity: 'error', summary: 'Video processing failed', detail: msg, life: 4200 });
    }
  }

  return { onVideoFileChange };
}
