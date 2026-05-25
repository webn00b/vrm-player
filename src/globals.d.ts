import type { ToolingSystems } from './playerSystems';

/**
 * Ambient global types for dev-tool hooks that we attach to `window`.
 *
 * Keep this file small — every entry here is a runtime escape hatch
 * exposed for console debugging. None of these are part of the public
 * UI surface; they exist so a developer can poke at the running app
 * from DevTools.
 */
declare global {
  interface Window {
    /**
     * Logs the full performer + avatar skeleton comparison.
     * Attached by CalibrationBlock while it's mounted; removed on unmount.
     * Same function the "🔍 Dump to console" button in the calibration
     * tuning fold invokes.
     */
    dumpSkeleton?: () => void;
    __skelLog?: ToolingSystems['skeletonLogger'];
    __motionTrace?: ToolingSystems['motionTraceRecorder'];
  }
}

export {};
