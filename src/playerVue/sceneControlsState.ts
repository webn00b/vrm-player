import { reactive, watch } from 'vue';

const SCENE_CONTROLS_KEY = 'vrm-player.scene-controls';

interface SceneControlsSnapshot {
  modelOn: boolean;
  skeletonOn: boolean;
  skelBodyOn: boolean;
  skelFingersOn: boolean;
  dragOn: boolean;
}

const defaults: SceneControlsSnapshot = {
  modelOn: false,
  skeletonOn: true,
  skelBodyOn: true,
  skelFingersOn: true,
  dragOn: false,
};

function readStoredSceneControls(): SceneControlsSnapshot {
  try {
    const raw = localStorage.getItem(SCENE_CONTROLS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SceneControlsSnapshot>;
    return {
      modelOn: typeof parsed.modelOn === 'boolean' ? parsed.modelOn : defaults.modelOn,
      skeletonOn: typeof parsed.skeletonOn === 'boolean' ? parsed.skeletonOn : defaults.skeletonOn,
      skelBodyOn: typeof parsed.skelBodyOn === 'boolean' ? parsed.skelBodyOn : defaults.skelBodyOn,
      skelFingersOn: typeof parsed.skelFingersOn === 'boolean' ? parsed.skelFingersOn : defaults.skelFingersOn,
      dragOn: typeof parsed.dragOn === 'boolean' ? parsed.dragOn : defaults.dragOn,
    };
  } catch {
    return defaults;
  }
}

export const sceneControlsState = reactive(readStoredSceneControls());

watch(
  sceneControlsState,
  (state) => {
    try {
      localStorage.setItem(SCENE_CONTROLS_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  },
  { deep: true },
);
