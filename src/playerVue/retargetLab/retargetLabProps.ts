import type { VRM } from '@pixiv/three-vrm';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';
import type { QuaternionCorrection } from '../../retargetCorrections';

export interface RetargetLabProps {
  vrm: VRM;
  onImport: (
    file: File,
    manualMapping: ManualFbxBoneMapping,
    quaternionCorrections?: QuaternionCorrection[],
  ) => Promise<void>;
  onPreview?: (
    file: File,
    manualMapping: ManualFbxBoneMapping,
    quaternionCorrections: QuaternionCorrection[],
    corrected: boolean,
  ) => Promise<{ name: string; duration: number }>;
  onPreviewSeek?: (seconds: number) => void;
  onPreviewStop?: () => void;
}
