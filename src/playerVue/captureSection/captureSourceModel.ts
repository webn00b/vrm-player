import type { CaptureSource, CaptureSourceOption } from './captureSectionTypes';

export const CAPTURE_SOURCE_STORAGE_KEY = 'vrm-player.capture-source';

export const captureSourceOptions: CaptureSourceOption[] = [
  { label: 'Live', value: 'camera' },
  { label: 'Video BVH', value: 'video' },
  { label: 'Multi-view', value: 'multiview' },
  { label: 'Anim export', value: 'animfile' },
];

export function validCaptureSource(source: string | null): CaptureSource {
  return source === 'video' || source === 'animfile' || source === 'multiview'
    ? source
    : 'camera';
}

export function capturePresetCaption(source: CaptureSource): string {
  if (source === 'camera') return 'Camera preview and recording';
  if (source === 'video') return 'Video file to mocap BVH';
  if (source === 'multiview') return 'Two videos to motion JSON';
  return 'Loaded animation to BVH';
}
