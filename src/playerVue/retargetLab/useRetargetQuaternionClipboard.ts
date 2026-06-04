import * as THREE from 'three';
import type { Ref } from 'vue';
import type { ToastServiceMethods } from 'primevue/toastservice';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  buildQuaternionClipboardJson,
  parseQuaternionClipboardJson,
} from './retargetQuaternionClipboardModel';
import type { EulerDegFields, QuaternionFields } from './retargetQuaternionTypes';

interface UseRetargetQuaternionClipboardOptions {
  selectedBone: Ref<VRMHumanBoneName>;
  quat: QuaternionFields;
  eulerDeg: EulerDegFields;
  setQuaternionFields: (q: THREE.Quaternion) => void;
  toast: ToastServiceMethods;
}

export function useRetargetQuaternionClipboard(options: UseRetargetQuaternionClipboardOptions) {
  async function copyQuaternionJson(): Promise<void> {
    const payload = buildQuaternionClipboardJson({
      bone: options.selectedBone.value,
      quat: options.quat,
      eulerDeg: options.eulerDeg,
    });
    await navigator.clipboard.writeText(payload);
    options.toast.add({
      severity: 'success',
      summary: 'Copied',
      detail: 'Quaternion JSON copied',
      life: 2000,
    });
  }

  async function pasteQuaternionJson(): Promise<void> {
    try {
      const payload = parseQuaternionClipboardJson(await navigator.clipboard.readText());
      if (payload.bone) options.selectedBone.value = payload.bone as VRMHumanBoneName;
      options.setQuaternionFields(new THREE.Quaternion(...payload.q).normalize());
    } catch (e) {
      options.toast.add({
        severity: 'error',
        summary: 'Paste failed',
        detail: (e as Error).message,
        life: 3000,
      });
    }
  }

  return {
    copyQuaternionJson,
    pasteQuaternionJson,
  };
}
