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

import { convertFbxFileToJson } from './fbxToJsonConverter';

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

  // Click anywhere on the zone opens the file picker. Forwarding manually
  // (rather than nesting <input> inside a <label>) means the drop-zone
  // events fire reliably on the <div> without being intercepted by the
  // hidden file input.
  zone.addEventListener('click', () => input.click());
  // Keyboard accessibility: Enter / Space activates the zone like a button.
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });

  const handleFiles = async (files: FileList | null | undefined): Promise<void> => {
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
  input.addEventListener('change', () => void handleFiles(input.files));

  // Drag-and-drop path. Mirror standard drop-zone UX.
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    void handleFiles(e.dataTransfer?.files);
  });
}

// ── Bootstrap each tool defined in exports.html ─────────────────────────────

function init(): void {
  // Page-level dragover/drop prevention. Without these, dropping a file
  // OUTSIDE any drop-zone causes the browser to navigate to the file URL
  // (opening it in the current tab) — destroys the page state. Browsers
  // require BOTH dragover AND drop to call preventDefault to suppress the
  // default file-handling.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop',     (e) => e.preventDefault());

  const fbxZone   = document.getElementById('fbx-to-json-zone')   as HTMLDivElement   | null;
  const fbxInput  = document.getElementById('fbx-to-json-input')  as HTMLInputElement | null;
  const fbxStatus = document.getElementById('fbx-to-json-status') as HTMLDivElement   | null;
  if (fbxZone && fbxInput && fbxStatus) {
    wireFileTool({
      zone:    fbxZone,
      input:   fbxInput,
      status:  fbxStatus,
      label:   'FBX → JSON',
      convert: (file) => convertFbxFileToJson(file),
    });
  }
}

// `defer` not set on the <script> tag, but the script lives at the bottom
// of `exports.html` — DOM is already parsed by the time this runs.
init();
