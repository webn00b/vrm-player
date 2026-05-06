import type { BoneValidator } from './validation/boneValidator';
import type { SkeletonVisualizer } from './skeletonVisualizer';
import type { BoneDragController } from './boneDragController';
import type { SkeletonLogger } from './diagnostics/skeletonLogger';
import type { MocapDebugRecorder } from './mocap/mocapDebugRecorder';
import type { MocapController } from './mocap/mocapController';
import type { AnimationController } from './animationController';

export interface DebugPanelToolsDeps {
  root: HTMLElement;
  validator: BoneValidator;
  skelViz: SkeletonVisualizer;
  boneDrag: BoneDragController;
  skeletonLogger: SkeletonLogger;
  dbgRecorder: MocapDebugRecorder;
  mocap: MocapController;
  getController: () => AnimationController | null;
  setModelVisible: (v: boolean) => void;
  rememberInterval: (fn: () => void, ms: number) => number;
}

/**
 * Wire the bottom-of-panel "tooling" rows: anatomical-ROM clamp, compact
 * per-clip skeleton diagnostic logger, model/skeleton visibility toggles,
 * in-scene rotation gizmo (bone drag), and the mocap debug recorder.
 *
 * Each section is independent — they share no internal state — but they
 * historically lived together at the tail of mountDebugPanel because they
 * all hang off the main tab and write to top-level systems (validator,
 * skelViz, boneDrag, etc) rather than the mocap pipeline.
 */
export function wireDebugPanelTools(deps: DebugPanelToolsDeps): void {
  wireValidation(deps);
  wireSkeletonLogger(deps);
  const skelToggleInfo = wireSkeletonToggles(deps);
  wireBoneDrag(deps, skelToggleInfo);
  wireDebugRecorder(deps);
}

// ── Validation (anatomical ROM clamp) ─────────────────────────────────────
function wireValidation({ root, validator, rememberInterval }: DebugPanelToolsDeps): void {
  const valToggle = root.querySelector<HTMLButtonElement>('#val-toggle')!;
  const valStat   = root.querySelector<HTMLElement>('#val-stat')!;
  const valWorst  = root.querySelector<HTMLElement>('#val-worst')!;
  const valDump   = root.querySelector<HTMLButtonElement>('#val-dump')!;

  valToggle.addEventListener('click', () => {
    const on = !validator.enabled;
    validator.setEnabled(on);
    valToggle.textContent = on ? 'ON' : 'OFF';
    valToggle.classList.toggle('off', !on);
  });

  valDump.addEventListener('click', () => {
    console.log('[validator] default bone constraints:', validator.getConstraints());
  });

  rememberInterval(() => {
    const s = validator.getStats();
    valStat.textContent = `clamped/frame: ${s.clampedThisFrame}`;
    if (s.worstBone) {
      const deg = (s.worstDelta * 180 / Math.PI).toFixed(1);
      valWorst.textContent = `worst: ${s.worstBone} +${deg}°`;
    } else {
      valWorst.textContent = 'worst: —';
    }
  }, 200);
}

// ── Skeleton logger (compact per-clip diagnostic) ─────────────────────────
function wireSkeletonLogger({
  root, skeletonLogger, mocap, getController, rememberInterval,
}: DebugPanelToolsDeps): void {
  const skelLogBtn  = root.querySelector<HTMLButtonElement>('#skel-log-btn')!;
  const skelLogDl   = root.querySelector<HTMLButtonElement>('#skel-log-dl')!;
  const skelLogStat = root.querySelector<HTMLElement>('#skel-log-stat')!;

  // Pick a label for the digest header reflecting what was driving the avatar
  // when the recording started — helps when comparing digests across runs.
  const inferLabel = (): string => {
    if (mocap.state !== 'off') return 'mocap';
    const c = getController();
    if (c && c.hasBvhActive) return 'clip';
    return 'idle';
  };

  skelLogBtn.addEventListener('click', () => {
    if (skeletonLogger.active) {
      const digest = skeletonLogger.stop();
      console.log(digest);
      skelLogBtn.textContent = '⏺ Rec';
      skelLogBtn.classList.add('off');
      skelLogStat.textContent = `${skeletonLogger.frameCount}fr · digest in console`;
    } else {
      skeletonLogger.start(inferLabel());
      skelLogBtn.textContent = '⏹ Stop';
      skelLogBtn.classList.remove('off');
      skelLogStat.textContent = 'recording…';
    }
  });

  skelLogDl.addEventListener('click', () => {
    if (skeletonLogger.frameCount === 0) {
      skelLogStat.textContent = 'no recording yet';
      return;
    }
    skeletonLogger.download(`skel_log_${Date.now()}.txt`);
  });

  rememberInterval(() => {
    if (skeletonLogger.active) {
      skelLogStat.textContent = `${skeletonLogger.frameCount}fr · recording…`;
    }
  }, 250);
}

// ── Skeleton / model visibility toggles ───────────────────────────────────
interface SkelToggleHandles {
  /** Re-used by bone-drag toggle to auto-enable the skeleton overlay. */
  forceSkeletonOn(): void;
}

function wireSkeletonToggles({
  root, skelViz, setModelVisible,
}: DebugPanelToolsDeps): SkelToggleHandles {
  const modelToggle = root.querySelector<HTMLButtonElement>('#model-toggle')!;
  const skelToggle  = root.querySelector<HTMLButtonElement>('#skel-toggle')!;
  const skelBody    = root.querySelector<HTMLButtonElement>('#skel-body')!;
  const skelFingers = root.querySelector<HTMLButtonElement>('#skel-fingers')!;
  const skelOptions = root.querySelector<HTMLElement>('#skel-options')!;

  // Default debug view: skeleton on, avatar mesh opt-in via the model toggle.
  setModelVisible(false);
  skelViz.setVisible(true);

  modelToggle.addEventListener('click', () => {
    const on = modelToggle.textContent === 'OFF';
    setModelVisible(on);
    modelToggle.textContent = on ? 'ON' : 'OFF';
    modelToggle.classList.toggle('off', !on);
  });

  skelToggle.addEventListener('click', () => {
    const on = !skelViz.visible;
    skelViz.setVisible(on);
    skelToggle.textContent = on ? 'ON' : 'OFF';
    skelToggle.classList.toggle('off', !on);
    skelOptions.style.display = on ? 'flex' : 'none';
  });

  skelBody.addEventListener('click', () => {
    const on = !skelViz.showBody;
    skelViz.setShowBody(on);
    skelBody.textContent = on ? 'ON' : 'OFF';
    skelBody.classList.toggle('off', !on);
  });

  skelFingers.addEventListener('click', () => {
    const on = !skelViz.showFingers;
    skelViz.setShowFingers(on);
    skelFingers.textContent = on ? 'ON' : 'OFF';
    skelFingers.classList.toggle('off', !on);
  });

  return {
    forceSkeletonOn: () => {
      if (skelViz.visible) return;
      skelViz.setVisible(true);
      skelToggle.textContent = 'ON';
      skelToggle.classList.remove('off');
      skelOptions.style.display = 'flex';
    },
  };
}

// ── Bone drag (in-scene rotation gizmo) ───────────────────────────────────
function wireBoneDrag(
  { root, boneDrag }: DebugPanelToolsDeps,
  skelHandles: SkelToggleHandles,
): void {
  const dragToggle = root.querySelector<HTMLButtonElement>('#bone-drag-toggle')!;
  const dragReset  = root.querySelector<HTMLButtonElement>('#bone-drag-reset')!;
  dragToggle.addEventListener('click', () => {
    const on = !boneDrag.enabled;
    boneDrag.setEnabled(on);
    dragToggle.textContent = on ? 'ON' : 'OFF';
    dragToggle.classList.toggle('off', !on);
    // Auto-show skeleton when enabling — there's nothing to grab otherwise.
    if (on) skelHandles.forceSkeletonOn();
  });
  dragReset.addEventListener('click', () => {
    boneDrag.resetAll();
  });
}

// ── Debug recorder (mocap landmark capture) ───────────────────────────────
function wireDebugRecorder({
  root, dbgRecorder, rememberInterval,
}: DebugPanelToolsDeps): void {
  const dbgRecBtn    = root.querySelector<HTMLButtonElement>('#dbgrec-btn')!;
  const dbgRecFrames = root.querySelector<HTMLElement>('#dbgrec-frames')!;

  dbgRecBtn.addEventListener('click', () => {
    if (dbgRecorder.active) {
      dbgRecorder.stop();
      dbgRecBtn.textContent = '⏺ Rec';
      dbgRecBtn.classList.add('off');
    } else {
      dbgRecorder.start();
      dbgRecBtn.textContent = '⏹ Stop';
      dbgRecBtn.classList.remove('off');
    }
  });

  rememberInterval(() => {
    if (dbgRecorder.active) {
      dbgRecFrames.textContent = `${dbgRecorder.frameCount}fr`;
    } else {
      dbgRecFrames.textContent = dbgRecorder.frameCount > 0
        ? `${dbgRecorder.frameCount}fr saved`
        : '';
    }
  }, 200);
}
