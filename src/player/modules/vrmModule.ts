/**
 * Owns VRM model loading for the player bootstrap.
 * Keeps default model resolution out of main.ts and cleans up everything it registers.
 */
import { loadVRM } from '../../vrmLoader';
import { notify, setStatus } from '../../ui';
import { requireScene } from '../assertions';
import type { PlayerContext, PlayerModule } from '../types';

async function resolveVrmUrl(ctx: PlayerContext): Promise<string> {
  if (ctx.options.selectedVrmUrl) return ctx.options.selectedVrmUrl;
  const res = await fetch('/models/index.json', { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(
      `models/index.json not found (HTTP ${res.status}). ` +
      `Add a JSON array of .vrm filenames to public/models/index.json ` +
      `and place the .vrm files in public/models/ locally / ` +
      `/var/www/<site>/models/ on the server.`,
    );
  }
  const list = await res.json() as string[];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('models/index.json is empty — add at least one .vrm filename');
  }
  const sorted = [...list].sort();
  return `/models/${sorted[0]}`;
}

export const vrmModule: PlayerModule = {
  name: 'vrm',
  async setup(ctx) {
    const scene = requireScene(ctx);

    setStatus('loading VRM...');
    const vrm = await loadVRM(await resolveVrmUrl(ctx));
    if (ctx.options.selectedVrmName) {
      notify({ severity: 'success', summary: 'VRM loaded', detail: ctx.options.selectedVrmName });
    }
    // NOTE: mirror effect for mocap is applied at the landmark level in
    // DirectPoseApplier (_mirrorX flag) - do not scale the scene negatively,
    // that breaks the direct-math's getWorldQuaternion calls on parent bones.
    scene.scene.add(vrm.scene);
    ctx.vrm = vrm;

    return () => {
      if (ctx.vrm === vrm) ctx.vrm = undefined;
      vrm.scene.parent?.remove(vrm.scene);
    };
  },
};
