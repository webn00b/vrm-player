/**
 * Vue 3 + PrimeVue entry for the standalone /exports.html page.
 *
 * Mounted on the `#app` div in exports.html. The main player at `/`
 * stays vanilla TS for now — this is a pilot to see how Vue+PrimeVue
 * fit in the project before any wider migration.
 *
 * Theme: PrimeVue's Aura preset in dark mode (matches the player's
 * black background). `darkModeSelector: 'system'` honours the user's
 * OS preference, with a manual override via .my-app-dark class if
 * we want toggle support later.
 */

import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import Aura from '@primevue/themes/aura';

import App from './App.vue';

// PrimeVue 4 CSS isn't auto-imported with themes — we bring in the base
// utilities so component styles work out of the box.
import 'primeicons/primeicons.css';

const app = createApp(App);

app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      // 'system' = obey OS prefers-color-scheme. Could pin to 'none' +
      // class-based toggle if we add a theme switcher later.
      darkModeSelector: 'system',
      cssLayer: false,
    },
  },
});
app.use(ToastService);

app.mount('#app');
