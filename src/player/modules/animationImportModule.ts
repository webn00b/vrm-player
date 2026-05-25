/**
 * Owns animation import bridge setup for the player bootstrap.
 * Keeps animation file loading and queue registration out of main.ts.
 */
import type * as THREE from 'three';
import { isSupportedAnimationFile, loadAnimationFile } from '../../animationImport';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';
import type { ParsedBVH } from '../../bvhLoader';
import { applyQuaternionCorrectionsToClip, type QuaternionCorrection } from '../../retargetCorrections';
import { notify, setStatus } from '../../ui';
import { requirePlayback, requireVrm } from '../assertions';
import type { AnimationBridge, AnimationLoadResult, PlayerModule } from '../types';

export const animationImportModule: PlayerModule = {
  name: 'animation-import',
  setup(ctx) {
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const controller = playback.controller;
    if (!controller) throw new Error('Player playback controller is required before animation import runs');

    const bvhByIndex = new Map<number, ParsedBVH>();
    const names: string[] = [];
    const sourceFileByIndex = new Map<number, File>();

    const animation: AnimationBridge = {
      names,
      bvhByIndex,
      sourceFileByIndex,
      queue: null,
      reexportQueue: null,
      registerAndEnqueue(
        name: string,
        bvh: ParsedBVH | null,
        clip: THREE.AnimationClip,
        sourceFile?: File,
      ): number {
        controller.register(name, clip);
        const itemIdx = names.length;
        names.push(name);
        if (bvh) bvhByIndex.set(itemIdx, bvh);
        if (sourceFile) sourceFileByIndex.set(itemIdx, sourceFile);
        const queuePos = controller.queueLength;
        controller.addToQueue(itemIdx);
        animation.queue?.push(name, clip.duration);
        animation.reexportQueue?.push(name, clip.duration);
        return queuePos;
      },
      async loadAnimationIntoQueue(
        file: File,
        manualFbxMapping: ManualFbxBoneMapping = {},
        quaternionCorrections: QuaternionCorrection[] = [],
        options: { statusLabel?: string; toast?: boolean } = {},
      ): Promise<AnimationLoadResult> {
        const baseName = file.name;
        const shouldToast = options.toast ?? true;
        setStatus(options.statusLabel ?? `loading ${baseName}…`);
        try {
          const loaded = await loadAnimationFile(file, vrm, manualFbxMapping);
          const correctionReport = applyQuaternionCorrectionsToClip(loaded.clip, vrm, quaternionCorrections);
          if (correctionReport.affectedTracks > 0) {
            console.info(
              `[retarget-corrections] applied ${correctionReport.appliedCorrections} correction(s), ` +
              `${correctionReport.affectedTracks} track(s), ${correctionReport.affectedKeyframes} keyframe(s), ` +
              `sign flips normalized: ${correctionReport.signFlips}`,
            );
          }
          animation.registerAndEnqueue(loaded.name, loaded.parsedBvh, loaded.clip, file);
          setStatus(`▶ ${loaded.name}`);
          if (shouldToast) notify({ severity: 'success', summary: 'Animation added', detail: loaded.name });
          return { ok: true, fileName: baseName, name: loaded.name };
        } catch (e) {
          const msg = (e as Error).message;
          setStatus(`load failed: ${msg}`);
          if (shouldToast) notify({ severity: 'error', summary: 'Animation load failed', detail: msg, life: 4200 });
          return { ok: false, fileName: baseName, error: msg };
        }
      },
      async handleAnimationFile(
        file: File,
        manualFbxMapping: ManualFbxBoneMapping = {},
        quaternionCorrections: QuaternionCorrection[] = [],
      ): Promise<void> {
        await animation.loadAnimationIntoQueue(file, manualFbxMapping, quaternionCorrections);
      },
      async handleAnimationFiles(files: File[]): Promise<void> {
        const supported = files.filter((file) => isSupportedAnimationFile(file.name));
        const unsupported = files.filter((file) => !isSupportedAnimationFile(file.name));
        if (unsupported.length > 0) {
          const names = unsupported.slice(0, 3).map((file) => file.name).join(', ');
          const suffix = unsupported.length > 3 ? ` +${unsupported.length - 3} more` : '';
          setStatus(`skipped ${unsupported.length} unsupported file${unsupported.length === 1 ? '' : 's'}`);
          notify({
            severity: 'warn',
            summary: 'Unsupported animation file',
            detail: `Use .bvh, .vrma, .fbx, or motion .json. Skipped: ${names}${suffix}`,
            life: 5200,
          });
        }
        if (supported.length === 0) return;
        if (supported.length === 1) {
          await animation.handleAnimationFile(supported[0]);
          return;
        }

        notify({
          severity: 'info',
          summary: 'Loading animations',
          detail: `${supported.length} files`,
          life: 2200,
        });

        const results: AnimationLoadResult[] = [];
        for (const [index, file] of supported.entries()) {
          const result = await animation.loadAnimationIntoQueue(file, {}, [], {
            statusLabel: `loading ${index + 1}/${supported.length}: ${file.name}…`,
            toast: false,
          });
          results.push(result);
        }

        const loaded = results.filter((result) => result.ok);
        const failed = results.length - loaded.length;
        setStatus(`loaded ${loaded.length}/${supported.length} animations`);
        notify({
          severity: failed > 0 ? 'warn' : 'success',
          summary: failed > 0 ? 'Batch import finished with errors' : 'Animations added',
          detail: failed > 0
            ? `${loaded.length} loaded, ${failed} failed`
            : `${loaded.length} files loaded`,
          life: failed > 0 ? 5200 : 3000,
        });
      },
      async previewRetargetFile(
        file: File,
        manualFbxMapping: ManualFbxBoneMapping = {},
        quaternionCorrections: QuaternionCorrection[] = [],
        corrected = true,
      ): Promise<{ name: string; duration: number }> {
        const loaded = await loadAnimationFile(file, vrm, manualFbxMapping);
        if (corrected) {
          const correctionReport = applyQuaternionCorrectionsToClip(loaded.clip, vrm, quaternionCorrections);
          if (correctionReport.affectedTracks > 0) {
            console.info(
              `[retarget-preview] applied ${correctionReport.appliedCorrections} correction(s), ` +
              `${correctionReport.affectedTracks} track(s), ${correctionReport.affectedKeyframes} keyframe(s)`,
            );
          }
        }
        const label = `${loaded.name} ${corrected ? '(corrected preview)' : '(original preview)'}`;
        vrm.scene.visible = true;
        controller.playPreviewClip(label, loaded.clip);
        setStatus(`previewing ${label}`);
        return { name: label, duration: loaded.clip.duration };
      },
      openQueueItemInRetargetLab(queueIndex: number, navigate: boolean): boolean {
        const itemIdx = controller.getItemIndexAtQueuePos(queueIndex);
        const file = sourceFileByIndex.get(itemIdx);
        if (!file) {
          notify({
            severity: 'warn',
            summary: 'No source file for this clip',
            detail: 'Load or record the clip first, then open it in Retarget Lab.',
            life: 4200,
          });
          return false;
        }
        if (navigate) window.dispatchEvent(new CustomEvent('vrm-player:set-page', { detail: 'retarget' }));
        window.dispatchEvent(new CustomEvent<File>('vrm-player:retarget-file', { detail: file }));
        return true;
      },
    };

    ctx.animation = animation;
  },
};
