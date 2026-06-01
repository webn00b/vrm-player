import { describe, expect, test } from 'vitest';
import { fixedVideoFrameTimes } from './videoFrameTimes';

describe('fixedVideoFrameTimes', () => {
  test('returns deterministic frame times at the requested fps', () => {
    expect(fixedVideoFrameTimes(1, 4)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  test('does not emit a timestamp at or beyond duration', () => {
    expect(fixedVideoFrameTimes(1.01, 2)).toEqual([0, 0.5, 1]);
  });

  test('rejects invalid duration or fps', () => {
    expect(fixedVideoFrameTimes(0, 30)).toEqual([]);
    expect(fixedVideoFrameTimes(1, 0)).toEqual([]);
    expect(fixedVideoFrameTimes(Number.NaN, 30)).toEqual([]);
  });
});
