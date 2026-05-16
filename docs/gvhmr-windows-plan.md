# GVHMR Windows/NVIDIA Offline Mocap Plan

This plan is for running GVHMR locally on a Windows machine with an NVIDIA GPU,
then importing the result into `vrm-player` through the `.gvhmr.json` offline
motion importer.

## Goal

```text
ted1.mp4
  -> local GVHMR inference on Windows/NVIDIA
  -> GVHMR result file
  -> vrm-player converter
  -> ted1.gvhmr.json
  -> vrm-player animation queue
```

No external video API is required. You will download model/code assets once,
but the video itself stays local.

## Hardware And Software Assumptions

Recommended:

- Windows 10/11
- NVIDIA GPU with CUDA support
- Recent NVIDIA driver
- 8 GB+ VRAM preferred
- 30 GB+ free disk
- Conda / Miniconda / Mambaforge
- Git

GVHMR is CUDA-oriented. It is not a good fit for Apple Silicon/MPS without
patching.

## Folder Layout

Use a short path without spaces:

```powershell
C:\ai\gvhmr
C:\ai\vrm-player
C:\ai\data\ted1.mp4
```

On the Mac/source machine, copy these files to Windows:

```text
/Users/fedor/Downloads/ted1.mp4
/Users/fedor/projects/personal/vrm-player/tools/offline_mocap/convert_wham_gvhmr.py
```

Or clone/pull the `codex/offline-wham-gvhmr-mvp` branch on Windows.

## 1. Install Base Tools

Install:

- NVIDIA driver: https://www.nvidia.com/Download/index.aspx
- Miniconda: https://docs.conda.io/en/latest/miniconda.html
- Git: https://git-scm.com/download/win

Open **Anaconda Prompt** or **PowerShell with conda initialized**.

Check GPU:

```powershell
nvidia-smi
```

You should see your GPU and driver version. If `nvidia-smi` is missing, fix the
driver before continuing.

## 2. Clone GVHMR

```powershell
mkdir C:\ai
cd C:\ai
git clone https://github.com/zju3dv/GVHMR.git gvhmr
cd C:\ai\gvhmr
```

Read the upstream install doc too:

```text
https://github.com/zju3dv/GVHMR/blob/main/docs/INSTALL.md
```

## 3. Create GVHMR Conda Env

Start with the upstream environment. The exact dependency versions may change,
so prefer the repo docs if they differ.

Typical shape:

```powershell
conda create -n gvhmr python=3.10 -y
conda activate gvhmr
```

Install PyTorch CUDA build. GVHMR docs currently target CUDA 12.1 / torch 2.3.0:

```powershell
pip install torch==2.3.0 torchvision==0.18.0 torchaudio==2.3.0 --index-url https://download.pytorch.org/whl/cu121
```

Check CUDA from Python:

```powershell
python - << "PY"
import torch
print("torch", torch.__version__)
print("cuda", torch.cuda.is_available())
print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NO CUDA")
PY
```

Expected:

```text
cuda True
<your NVIDIA GPU>
```

Then install GVHMR requirements. Use upstream instructions first. Common form:

```powershell
pip install -r requirements.txt
```

If the upstream docs mention `pytorch3d`, install the exact wheel they specify.
This is the dependency most likely to break if CUDA/Python/Torch versions drift.

## 4. Download GVHMR Checkpoints

Follow the official checkpoint instructions from GVHMR.

Usually this creates a folder under the GVHMR repo such as:

```text
C:\ai\gvhmr\inputs\checkpoints
```

or similar. The exact expected path is defined by GVHMR's config/demo code.

After downloading, search for checkpoint files:

```powershell
dir C:\ai\gvhmr -Recurse -Include *.ckpt,*.pth,*.pt
```

Do not move files randomly unless the upstream install doc says to. GVHMR config
paths are often hardcoded or config-driven.

## 5. Download SMPL / SMPLX Body Models

This is required for local human mesh/body model recovery.

You usually need to register and download from:

- SMPL: https://smpl.is.tue.mpg.de/
- SMPL-X: https://smpl-x.is.tue.mpg.de/

After download, place files where GVHMR expects them. The exact path may vary,
but typical projects expect something like:

```text
C:\ai\gvhmr\inputs\body_models\smpl
C:\ai\gvhmr\inputs\body_models\smplx
```

Expected files often include names like:

```text
SMPL_NEUTRAL.pkl
SMPL_MALE.pkl
SMPL_FEMALE.pkl
SMPLX_NEUTRAL.npz
```

Use the names and folders required by GVHMR's own docs/config. These files are
licensed assets; do not commit them to this repository.

## 6. Run GVHMR On The Video

Copy the video:

```powershell
mkdir C:\ai\data
copy "C:\Users\<you>\Downloads\ted1.mp4" C:\ai\data\ted1.mp4
```

From the GVHMR repo:

```powershell
cd C:\ai\gvhmr
conda activate gvhmr
```

Run the demo/inference. The upstream command may look like:

```powershell
python tools\demo\demo.py --video C:\ai\data\ted1.mp4 -s
```

If the command differs, use the command from GVHMR's current README/docs.

After completion, find result files:

```powershell
dir C:\ai\gvhmr -Recurse -Include *.pt,*.pth,*.pkl,*.npz,*.json
```

Look for files created around the run time in output/demo/result folders.

## 7. Convert GVHMR Result To vrm-player JSON

Clone or copy `vrm-player` on Windows:

```powershell
cd C:\ai
git clone <your-vrm-player-repo-url> vrm-player
cd C:\ai\vrm-player
git switch codex/offline-wham-gvhmr-mvp
```

If the branch is only local on the Mac, copy this script manually:

```text
tools\offline_mocap\convert_wham_gvhmr.py
```

Run the converter with the GVHMR result file:

```powershell
conda activate gvhmr
python tools\offline_mocap\convert_wham_gvhmr.py C:\ai\gvhmr\<path-to-result-file>.pt --source gvhmr --fps 30 -o C:\ai\data\ted1.gvhmr.json
```

If it says it could not find a `[frames, joints, 3]` array, inspect available
keys:

```powershell
python tools\offline_mocap\convert_wham_gvhmr.py C:\ai\gvhmr\<result>.pt --source gvhmr
```

If needed, rerun with a dot-path:

```powershell
python tools\offline_mocap\convert_wham_gvhmr.py C:\ai\gvhmr\<result>.pt --source gvhmr --key results.smpl_joints -o C:\ai\data\ted1.gvhmr.json
```

Common key candidates:

```text
joints3d
joints_3d
smpl_joints
pred_joints
world_joints
global_joints
keypoints3d
keypoints_3d
```

## 8. Import Into vrm-player

Run the app:

```powershell
cd C:\ai\vrm-player
npm install
npm run dev -- --host 127.0.0.1
```

Open the printed local URL.

In the UI:

```text
Capture
  -> Anim export
  -> Choose animation...
  -> C:\ai\data\ted1.gvhmr.json
```

The clip should enter the normal animation queue and start playing.

## 9. Quality Checks

Compare against the current MediaPipe BVH:

```text
/Users/fedor/Downloads/mocap_1 (31).bvh
```

Look specifically for:

- foot sliding
- root drift
- torso orientation
- arm reach / elbow direction
- hand side swap
- scale mismatch
- sudden quaternion flips
- head/neck jitter

If GVHMR looks physically better but avatar mapping is wrong, the problem is
our adapter/retargeter, not GVHMR. Save the `.gvhmr.json` and result file for
debugging.

## Troubleshooting

### `torch.cuda.is_available()` is false

- Check `nvidia-smi`.
- Install/update NVIDIA driver.
- Ensure you installed CUDA PyTorch wheel, not CPU PyTorch.
- Reinstall:

```powershell
pip uninstall torch torchvision torchaudio -y
pip install torch==2.3.0 torchvision==0.18.0 torchaudio==2.3.0 --index-url https://download.pytorch.org/whl/cu121
```

### PyTorch3D install fails

This usually means Python/Torch/CUDA version mismatch.

- Use the exact versions in GVHMR docs.
- Prefer Python 3.10.
- Prefer the PyTorch version GVHMR pins.
- Do not mix conda CUDA packages and pip CUDA wheels unless the docs say so.

### Missing SMPL/SMPLX files

Symptoms include errors mentioning:

```text
SMPL
SMPLX
body model
SMPL_NEUTRAL
model_path
```

Fix by downloading the licensed body model files and placing them where GVHMR
config expects.

### Converter cannot find joints

Run with a specific `--key`. If unsure, inspect the result file structure in
Python:

```powershell
python - << "PY"
import torch
p = r"C:\ai\gvhmr\<result>.pt"
d = torch.load(p, map_location="cpu")
def walk(x, prefix=""):
    if isinstance(x, dict):
        for k, v in x.items():
            walk(v, f"{prefix}.{k}" if prefix else str(k))
    else:
        s = getattr(x, "shape", None)
        if s is not None:
            print(prefix, tuple(s))
walk(d)
PY
```

Then use the printed key that looks like `(frames, joints, 3)`.

### Imported JSON appears side-swapped

This can happen depending on GVHMR coordinate conventions and camera direction.
For now, keep both files:

```text
ted1.gvhmr.json
original GVHMR result
```

Then adjust the adapter mapping rather than editing the JSON manually.

### Motion is better but feet still slide

That means GVHMR recovery is useful, but our offline retargeter needs contact
aware foot locking. Keep the result; this is the next retargeter improvement.

## Expected Deliverables Back To Mac

Copy these back:

```text
C:\ai\data\ted1.gvhmr.json
C:\ai\gvhmr\<raw-result-file>
```

Then on the Mac, import:

```text
/path/to/ted1.gvhmr.json
```

or copy it into:

```text
public/offline_mocap/ted1.gvhmr.json
```

