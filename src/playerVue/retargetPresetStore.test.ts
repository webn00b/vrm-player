import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  cleanManualMapping,
  createImportedRetargetPreset,
  createQuaternionPreset,
  createRetargetPreset,
  isQuaternionPreset,
  isRetargetPreset,
  loadPresetList,
  persistPresetList,
  type RetargetPreset,
} from './retargetLab/retargetPresetStore';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test('loadPresetList filters invalid preset records', () => {
  const storage = new MemoryStorage();
  storage.setItem('presets', JSON.stringify([
    {
      id: 'valid',
      name: 'Valid',
      format: 'fbx',
      sourceSignature: 'hips',
      sourceJointCount: 1,
      mappedCount: 1,
      mapping: { hips: 'Hips' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    { id: 'invalid' },
  ]));

  const presets = loadPresetList('presets', isRetargetPreset, storage);

  assert.equal(presets.length, 1);
  assert.equal((presets[0] as RetargetPreset).name, 'Valid');
});

test('loadPresetList returns empty list for malformed JSON', () => {
  const storage = new MemoryStorage();
  storage.setItem('presets', '{nope');

  assert.deepEqual(loadPresetList('presets', isQuaternionPreset, storage), []);
});

test('persistPresetList writes JSON to storage', () => {
  const storage = new MemoryStorage();

  persistPresetList('presets', [{ id: 'a' }], storage);

  assert.equal(storage.getItem('presets'), '[{"id":"a"}]');
});

test('createRetargetPreset derives metadata and removes empty mapping values', () => {
  const preset = createRetargetPreset({
    requestedName: '',
    fileName: 'walk_cycle.fbx',
    analysis: {
      format: 'fbx',
      clipCount: 1,
      duration: 2.5,
      sourceJoints: [
        { id: 'hips', name: 'Hips', parentId: null, trackCount: 3, position: [0, 1, 0] },
      ],
      targetJoints: [],
      mapping: {},
      warnings: [],
    },
    mapping: { hips: 'Hips', spine: '' },
    mappedCount: 1,
    now: new Date('2026-01-02T03:04:05.000Z'),
    id: 'preset-id',
  });

  assert.equal(preset.id, 'preset-id');
  assert.equal(preset.name, 'walk_cycle');
  assert.equal(preset.sourceSignature, 'Hips');
  assert.deepEqual(preset.mapping, { hips: 'Hips' });
  assert.equal(preset.createdAt, '2026-01-02T03:04:05.000Z');
});

test('createImportedRetargetPreset normalizes partial imported records', () => {
  const preset = createImportedRetargetPreset({
    parsed: {
      name: 'Imported',
      mapping: { hips: 'mixamorigHips', leftUpperArm: '' },
      createdAt: '2025-12-31T00:00:00.000Z',
    },
    fileName: 'fallback.json',
    now: new Date('2026-01-02T03:04:05.000Z'),
    id: 'imported-id',
  });

  assert.equal(preset.id, 'imported-id');
  assert.equal(preset.name, 'Imported');
  assert.equal(preset.format, 'unknown');
  assert.equal(preset.mappedCount, 1);
  assert.equal(preset.createdAt, '2025-12-31T00:00:00.000Z');
  assert.equal(preset.updatedAt, '2026-01-02T03:04:05.000Z');
});

test('createQuaternionPreset falls back to bone name', () => {
  const preset = createQuaternionPreset({
    requestedName: ' ',
    bone: 'hips',
    q: [0, 0, 0, 1],
    now: new Date('2026-01-02T03:04:05.000Z'),
    id: 'quat-id',
  });

  assert.deepEqual(preset, {
    id: 'quat-id',
    name: 'hips-quat',
    bone: 'hips',
    q: [0, 0, 0, 1],
    createdAt: '2026-01-02T03:04:05.000Z',
  });
});

test('cleanManualMapping keeps only assigned bones', () => {
  assert.deepEqual(cleanManualMapping({ hips: 'Hips', neck: undefined }), { hips: 'Hips' });
});
