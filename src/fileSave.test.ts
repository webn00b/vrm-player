import { afterEach, expect, test, vi } from 'vitest';
import { saveBlobWithPicker } from './fileSave';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('saveBlobWithPicker writes to the browser save picker when available', async () => {
  const write = vi.fn();
  const close = vi.fn();
  const createWritable = vi.fn(async () => ({ write, close }));
  const showSaveFilePicker = vi.fn(async () => ({ createWritable }));
  const createBlob = vi.fn(() => new Blob(['glb'], { type: 'model/gltf-binary' }));
  vi.stubGlobal('window', { showSaveFilePicker });

  const result = await saveBlobWithPicker({
    suggestedName: 'wave_trim.glb',
    mimeType: 'model/gltf-binary',
    extension: '.glb',
    description: 'GLB animation',
    createBlob,
  });

  expect(showSaveFilePicker).toHaveBeenCalledWith({
    suggestedName: 'wave_trim.glb',
    types: [{
      description: 'GLB animation',
      accept: { 'model/gltf-binary': ['.glb'] },
    }],
  });
  expect(createBlob).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledWith(expect.any(Blob));
  expect(close).toHaveBeenCalledOnce();
  expect(result).toEqual({ filename: 'wave_trim.glb', method: 'picker' });
});
