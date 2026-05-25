export type CleanupFn = () => void;

export interface CleanupRegistry {
  add(cleanup: CleanupFn | undefined | null): void;
  dispose(): void;
}

export function createCleanupRegistry(): CleanupRegistry {
  const callbacks: CleanupFn[] = [];
  let disposed = false;

  return {
    add(cleanup) {
      if (!cleanup) return;
      if (disposed) {
        cleanup();
        return;
      }
      callbacks.push(cleanup);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (let i = callbacks.length - 1; i >= 0; i -= 1) {
        try {
          callbacks[i]();
        } catch (error) {
          errors.push(error);
        }
      }
      callbacks.length = 0;
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Player cleanup failed');
      }
    },
  };
}
