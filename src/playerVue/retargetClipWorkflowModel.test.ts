import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  buildContextSourceLabel,
  buildPreviewStatusLabel,
  canImportClip,
  canPreviewClip,
  startedPreviewState,
  stoppedPreviewState,
} from './retargetLab/retargetClipWorkflowModel';

test('buildPreviewStatusLabel describes current preview state', () => {
  assert.equal(buildPreviewStatusLabel(true, ''), 'Preparing preview');
  assert.equal(buildPreviewStatusLabel(false, 'corrected'), 'Previewing corrected');
  assert.equal(buildPreviewStatusLabel(false, ''), 'Preview idle');
});

test('buildContextSourceLabel describes source origin', () => {
  assert.equal(buildContextSourceLabel('player'), 'Opened from Player queue');
  assert.equal(buildContextSourceLabel('manual'), 'Local source');
});

test('canImportClip and canPreviewClip guard disabled workflow states', () => {
  assert.equal(canImportClip({ hasFile: true, loading: false, importing: false }), true);
  assert.equal(canImportClip({ hasFile: true, loading: true, importing: false }), false);
  assert.equal(canPreviewClip({ hasFile: true, hasPreviewHandler: true, loading: false, previewing: false }), true);
  assert.equal(canPreviewClip({ hasFile: true, hasPreviewHandler: false, loading: false, previewing: false }), false);
});

test('preview state helpers initialize and clear preview playback state', () => {
  assert.deepEqual(startedPreviewState({ name: 'walk', duration: 1.25 }, true), {
    name: 'walk',
    duration: 1.25,
    time: 0,
    mode: 'corrected',
  });
  assert.deepEqual(stoppedPreviewState(), {
    name: '',
    duration: 0,
    time: 0,
    mode: '',
  });
});
