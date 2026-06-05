import { describe, expect, test } from 'vitest';
import { clampTrimHandleDrag, pointerPercentToSeconds } from './bottomBarTrimRange';

describe('bottom bar trim range math', () => {
  test('maps pointer percent to clamped timeline seconds', () => {
    expect(pointerPercentToSeconds(-10, 4)).toBe(0);
    expect(pointerPercentToSeconds(25, 4)).toBe(1);
    expect(pointerPercentToSeconds(120, 4)).toBe(4);
    expect(pointerPercentToSeconds(50, 0)).toBe(0);
  });

  test('keeps dragged trim handles inside the clip and preserves a minimum range', () => {
    expect(clampTrimHandleDrag({
      edge: 'start',
      seconds: 2.8,
      start: 0,
      end: 3,
      duration: 4,
      minDuration: 0.25,
    })).toEqual({ start: 2.75, end: 3 });

    expect(clampTrimHandleDrag({
      edge: 'end',
      seconds: 0.1,
      start: 0,
      end: 3,
      duration: 4,
      minDuration: 0.25,
    })).toEqual({ start: 0, end: 0.25 });
  });
});
