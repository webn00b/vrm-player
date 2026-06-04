import { onUnmounted } from 'vue';

export function useTrackedTimers() {
  const activeTimers = new Set<number>();

  function trackInterval(fn: () => void, ms: number): number {
    const id = window.setInterval(fn, ms);
    activeTimers.add(id);
    return id;
  }

  function trackTimeout(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      activeTimers.delete(id);
      fn();
    }, ms);
    activeTimers.add(id);
    return id;
  }

  function clearTrackedTimer(id: number): void {
    if (!id) return;
    window.clearTimeout(id);
    window.clearInterval(id);
    activeTimers.delete(id);
  }

  function clearAllTimers(): void {
    for (const id of activeTimers) clearTrackedTimer(id);
    activeTimers.clear();
  }

  onUnmounted(clearAllTimers);

  return {
    trackInterval,
    trackTimeout,
    clearTrackedTimer,
    clearAllTimers,
  };
}
