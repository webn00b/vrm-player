/**
 * Shared PrimeVue installer for Vue islands mounted into the main player.
 *
 * Each mini-Vue-app on the page (Queue, future Debug panels, etc.) calls
 * `installPrimeVueOn(app)` before mounting. Centralised so theme presets,
 * dark-mode behaviour, and required services stay in sync across islands.
 */

import type { App } from 'vue';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import Aura from '@primevue/themes/aura';

import 'primeicons/primeicons.css';

export function installPrimeVueOn(app: App): App {
  app.use(PrimeVue, {
    theme: {
      preset: Aura,
      options: {
        // Honour OS prefers-color-scheme; matches the player's permanent
        // dark background. Manual switcher could override later.
        darkModeSelector: 'system',
        cssLayer: false,
      },
    },
  });
  app.use(ToastService);
  return app;
}
