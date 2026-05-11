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
  /** Drop-zone `<label>` element (also acts as click target). */
  zone:   HTMLLabelElement;
  /** Hidden file `<input>` inside the zone. */
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

  // Click on the label opens the file picker via the embedded <input>.
  // (Already the native label-for-input behaviour — no JS needed for that.)

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
  const fbxZone   = document.getElementById('fbx-to-json-zone')   as HTMLLabelElement | null;
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
