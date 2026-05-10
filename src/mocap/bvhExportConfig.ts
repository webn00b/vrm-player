/**
 * Shared runtime config for BVH export — currently a single
 * `systemAnimatorCompat` toggle that switches the recorder between our
 * default VRM-canonical format and the format SystemAnimatorOnline / XR
 * Animator's BVH file-writer produces, so the resulting file plays back
 * correctly on those third-party VRM players.
 *
 * Read at recorder-construction time. To change behaviour for an in-flight
 * mocap session call `MocapController.setSystemAnimatorCompat(v)` which
 * tears down + rebuilds the live/grab recorders.
 */

let _saCompat = false;
let _flipBody180Y = false;

export const bvhExportConfig = {
  get systemAnimatorCompat(): boolean {
    return _saCompat;
  },
  setSystemAnimatorCompat(v: boolean): void {
    _saCompat = v;
  },
  get flipBody180Y(): boolean {
    return _flipBody180Y;
  },
  setFlipBody180Y(v: boolean): void {
    _flipBody180Y = v;
  },
};
