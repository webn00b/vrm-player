import { describe, expect, test, vi } from 'vitest';
import {
  loadMocapStabilizerSettings,
  MOCAP_STABILIZER_SETTINGS_KEY,
  normalizeMocapStabilizerSettings,
  saveMocapStabilizerSettings,
} from './mocapStabilizerSettings';

function storageWith(initial: string | null = null): Storage {
  const data = new Map<string, string>();
  if (initial !== null) data.set(MOCAP_STABILIZER_SETTINGS_KEY, initial);
  return {
    get length() { return data.size; },
    clear: vi.fn(() => data.clear()),
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(data.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => { data.delete(key); }),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
  };
}

describe('mocapStabilizerSettings', () => {
  test('normalizes valid stored settings and clamps out-of-range values', () => {
    expect(normalizeMocapStabilizerSettings({
      prerollSec: 9,
      bodyMaxStep: 0.2,
      bodyMaxZStep: -1,
      bodyMaxGapFrames: 2.4,
      handMaxStep: 0.3,
      handMaxZStep: 0.5,
      handMaxGapFrames: 4.6,
      ignored: 123,
    })).toEqual({
      prerollSec: 3,
      bodyMaxStep: 0.2,
      bodyMaxZStep: 0.02,
      bodyMaxGapFrames: 2,
      handMaxStep: 0.3,
      handMaxZStep: 0.4,
      handMaxGapFrames: 5,
    });
  });

  test('load ignores malformed json and invalid shapes', () => {
    expect(loadMocapStabilizerSettings(storageWith('{'))).toBeNull();
    expect(loadMocapStabilizerSettings(storageWith(JSON.stringify({ prerollSec: '1.5' })))).toBeNull();
  });

  test('save writes normalized settings under the panel key', () => {
    const storage = storageWith();

    saveMocapStabilizerSettings({
      prerollSec: 1.8,
      bodyMaxStep: 0.5,
      bodyMaxZStep: 0.2,
      bodyMaxGapFrames: 3.2,
      handMaxStep: 0.14,
      handMaxZStep: 0.1,
      handMaxGapFrames: 2,
    }, storage);

    const raw = storage.getItem(MOCAP_STABILIZER_SETTINGS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({
      prerollSec: 1.8,
      bodyMaxGapFrames: 3,
      handMaxGapFrames: 2,
    });
  });
});
