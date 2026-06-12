#!/usr/bin/env node
/**
 * One-time setup for MotionBERT 3D lifting:
 *   - copies onnxruntime-web wasm artifacts into public/ort/
 *   - downloads the MotionBERT ONNX model (~170MB) into public/models/
 *
 *   node tools/setup-lifter.mjs
 *
 * Both directories are gitignored. Without them the app still works —
 * the lifter detects the missing model and the pipeline falls back to
 * plain MediaPipe world landmarks.
 */
import { copyFileSync, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ortDist = join(root, 'node_modules/onnxruntime-web/dist');
const ortOut = join(root, 'public/ort');
const modelOut = join(root, 'public/models/motionbert_3d_243.onnx');
const MODEL_URL = 'https://huggingface.co/bukuroo/MotionBERT-3d-ONNX/resolve/main/motionbert_3d_243.onnx';
const MODEL_MIN_BYTES = 150_000_000;

mkdirSync(ortOut, { recursive: true });
mkdirSync(dirname(modelOut), { recursive: true });

// wasm + loader pairs for the plain and jsep (webgpu) execution providers.
const ARTIFACTS = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];
for (const name of ARTIFACTS) {
  copyFileSync(join(ortDist, name), join(ortOut, name));
  console.log(`copied public/ort/${name}`);
}

if (existsSync(modelOut) && statSync(modelOut).size > MODEL_MIN_BYTES) {
  console.log(`model already present: ${modelOut}`);
} else {
  console.log(`downloading MotionBERT model (~170MB) → ${modelOut}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(modelOut));
  const size = statSync(modelOut).size;
  if (size < MODEL_MIN_BYTES) throw new Error(`model truncated (${size} bytes)`);
  console.log(`model downloaded (${(size / 1e6).toFixed(0)}MB)`);
}
console.log('lifter setup complete');
