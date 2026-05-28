<script setup lang="ts">
/**
 * "Animation → JSON" converter card.
 *
 * Wraps PrimeVue's FileUpload component around the existing
 * animationFileToJson() converter. Multi-file support comes from
 * the underlying FileUpload — drop several files at once, get
 * one .json per input.
 */

import { ref, computed } from 'vue';
import Card from 'primevue/card';
import FileUpload, { type FileUploadUploaderEvent } from 'primevue/fileupload';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import Checkbox from 'primevue/checkbox';
import { useToast } from 'primevue/usetoast';

import {
  animationJsonToAgentOgiJson,
  animationFileToJson,
  downloadAgentOgiJson,
  downloadAnimationJson,
  SUPPORTED_INPUT_EXTENSIONS,
  type SourceFormat,
} from '../animationToJsonConverter';

const toast = useToast();

/** History of completed conversions, newest first. */
interface HistoryItem {
  source: string;
  output: string;
  format: SourceFormat;
  bones: number;
  tracks: number;
  durationSec: number;
  at: Date;
}
const history = ref<HistoryItem[]>([]);
const agentOgiOutputEnabled = ref(false);

/** Comma-separated accept attribute for the FileUpload — single source of
 *  truth lives in the converter module, we just reuse it. */
const acceptString = computed(() => SUPPORTED_INPUT_EXTENSIONS.join(','));

/** Convert one file → JSON → download → record in history. */
async function processFile(file: File): Promise<void> {
  try {
    const output = await animationFileToJson(file);
    const baseName = file.name.replace(/\.[a-z]+$/i, '');
    const filename = agentOgiOutputEnabled.value
      ? `${baseName}.agent_ogi.json`
      : `${baseName}.json`;
    if (agentOgiOutputEnabled.value) {
      downloadAgentOgiJson(animationJsonToAgentOgiJson(output), filename);
    } else {
      downloadAnimationJson(output, filename);
    }

    const totalTracks = output.animations.reduce((sum, a) => sum + a.tracks.length, 0);
    const totalDuration = output.animations.reduce((sum, a) => sum + a.duration, 0);
    history.value.unshift({
      source: file.name,
      output: filename,
      format: output.sourceFormat,
      bones: output.bones.length,
      tracks: totalTracks,
      durationSec: totalDuration,
      at: new Date(),
    });
    toast.add({
      severity: 'success',
      summary: 'Converted',
      detail: `${file.name} → ${filename}`,
      life: 3000,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    toast.add({
      severity: 'error',
      summary: `Failed: ${file.name}`,
      detail: message,
      life: 6000,
    });
  }
}

/** Custom-uploader handler — PrimeVue FileUpload invokes this instead of
 *  doing an HTTP upload. We process each selected file in turn. */
async function handleUpload(event: FileUploadUploaderEvent): Promise<void> {
  const files = Array.isArray(event.files) ? event.files : [event.files];
  for (const file of files) {
    if (!file) continue;
    await processFile(file);
  }
}

const formatColor = (f: SourceFormat): 'info' | 'success' | 'warn' | 'secondary' => {
  if (f === 'fbx')  return 'info';
  if (f === 'bvh')  return 'success';
  if (f === 'vrma') return 'warn';
  return 'secondary';  // glb / gltf
};
</script>

<template>
  <Card class="converter-card">
    <template #title>
      <span class="pi pi-arrow-right-arrow-left" style="margin-right:8px"></span>
      Animation → JSON
    </template>
    <template #subtitle>
      Extracts animation tracks into portable JSON. Preserves original bone
      names from the source — no retargeting.
      Supported: <code>.fbx</code> / <code>.bvh</code> / <code>.glb</code> /
      <code>.gltf</code> / <code>.vrma</code>.
    </template>
    <template #content>
      <FileUpload
        name="animation"
        custom-upload
        :multiple="true"
        :accept="acceptString"
        :max-file-size="200_000_000"
        :show-cancel-button="false"
        :show-upload-button="true"
        choose-label="Pick files"
        upload-label="Convert"
        @uploader="handleUpload"
      >
        <template #empty>
          <div class="empty-zone">
            <span class="pi pi-cloud-upload" style="font-size:2rem;opacity:.4"></span>
            <p>Drag &amp; drop animation files here</p>
            <p class="hint">or use "Pick files" above</p>
          </div>
        </template>
      </FileUpload>

      <label class="agent-export-toggle">
        <Checkbox
          v-model="agentOgiOutputEnabled"
          binary
          input-id="exports-agent-ogi-toggle"
          data-testid="exports-agent-ogi-toggle"
        />
        <span>Create agent_ogi_front JSON</span>
      </label>

      <div v-if="history.length > 0" class="history">
        <h3>Recent conversions</h3>
        <ul>
          <li v-for="(item, idx) in history" :key="idx">
            <Tag :value="item.format.toUpperCase()" :severity="formatColor(item.format)" />
            <span class="item-name" :title="item.source">{{ item.source }}</span>
            <span class="item-meta">
              {{ item.bones }} bones · {{ item.tracks }} tracks ·
              {{ item.durationSec.toFixed(2) }}s
            </span>
            <Button
              icon="pi pi-download"
              severity="secondary"
              text
              size="small"
              :label="item.output"
              @click="() => { /* file already downloaded — could re-trigger if we kept the blob */ }"
              disabled
              title="Already downloaded — re-pick the source file to redownload"
            />
          </li>
        </ul>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.converter-card {
  background: rgba(255, 255, 255, 0.02);
}
:deep(.p-card) {
  background: rgba(16, 16, 16, 0.92);
  color: #e6e6e6;
}
:deep(.p-fileupload) {
  color: #e6e6e6;
}
:deep(.p-fileupload-header),
:deep(.p-fileupload-content) {
  background: rgba(10, 10, 12, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}
:deep(.p-fileupload-content) {
  min-height: 224px;
}
:deep(.p-fileupload-file),
:deep(.p-fileupload-empty) {
  color: #e6e6e6;
}
.empty-zone {
  text-align: center;
  padding: 24px 12px;
  opacity: 0.7;
}
.empty-zone p {
  margin: 6px 0;
}
.empty-zone .hint {
  font-size: 11px;
  opacity: 0.6;
}
.agent-export-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 7px 10px;
  color: #e6e6e6;
  background: rgba(30, 188, 196, 0.12);
  border: 1px solid rgba(123, 225, 232, 0.18);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.history {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.history h3 {
  margin: 0 0 8px 0;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.55;
}
.history ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.history li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
}
.history .item-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.history .item-meta {
  font-size: 10px;
  opacity: 0.55;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
code {
  background: rgba(255, 255, 255, 0.05);
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 0.9em;
}
</style>
