import { describe, it, expect } from 'vitest';
import { friendlyCaptureError } from './captureErrors';

describe('friendlyCaptureError', () => {
  it('maps camera permission denial', () => {
    expect(friendlyCaptureError(new Error('NotAllowedError: Permission denied')).status)
      .toBe('🚫 Camera blocked');
  });

  it('maps missing camera device', () => {
    expect(friendlyCaptureError(new Error('Requested device not found')).status).toBe('📷 No camera');
  });

  it('maps no-body-detected (0 frames)', () => {
    expect(friendlyCaptureError(new Error('Downloaded BVH has 0 frames')).status)
      .toBe('🙈 No body detected');
  });

  it('maps model/wasm load failures', () => {
    expect(friendlyCaptureError(new Error('failed to fetch holistic_landmarker.task')).status)
      .toBe('⚠️ Model load failed');
  });

  it('falls back to a clean generic status, keeping the raw detail', () => {
    const f = friendlyCaptureError(new Error('something weird'));
    expect(f.status).toBe('❌ Capture failed');
    expect(f.detail).toBe('something weird');
  });

  it('handles non-Error input', () => {
    expect(friendlyCaptureError('plain string').detail).toBe('plain string');
    expect(friendlyCaptureError(null).detail).toBe('Unknown error.');
  });
});
