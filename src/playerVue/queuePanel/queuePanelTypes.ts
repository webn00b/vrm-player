import type { QueueLoopMode } from '../../animationController';

export interface QueueItem {
  rawName: string;
  duration: number;
  id: number;
}

export type QueuePanelMode = 'full' | 'exportsOnly';
export type QueuePanelTab = 'queue' | 'exports';
export type ExportKind = 'bvh' | 'glb' | 'vrma' | 'agent';
export type ExportPhase = 'loading' | 'done' | 'error';
export type ExportCallback = (queueIndex: number) => void | Promise<unknown>;

export interface RowExportState {
  kind: ExportKind;
  phase: ExportPhase;
}

export interface QueuePanelProps {
  mode?: QueuePanelMode;
  onJump?: (queueIndex: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onRemove?: (queueIndex: number) => void;
  onClear?: () => void;
  onDuplicate?: (queueIndex: number) => void;
  onRetarget?: (queueIndex: number) => void;
  loopMode?: QueueLoopMode;
  onLoopModeChange?: (mode: QueueLoopMode) => void;
  onExportVrma?: ExportCallback;
  onExportBvh?: ExportCallback;
  onExportGlb?: ExportCallback;
  onExportAgentOgi?: ExportCallback;
  onRename?: (queueIndex: number, newDisplayName: string) => void;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
