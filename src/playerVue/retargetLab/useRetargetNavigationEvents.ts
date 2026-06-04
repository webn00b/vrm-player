import { onMounted, onUnmounted } from 'vue';
import type { ToastServiceMethods } from 'primevue/toastservice';
import type { SourceOrigin } from './retargetClipWorkflowModel';

interface UseRetargetNavigationEventsOptions {
  analyze: (file: File, origin?: SourceOrigin) => Promise<void>;
  toast: ToastServiceMethods;
}

export function useRetargetNavigationEvents(options: UseRetargetNavigationEventsOptions) {
  function onRetargetFile(event: Event): void {
    const file = (event as CustomEvent<File>).detail;
    if (!file) return;
    void options.analyze(file, 'player');
    options.toast.add({
      severity: 'info',
      summary: 'Opened from Player',
      detail: file.name,
      life: 2200,
    });
  }

  function goBackToPlayer(): void {
    window.dispatchEvent(new CustomEvent('vrm-player:set-page', { detail: 'player' }));
  }

  onMounted(() => {
    window.addEventListener('vrm-player:retarget-file', onRetargetFile);
  });

  onUnmounted(() => {
    window.removeEventListener('vrm-player:retarget-file', onRetargetFile);
  });

  return {
    goBackToPlayer,
  };
}
