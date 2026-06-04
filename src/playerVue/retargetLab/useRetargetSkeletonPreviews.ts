import { computed, type ComputedRef, type Ref } from 'vue';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { QuaternionCorrection } from '../../retargetCorrections';
import type { RetargetLabAnalysis, SkeletonJointMeta } from '../../retargetLabModel';
import {
  buildCorrectedTargetJoints,
  buildSkeletonPreview,
} from './retargetPreviewModel';

interface UseRetargetSkeletonPreviewsOptions {
  analysis: Ref<RetargetLabAnalysis | null>;
  targetJoints: ComputedRef<SkeletonJointMeta[]>;
  mappedSourceNames: ComputedRef<Set<string>>;
  mappedTargetNames: ComputedRef<Set<VRMHumanBoneName>>;
  missingTargetNames: ComputedRef<Set<VRMHumanBoneName>>;
  activeCorrectionBones: ComputedRef<Set<string>>;
  quaternionCorrections: Ref<QuaternionCorrection[]>;
}

export function useRetargetSkeletonPreviews(options: UseRetargetSkeletonPreviewsOptions) {
  const sourcePreview = computed(() => buildSkeletonPreview(
    options.analysis.value?.sourceJoints ?? [],
    options.mappedSourceNames.value,
  ));
  const targetPreview = computed(() => buildSkeletonPreview(
    options.targetJoints.value,
    options.mappedTargetNames.value,
    options.missingTargetNames.value,
  ));
  const correctedTargetJoints = computed(() => buildCorrectedTargetJoints(
    options.targetJoints.value,
    options.quaternionCorrections.value,
  ));
  const originalComparePreview = computed(() => buildSkeletonPreview(
    options.targetJoints.value,
    options.activeCorrectionBones.value,
    options.missingTargetNames.value,
  ));
  const correctedComparePreview = computed(() => buildSkeletonPreview(
    correctedTargetJoints.value,
    options.activeCorrectionBones.value,
    options.missingTargetNames.value,
  ));

  return {
    sourcePreview,
    targetPreview,
    correctedTargetJoints,
    originalComparePreview,
    correctedComparePreview,
  };
}
