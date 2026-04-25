import type { AnimationController } from './animationController';
import { formatLibraryName } from './ui';

type CleanupFn = () => void;

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function mountTransport(controller: AnimationController): CleanupFn {
  const bar      = document.getElementById('transport');
  const nameEl   = document.getElementById('tp-name');
  const prevBtn  = document.getElementById('tp-prev');
  const playBtn  = document.getElementById('tp-play');
  const nextBtn  = document.getElementById('tp-next');
  const timeline = document.getElementById('tp-timeline');
  const progress = document.getElementById('tp-progress');
  const timeEl   = document.getElementById('tp-time');
  if (!bar || !nameEl || !prevBtn || !playBtn || !nextBtn || !timeline || !progress || !timeEl) return () => {};

  const listenerAbort = new AbortController();
  const listenerOpts: AddEventListenerOptions = { signal: listenerAbort.signal };

  prevBtn.addEventListener('click', () => controller.prev(), listenerOpts);
  nextBtn.addEventListener('click', () => controller.next(), listenerOpts);
  playBtn.addEventListener('click', () => {
    controller.togglePaused();
    playBtn.textContent = controller.paused ? '▶' : '⏸';
  }, listenerOpts);

  const seekFromEvent = (ev: PointerEvent): void => {
    const dur = controller.currentDuration;
    if (dur <= 0) return;
    const rect = timeline.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    controller.seek(frac * dur);
  };
  timeline.addEventListener('pointerdown', (ev) => {
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    seekFromEvent(ev as PointerEvent);
  }, listenerOpts);
  timeline.addEventListener('pointermove', (ev) => {
    if ((ev as PointerEvent).pressure > 0 || (ev.buttons & 1)) seekFromEvent(ev as PointerEvent);
  }, listenerOpts);

  // Refresh UI 10× per second
  const intervalId = window.setInterval(() => {
    const hasActive = controller.hasBvhActive;
    bar.classList.toggle('empty', !hasActive);
    if (!hasActive) {
      nameEl.textContent   = '—';
      timeEl.textContent   = '0:00 / 0:00';
      (progress as HTMLElement).style.width = '0%';
      playBtn.textContent  = '▶';
      return;
    }
    const t    = controller.currentTime;
    const dur  = controller.currentDuration;
    const frac = dur > 0 ? Math.min(t / dur, 1) : 0;
    nameEl.textContent   = formatLibraryName(controller.currentName);
    timeEl.textContent   = `${formatTime(t)} / ${formatTime(dur)}`;
    (progress as HTMLElement).style.width = `${frac * 100}%`;
    playBtn.textContent  = controller.paused ? '▶' : '⏸';
  }, 100);

  return () => {
    listenerAbort.abort();
    clearInterval(intervalId);
  };
}
