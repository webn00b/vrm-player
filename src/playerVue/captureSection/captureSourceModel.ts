import type { CaptureSource, CaptureSourceOption } from './captureSectionTypes';

export const CAPTURE_SOURCE_STORAGE_KEY = 'vrm-player.capture-source';

export const captureSourceOptions: CaptureSourceOption[] = [
  { label: 'Camera', value: 'camera', icon: '📷', hint: 'Record live from your webcam' },
  { label: 'Video file', value: 'video', icon: '🎬', hint: 'Convert a video file to animation' },
  { label: 'Multi-view', value: 'multiview', icon: '🎥', hint: 'Two camera angles → motion JSON' },
  { label: 'Animation', value: 'animfile', icon: '📁', hint: 'Re-export a loaded animation as BVH' },
];

export function validCaptureSource(source: string | null): CaptureSource {
  return source === 'video' || source === 'animfile' || source === 'multiview'
    ? source
    : 'camera';
}

export function capturePresetCaption(source: CaptureSource): string {
  if (source === 'camera') return 'Record live from your webcam and save the BVH (plus the footage).';
  if (source === 'video') return 'Pick a video, review the settings, then convert it to a BVH animation.';
  if (source === 'multiview') return 'Combine a front + side video into a motion JSON.';
  return 'Re-export a loaded animation as a BVH file.';
}
