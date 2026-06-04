import * as THREE from 'three';

const MIN_SEGMENT_DURATION = 1e-4;
const TIME_EPSILON = 1e-6;

export interface TrimAnimationClipOptions {
  start: number;
  end: number;
  name?: string;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function inferDuration(clip: THREE.AnimationClip): number {
  if (Number.isFinite(clip.duration) && clip.duration > 0) return clip.duration;
  let duration = 0;
  for (const track of clip.tracks) {
    const last = track.times[track.times.length - 1];
    if (Number.isFinite(last)) duration = Math.max(duration, last);
  }
  return duration;
}

function nearlySameTime(a: number, b: number): boolean {
  return Math.abs(a - b) <= TIME_EPSILON;
}

function sampleTrack(track: THREE.KeyframeTrack, time: number, stride: number): number[] {
  const sample = track.createInterpolant().evaluate(time) as ArrayLike<number>;
  return Array.from(sample).slice(0, stride);
}

function cloneTrackSegment(
  track: THREE.KeyframeTrack,
  start: number,
  end: number,
): THREE.KeyframeTrack {
  const stride = track.getValueSize();
  const sourceTimes = Array.from(track.times);
  const times: number[] = [0];
  const values: number[] = sampleTrack(track, start, stride);

  for (let index = 0; index < sourceTimes.length; index += 1) {
    const sourceTime = sourceTimes[index];
    if (sourceTime <= start + TIME_EPSILON || sourceTime >= end - TIME_EPSILON) continue;
    times.push(sourceTime - start);
    const offset = index * stride;
    values.push(...Array.from(track.values).slice(offset, offset + stride));
  }

  if (!nearlySameTime(times[times.length - 1], end - start)) {
    times.push(end - start);
    values.push(...sampleTrack(track, end, stride));
  }

  const TrackCtor = track.constructor as new (
    name: string,
    times: ArrayLike<number>,
    values: ArrayLike<number>,
    interpolation?: THREE.InterpolationModes,
  ) => THREE.KeyframeTrack;
  return new TrackCtor(track.name, times, values, track.getInterpolation());
}

export function trimAnimationClip(
  clip: THREE.AnimationClip,
  options: TrimAnimationClipOptions,
): THREE.AnimationClip {
  const duration = inferDuration(clip);
  const start = Math.max(0, Math.min(duration, finiteOr(options.start, 0)));
  const end = Math.max(0, Math.min(duration, finiteOr(options.end, duration)));

  if (end - start < MIN_SEGMENT_DURATION) {
    throw new Error('Trim end time must be after start time.');
  }

  const tracks = clip.tracks.map((track) => cloneTrackSegment(track, start, end));
  return new THREE.AnimationClip(
    options.name?.trim() || `${clip.name || 'clip'}_trim_${start.toFixed(2)}_${end.toFixed(2)}`,
    end - start,
    tracks,
  );
}
