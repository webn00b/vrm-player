export type SourceOrigin = 'manual' | 'player';
export type PreviewMode = 'original' | 'corrected' | '';

export interface PreviewPlaybackState {
  name: string;
  duration: number;
  time: number;
  mode: PreviewMode;
}

export function buildContextSourceLabel(origin: SourceOrigin): string {
  return origin === 'player' ? 'Opened from Player queue' : 'Local source';
}

export function buildPreviewStatusLabel(previewing: boolean, mode: PreviewMode): string {
  if (previewing) return 'Preparing preview';
  if (mode) return `Previewing ${mode}`;
  return 'Preview idle';
}

export function canImportClip(params: {
  hasFile: boolean;
  loading: boolean;
  importing: boolean;
}): boolean {
  return params.hasFile && !params.loading && !params.importing;
}

export function canPreviewClip(params: {
  hasFile: boolean;
  hasPreviewHandler: boolean;
  loading: boolean;
  previewing: boolean;
}): boolean {
  return params.hasFile && params.hasPreviewHandler && !params.loading && !params.previewing;
}

export function startedPreviewState(
  result: { name: string; duration: number },
  corrected: boolean,
): PreviewPlaybackState {
  return {
    name: result.name,
    duration: result.duration,
    time: 0,
    mode: corrected ? 'corrected' : 'original',
  };
}

export function stoppedPreviewState(): PreviewPlaybackState {
  return {
    name: '',
    duration: 0,
    time: 0,
    mode: '',
  };
}
