export type CaptureSource = 'camera' | 'video' | 'animfile' | 'multiview';
export type MultiviewDepthAxis = 'x' | 'z' | '-x' | '-z';

export interface CaptureSourceOption {
  label: string;
  value: CaptureSource;
}
