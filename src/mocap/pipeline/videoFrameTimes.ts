export function fixedVideoFrameTimes(durationSec: number, fps: number): number[] {
  if (!Number.isFinite(durationSec) || !Number.isFinite(fps) || durationSec <= 0 || fps <= 0) {
    return [];
  }

  const frameCount = Math.floor(durationSec * fps) + 1;
  const times: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const time = i / fps;
    if (time >= durationSec) break;
    times.push(time);
  }
  return times;
}

export function shouldRecordAfterPreroll(timeSec: number, prerollSec: number): boolean {
  if (!Number.isFinite(prerollSec) || prerollSec <= 0) return true;
  return timeSec >= prerollSec;
}
