/**
 * Standalone "File Converters" page entry point.
 *
 * Lives at `/exports.html` separate from the main VRM player. Intentionally
 * NO imports of three.js, @pixiv/three-vrm, mocap modules, or anything that
 * would drag in the player's heavy 3D bundle. Just the conversion utilities.
 *
 * Current tools:
 *   - FBX → JSON (reuses src/fbxToJsonConverter)
 *
 * Adding a new tool: drop a card into `exports.html` with its own
 * `.drop-zone` + `<input>` + `.status` divs, then wire it here with
 * `wireFileTool()` — same pattern, different converter callback.
 */

import { convertAnimationFileToJson } from './animationToJsonConverter';

// Diagnostic marker so the console shows the script ran. If you don't see
// this line on /exports.html, the bundle isn't being executed at all
// (caching / wrong page / build issue) — none of the handlers below will fire.
console.log('[exports] exportsApp.ts loaded at', new Date().toISOString());

interface FileTool {
  /** Drop-zone `<div>` element (click forwards to the input). */
  zone:   HTMLDivElement;
  /** Sibling file `<input>`, hidden via CSS. */
  input:  HTMLInputElement;
  /** Status line below the zone. */
  status: HTMLDivElement;
  /** Pretty name for status messages. */
  label:  string;
  /** Per-file conversion callback. Resolves with the saved filename. */
  convert: (file: File) => Promise<string>;
}

function setStatus(el: HTMLDivElement, msg: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  el.textContent = msg;
  el.classList.toggle('ok',    kind === 'ok');
  el.classList.toggle('error', kind === 'error');
}

function wireFileTool(tool: FileTool): void {
  const { zone, input, status, label, convert } = tool;
  console.log(`[exports] wireFileTool: ${label}`, { zone, input, status });

  // Click anywhere on the zone opens the file picker. Forwarding manually
  // (rather than nesting <input> inside a <label>) means the drop-zone
  // events fire reliably on the <div> without being intercepted by the
  // hidden file input.
  zone.addEventListener('click', () => {
    console.log(`[exports] zone click → opening file picker`);
    input.click();
  });
  // Keyboard accessibility: Enter / Space activates the zone like a button.
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });

  const handleFiles = async (files: FileList | null | undefined): Promise<void> => {
    console.log(`[exports] handleFiles called`, { count: files?.length ?? 0, files });
    const file = files?.[0];
    if (!file) return;
    setStatus(status, `${label}: converting ${file.name}…`, 'info');
    try {
      const filename = await convert(file);
      setStatus(status, `${label}: saved ${filename}`, 'ok');
    } catch (e) {
      setStatus(status, `${label}: ${(e as Error).message}`, 'error');
    } finally {
      // Reset input so re-picking the same file fires `change` again.
      input.value = '';
    }
  };

  // File picker path.
  input.addEventListener('change', () => {
    console.log(`[exports] input change`, { files: input.files });
    void handleFiles(input.files);
  });

  // Drag-and-drop path. Throttled dragover log to avoid spam (~once per
  // 250ms is enough to confirm events are firing without flooding the
  // console).
  let lastDragoverLog = 0;
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    zone.classList.add('drag-over');
    const now = performance.now();
    if (now - lastDragoverLog > 250) {
      lastDragoverLog = now;
      console.log(`[exports] dragover on zone`, {
        types: Array.from(e.dataTransfer?.types ?? []),
      });
    }
  });
  zone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    console.log(`[exports] dragenter on zone`);
  });
  zone.addEventListener('dragleave', () => {
    console.log(`[exports] dragleave on zone`);
    zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('drag-over');
    console.log(`[exports] drop on zone`, {
      files: e.dataTransfer?.files,
      types: Array.from(e.dataTransfer?.types ?? []),
    });
    void handleFiles(e.dataTransfer?.files);
  });
}

// ── Bootstrap each tool defined in exports.html ─────────────────────────────

function init(): void {
  console.log('[exports] init() running, DOM state:', document.readyState);
  // Page-level dragover/drop prevention. Without these, dropping a file
  // OUTSIDE any drop-zone causes the browser to navigate to the file URL
  // (opening it in the current tab) — destroys the page state. Browsers
  // require BOTH dragover AND drop to call preventDefault to suppress the
  // default file-handling.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop',     (e) => e.preventDefault());

  const zone   = document.getElementById('anim-to-json-zone')   as HTMLDivElement   | null;
  const input  = document.getElementById('anim-to-json-input')  as HTMLInputElement | null;
  const status = document.getElementById('anim-to-json-status') as HTMLDivElement   | null;
  console.log('[exports] looking up DOM elements:', {
    zone:   !!zone, input: !!input, status: !!status,
  });
  if (zone && input && status) {
    wireFileTool({
      zone, input, status,
      label:   'Animation → JSON',
      convert: (file) => convertAnimationFileToJson(file),
    });
    console.log('[exports] Animation → JSON tool wired ✓');
  } else {
    console.error('[exports] FAILED to find DOM elements — page HTML mismatch?');
  }
}

// Be defensive about timing. `<script type="module">` is implicitly deferred
// in modern browsers, so by the time this module evaluates the DOM should
// be ready. But if exports.html ever moves the script to <head> or the
// browser has some quirk, run after DOMContentLoaded just in case.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
