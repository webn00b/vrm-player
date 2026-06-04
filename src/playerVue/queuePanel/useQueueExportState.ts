import { onUnmounted, ref, type Ref } from 'vue';
import type { ExportCallback, ExportKind, QueueItem, RowExportState } from './queuePanelTypes';

export function useQueueExportState(items: Ref<QueueItem[]>) {
  const exportStates = ref<Record<number, RowExportState | undefined>>({});
  const exportResetTimers = new Map<number, number>();

  function clearExportState(itemId: number): void {
    const timer = exportResetTimers.get(itemId);
    if (timer) window.clearTimeout(timer);
    exportResetTimers.delete(itemId);
    delete exportStates.value[itemId];
  }

  function clearAllExportStates(): void {
    for (const id of exportResetTimers.keys()) clearExportState(id);
  }

  function scheduleExportStateReset(itemId: number, delay: number): void {
    const timer = exportResetTimers.get(itemId);
    if (timer) window.clearTimeout(timer);
    exportResetTimers.set(itemId, window.setTimeout(() => {
      clearExportState(itemId);
    }, delay));
  }

  function rowExportState(qi: number): RowExportState | null {
    const item = items.value[qi];
    return item ? exportStates.value[item.id] ?? null : null;
  }

  function isExporting(qi: number, kind?: ExportKind): boolean {
    const state = rowExportState(qi);
    return state?.phase === 'loading' && (!kind || state.kind === kind);
  }

  async function runExport(qi: number, kind: ExportKind, callback?: ExportCallback): Promise<void> {
    if (!callback || isExporting(qi)) return;
    const item = items.value[qi];
    if (!item) return;
    clearExportState(item.id);
    exportStates.value[item.id] = { kind, phase: 'loading' };
    try {
      await Promise.resolve(callback(qi));
      exportStates.value[item.id] = { kind, phase: 'done' };
      scheduleExportStateReset(item.id, 2600);
    } catch {
      exportStates.value[item.id] = { kind, phase: 'error' };
      scheduleExportStateReset(item.id, 4200);
    }
  }

  onUnmounted(clearAllExportStates);

  return {
    clearExportState,
    clearAllExportStates,
    rowExportState,
    runExport,
  };
}
