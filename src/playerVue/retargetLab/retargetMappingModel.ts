import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';

export type MappingView = 'body' | 'fingers' | 'all';

export interface RetargetSlot {
  name: VRMHumanBoneName;
  label: string;
  required: boolean;
}

export function isFingerSlot(slot: string): boolean {
  return (
    slot.includes('Thumb') ||
    slot.includes('Index') ||
    slot.includes('Middle') ||
    slot.includes('Ring') ||
    slot.includes('Little')
  );
}

export function visibleSlotsForView(slots: RetargetSlot[], view: MappingView): RetargetSlot[] {
  return slots.filter((slot) => {
    if (view === 'all') return true;
    const finger = isFingerSlot(slot.name);
    return view === 'fingers' ? finger : !finger;
  });
}

export function countMappedSlots(slots: RetargetSlot[], mapping: ManualFbxBoneMapping): number {
  return slots.filter((slot) => !!mapping[slot.name]).length;
}

export function findRequiredMissingSlots(slots: RetargetSlot[], mapping: ManualFbxBoneMapping): RetargetSlot[] {
  return slots.filter((slot) => slot.required && !mapping[slot.name]);
}

export function findExtraMappedEntries(
  slots: RetargetSlot[],
  mapping: ManualFbxBoneMapping,
): Array<[VRMHumanBoneName, string]> {
  const knownSlots = new Set(slots.map((slot) => slot.name));
  return (Object.entries(mapping) as Array<[VRMHumanBoneName, string | undefined]>)
    .filter((entry): entry is [VRMHumanBoneName, string] => !!entry[1] && !knownSlots.has(entry[0]));
}

export function buildMappedSourceNames(mapping: ManualFbxBoneMapping): Set<string> {
  return new Set(Object.values(mapping).filter((name): name is string => !!name));
}

export function buildMappedTargetNames(mapping: ManualFbxBoneMapping): Set<VRMHumanBoneName> {
  return new Set((Object.keys(mapping) as VRMHumanBoneName[]).filter((slot) => !!mapping[slot]));
}
