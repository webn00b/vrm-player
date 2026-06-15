/**
 * Map raw capture/conversion errors to short, human-readable messages. The full
 * technical message still goes to the toast; this is the inline status text and
 * the toast summary, so the user sees "No body detected" instead of a truncated
 * stack-ish string.
 */
export interface FriendlyError {
  /** Short status-line text (with an emoji), e.g. "🙈 No body detected". */
  status: string;
  /** One-line explanation for the toast. */
  detail: string;
}

const RULES: Array<{ test: RegExp; status: string; detail: string }> = [
  {
    test: /permission|notallowed|denied/i,
    status: '🚫 Camera blocked',
    detail: 'Camera access was denied. Allow it in your browser’s site settings and try again.',
  },
  {
    test: /notfound|no.*(camera|device|videoinput)|requested device/i,
    status: '📷 No camera',
    detail: 'No camera was found. Connect one, or use the Video file source instead.',
  },
  {
    test: /0 frames|did not detect|no.*body|no.*pose|usable.*pose/i,
    status: '🙈 No body detected',
    detail: 'No person was detected in the video. Use a clip where the body is clearly visible.',
  },
  {
    test: /model|\.task|\.onnx|wasm|failed to (load|fetch)/i,
    status: '⚠️ Model load failed',
    detail: 'A pose model failed to load. Check your connection and reload the page.',
  },
  {
    test: /load video|decode|unsupported|format/i,
    status: '🎞️ Can’t read video',
    detail: 'This video couldn’t be read. Try an MP4/MOV/WebM file.',
  },
];

export function friendlyCaptureError(err: unknown): FriendlyError {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).trim();
  for (const rule of RULES) {
    if (rule.test.test(raw)) return { status: rule.status, detail: rule.detail };
  }
  // Fallback: a clean generic status, full message in the toast detail.
  return { status: '❌ Capture failed', detail: raw || 'Unknown error.' };
}
