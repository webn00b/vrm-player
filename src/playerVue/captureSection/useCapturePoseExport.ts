import { computed, ref, type Ref } from 'vue';
import type { VRM } from '@pixiv/three-vrm';
import type { MocapController } from '../../mocap/pipeline/mocapController';
import { clipToAgentOgiJson, downloadAgentOgiJson } from '../../animationToJsonConverter';
import { parseBVH } from '../../bvhLoader';
import { retargetBvhToVrm } from '../../retarget';
import { notify } from '../../ui';
import { shouldClampImportedAnimations, validationSettings } from '../../validation/validationSettings';

interface CapturePoseExportOptions {
  getMocap: () => MocapController | null;
  mocapVrm: VRM;
  agentOgiEnabled: Ref<boolean>;
  trackTimeout: (fn: () => void, ms: number) => number;
}

export function useCapturePoseExport(options: CapturePoseExportOptions) {
  const exportPoseLabel = ref('.bvh');
  const exportPoseTitle = ref('Download current avatar pose as a 1-frame BVH');
  const exportPoseDisabled = ref(false);
  const exportPoseJsonLabel = ref('.bvh + JSON');
  const exportPoseJsonTitle = ref('Download current avatar pose as BVH and agent_ogi JSON');
  const exportPoseJsonDisabled = ref(false);
  const singlePoseTitle = computed(() => (
    options.agentOgiEnabled.value ? 'export single pose ( for agent_ogi)' : 'export single pose'
  ));

  async function runPoseExport(
    includeAgentJson: boolean,
    label: Ref<string>,
    title: Ref<string>,
    disabled: Ref<boolean>,
  ): Promise<void> {
    const mocap = options.getMocap();
    if (!mocap) return;
    const prev = label.value;
    const idleTitle = title.value;
    label.value = '…';
    disabled.value = true;
    try {
      const { name, bvhText } = mocap.exportCurrentPoseBvh();
      if (includeAgentJson) {
        const bvh = parseBVH(bvhText);
        const clip = await retargetBvhToVrm(options.mocapVrm, bvh, name, {
          clampOutOfRange: shouldClampImportedAnimations(validationSettings),
          profileId: validationSettings.profileId,
        });
        downloadAgentOgiJson(clipToAgentOgiJson(clip, options.mocapVrm), `${name}.agent_ogi.json`);
      }
      label.value = 'Saved';
      title.value = includeAgentJson
        ? `Downloaded ${name}.bvh and ${name}.agent_ogi.json`
        : `Downloaded ${name}.bvh`;
      notify({
        severity: 'success',
        summary: 'Pose exported',
        detail: includeAgentJson ? `${name}.bvh + ${name}.agent_ogi.json` : `${name}.bvh`,
      });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)) || 'unknown error';
      label.value = 'Error';
      notify({ severity: 'error', summary: 'Pose export failed', detail: msg, life: 4200 });
    } finally {
      options.trackTimeout(() => {
        label.value = prev;
        title.value = idleTitle;
        disabled.value = false;
      }, 900);
    }
  }

  async function onExportPose(): Promise<void> {
    await runPoseExport(
      options.agentOgiEnabled.value,
      exportPoseLabel,
      exportPoseTitle,
      exportPoseDisabled,
    );
  }

  async function onExportPoseWithJson(): Promise<void> {
    await runPoseExport(true, exportPoseJsonLabel, exportPoseJsonTitle, exportPoseJsonDisabled);
  }

  return {
    exportPoseLabel,
    exportPoseTitle,
    exportPoseDisabled,
    exportPoseJsonLabel,
    exportPoseJsonTitle,
    exportPoseJsonDisabled,
    singlePoseTitle,
    onExportPose,
    onExportPoseWithJson,
  };
}
