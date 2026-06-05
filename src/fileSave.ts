interface SaveFilePickerAccept {
  [mimeType: string]: string[];
}

interface SaveFilePickerType {
  description: string;
  accept: SaveFilePickerAccept;
}

interface SaveFilePickerOptions {
  suggestedName: string;
  types: SaveFilePickerType[];
}

interface FileSystemWritableFileStream {
  write(data: Blob): Promise<void> | void;
  close(): Promise<void> | void;
}

interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}

type ShowSaveFilePicker = (options: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;

export type SaveBlobMethod = 'picker' | 'download' | 'cancelled';

export interface SaveBlobWithPickerOptions {
  suggestedName: string;
  mimeType: string;
  extension: string;
  description: string;
  createBlob: () => Blob | Promise<Blob>;
}

export interface SaveBlobResult {
  filename: string;
  method: SaveBlobMethod;
}

function normalizeFilename(name: string, extension: string): string {
  const cleanName = name.trim() || `animation${extension}`;
  return cleanName.toLowerCase().endsWith(extension.toLowerCase())
    ? cleanName
    : `${cleanName}${extension}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getSaveFilePicker(): ShowSaveFilePicker | null {
  const candidate = (globalThis.window as unknown as {
    showSaveFilePicker?: ShowSaveFilePicker;
  } | undefined)?.showSaveFilePicker;
  return typeof candidate === 'function' ? candidate : null;
}

export async function saveBlobWithPicker(options: SaveBlobWithPickerOptions): Promise<SaveBlobResult> {
  const filename = normalizeFilename(options.suggestedName, options.extension);
  const picker = getSaveFilePicker();

  if (picker) {
    let handle: FileSystemFileHandle;
    try {
      handle = await picker.call(window, {
        suggestedName: filename,
        types: [{
          description: options.description,
          accept: { [options.mimeType]: [options.extension] },
        }],
      });
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') {
        return { filename, method: 'cancelled' };
      }
      throw error;
    }

    const blob = await options.createBlob();
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { filename, method: 'picker' };
  }

  const blob = await options.createBlob();
  downloadBlob(blob, filename);
  return { filename, method: 'download' };
}
