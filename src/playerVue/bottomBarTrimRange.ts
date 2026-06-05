export type TrimEdge = 'start' | 'end';

export interface ClampTrimHandleDragOptions {
  edge: TrimEdge;
  seconds: number;
  start: number;
  end: number;
  duration: number;
  minDuration: number;
}

export interface TrimRange {
  start: number;
  end: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function pointerPercentToSeconds(percent: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return (clamp(percent, 0, 100) / 100) * duration;
}

export function clampTrimHandleDrag(options: ClampTrimHandleDragOptions): TrimRange {
  const duration = Math.max(0, options.duration);
  const minDuration = Math.max(0, options.minDuration);
  const start = clamp(options.start, 0, duration);
  const end = clamp(options.end, 0, duration);

  if (options.edge === 'start') {
    return {
      start: clamp(options.seconds, 0, Math.max(0, end - minDuration)),
      end,
    };
  }

  return {
    start,
    end: clamp(options.seconds, Math.min(duration, start + minDuration), duration),
  };
}
