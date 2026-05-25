/**
 * Owns Vue shell setup for the player bootstrap.
 * Keeps global shell mounting out of main.ts and cleans up everything it registers.
 */
import { createApp } from 'vue';
import PlayerShell from '../../playerVue/PlayerShell.vue';
import { installPrimeVueOn } from '../../playerVue/plugin';
import type { PlayerModule } from '../types';

export const shellModule: PlayerModule = {
  name: 'shell',
  setup(ctx) {
    const shellApp = createApp(PlayerShell);
    installPrimeVueOn(shellApp);
    shellApp.mount(ctx.roots.shell);
    ctx.shellApp = shellApp;

    return () => {
      if (ctx.shellApp === shellApp) ctx.shellApp = undefined;
      shellApp.unmount();
    };
  },
};
