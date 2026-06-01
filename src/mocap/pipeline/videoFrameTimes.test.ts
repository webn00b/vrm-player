import { describe, expect, test } from 'vitest';
import { fixedVideoFrameTimes, shouldRecordAfterPreroll } from './videoFrameTimes';

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

describe('shouldRecordAfterPreroll', () => {
  test('skips frames before preroll and records from the boundary onward', () => {
    expect(shouldRecordAfterPreroll(1.49, 1.5)).toBe(false);
    expect(shouldRecordAfterPreroll(1.5, 1.5)).toBe(true);
    expect(shouldRecordAfterPreroll(1.51, 1.5)).toBe(true);
  });

  test('records immediately when preroll is disabled', () => {
    expect(shouldRecordAfterPreroll(0, 0)).toBe(true);
    expect(shouldRecordAfterPreroll(0, -1)).toBe(true);
  });
});
