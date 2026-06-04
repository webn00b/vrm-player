import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  activeCorrectionBones,
  activeQuaternionCorrections,
  createQuaternionCorrection,
  removeQuaternionCorrection,
  toggleQuaternionCorrection,
} from './retargetLab/retargetCorrectionModel';

const corrections = [
  { id: 'a', bone: 'hips', mode: 'post', q: [0, 0, 0, 1], enabled: true },
  { id: 'b', bone: 'head', mode: 'pre', q: [0, 0, 0, 1], enabled: false },
] as const;

test('activeQuaternionCorrections returns enabled corrections only', () => {
  assert.deepEqual(activeQuaternionCorrections(corrections), [corrections[0]]);
  assert.deepEqual([...activeCorrectionBones(corrections)], ['hips']);
});

test('toggleQuaternionCorrection flips one correction without mutating the input list', () => {
  const next = toggleQuaternionCorrection(corrections, 'b');

  assert.equal(corrections[1].enabled, false);
  assert.equal(next[1].enabled, true);
  assert.equal(next[0], corrections[0]);
});

test('removeQuaternionCorrection excludes a correction by id', () => {
  assert.deepEqual(removeQuaternionCorrection(corrections, 'a'), [corrections[1]]);
});

test('createQuaternionCorrection builds enabled correction records', () => {
  assert.deepEqual(createQuaternionCorrection({
    id: 'new',
    bone: 'hips',
    mode: 'absolute',
    q: [0, 0, 0, 1],
  }), {
    id: 'new',
    bone: 'hips',
    mode: 'absolute',
    q: [0, 0, 0, 1],
    enabled: true,
  });
});
