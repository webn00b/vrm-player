import assert from 'node:assert/strict';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { test } from 'vitest';
import {
  buildMappedSourceNames,
  buildMappedTargetNames,
  countMappedSlots,
  findExtraMappedEntries,
  findRequiredMissingSlots,
  visibleSlotsForView,
  type MappingView,
} from './retargetLab/retargetMappingModel';

const slots = [
  { name: VRMHumanBoneName.Hips, label: 'Hips', required: true },
  { name: VRMHumanBoneName.LeftHand, label: 'Left Hand', required: true },
  { name: VRMHumanBoneName.LeftIndexProximal, label: 'Left Index 1', required: false },
];

test('visibleSlotsForView separates body and finger slots', () => {
  const namesFor = (view: MappingView) => visibleSlotsForView(slots, view).map((slot) => slot.name);

  assert.deepEqual(namesFor('body'), [VRMHumanBoneName.Hips, VRMHumanBoneName.LeftHand]);
  assert.deepEqual(namesFor('fingers'), [VRMHumanBoneName.LeftIndexProximal]);
  assert.deepEqual(namesFor('all'), slots.map((slot) => slot.name));
});

test('mapping helpers derive counts, missing required slots, and active name sets', () => {
  const mapping = {
    hips: 'mixamorigHips',
    leftIndexProximal: 'mixamorigLeftHandIndex1',
    neck: 'mixamorigNeck',
  };

  assert.equal(countMappedSlots(slots, mapping), 2);
  assert.deepEqual(findRequiredMissingSlots(slots, mapping).map((slot) => slot.name), [VRMHumanBoneName.LeftHand]);
  assert.deepEqual(findExtraMappedEntries(slots, mapping), [[VRMHumanBoneName.Neck, 'mixamorigNeck']]);
  assert.deepEqual([...buildMappedSourceNames(mapping)].sort(), [
    'mixamorigHips',
    'mixamorigLeftHandIndex1',
    'mixamorigNeck',
  ]);
  assert.deepEqual([...buildMappedTargetNames(mapping)].sort(), [
    VRMHumanBoneName.Hips,
    VRMHumanBoneName.LeftIndexProximal,
    VRMHumanBoneName.Neck,
  ].sort());
});
