import { computed, ref, type Ref } from 'vue';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';
import {
  buildMappedSourceNames,
  buildMappedTargetNames,
  countMappedSlots,
  findExtraMappedEntries,
  findRequiredMissingSlots,
  visibleSlotsForView,
  type MappingView,
  type RetargetSlot,
} from './retargetMappingModel';

interface UseRetargetMappingViewOptions {
  slots: RetargetSlot[];
  mapping: Ref<ManualFbxBoneMapping>;
}

export function useRetargetMappingView(options: UseRetargetMappingViewOptions) {
  const mappingView = ref<MappingView>('body');
  const mappingViewOptions: Array<{ label: string; value: MappingView }> = [
    { label: 'Body', value: 'body' },
    { label: 'Fingers', value: 'fingers' },
    { label: 'All', value: 'all' },
  ];
  const mappedCount = computed(() => countMappedSlots(options.slots, options.mapping.value));
  const extraMappedEntries = computed(() => findExtraMappedEntries(options.slots, options.mapping.value));
  const requiredMissing = computed(() => findRequiredMissingSlots(options.slots, options.mapping.value));
  const visibleRetargetSlots = computed(() => visibleSlotsForView(options.slots, mappingView.value));
  const mappedSourceNames = computed(() => buildMappedSourceNames(options.mapping.value));
  const mappedTargetNames = computed(() => buildMappedTargetNames(options.mapping.value));
  const missingTargetNames = computed(() => new Set(requiredMissing.value.map((slot) => slot.name)));
  const missingRequiredLabels = computed(() => requiredMissing.value.map((slot) => slot.label));

  return {
    mappingView,
    mappingViewOptions,
    mappedCount,
    extraMappedEntries,
    requiredMissing,
    visibleRetargetSlots,
    mappedSourceNames,
    mappedTargetNames,
    missingTargetNames,
    missingRequiredLabels,
  };
}
