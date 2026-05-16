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

Native Windows Python is also fragile because upstream GVHMR pins a Linux
`pytorch3d` wheel. If `pip`/`conda` cannot install `pytorch3d` on Windows,
use WSL2 Ubuntu with NVIDIA passthrough. This has been verified with:

```powershell
wsl.exe --install -d Ubuntu --name Ubuntu-GVHMR --no-launch
wsl.exe -d Ubuntu-GVHMR -- nvidia-smi
```

Inside WSL, the Windows GVHMR checkout is available at:

```text
/mnt/c/ai/gvhmr
```

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
/Users/fedor/projects/personal/vrm-player/tools/offline_mocap/export_gvhmr_joints.py
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

Check shell tools:

```powershell
git --version
conda --version
```

If `conda` is missing, install Miniconda/Mambaforge and open a fresh
PowerShell/Anaconda Prompt before continuing.

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
pip install -e .
```

If the upstream docs mention `pytorch3d`, install the exact wheel they specify.
This is the dependency most likely to break if CUDA/Python/Torch versions drift.

### WSL2 Ubuntu Setup

If using `Ubuntu-GVHMR`, install Miniconda and build tools inside WSL:

```bash
curl -L https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o /tmp/miniconda.sh
bash /tmp/miniconda.sh -b -p /opt/miniconda
apt-get update
apt-get install -y build-essential
```

Then create the GVHMR environment from the Windows checkout:

```bash
cd /mnt/c/ai/gvhmr
/opt/miniconda/bin/conda create -n gvhmr python=3.10 -y
/opt/miniconda/bin/conda run -n gvhmr python -m pip install chumpy==0.70 --no-build-isolation
/opt/miniconda/bin/conda run -n gvhmr python -m pip install -r requirements.txt
/opt/miniconda/bin/conda run -n gvhmr python -m pip install -e .
```

Verify:

```bash
/opt/miniconda/bin/conda run -n gvhmr python tools/demo/demo.py --help
```

## 4. Download GVHMR Checkpoints

Follow the official checkpoint instructions from GVHMR. As of the current
GVHMR demo config, the main model checkpoint is expected here:

```text
C:\ai\gvhmr\inputs\checkpoints\gvhmr\gvhmr_siga24_release.ckpt
```

The downloaded checkpoint bundle also contains dependencies used by the demo,
typically under:

```text
C:\ai\gvhmr\inputs\checkpoints\hmr2
C:\ai\gvhmr\inputs\checkpoints\vitpose
C:\ai\gvhmr\inputs\checkpoints\yolo
```

The exact expected path is defined by GVHMR's config/demo code, so prefer the
upstream `docs/INSTALL.md` if it changes.

From WSL, the public Google Drive checkpoints can be downloaded with `gdown`:

```bash
cd /mnt/c/ai/gvhmr
/opt/miniconda/bin/conda run -n gvhmr python -m pip install gdown
mkdir -p inputs/checkpoints
/opt/miniconda/bin/conda run -n gvhmr gdown --folder \
  "https://drive.google.com/drive/folders/1eebJ13FUEXrKBawHpJroW0sNSxLjh9xD?usp=drive_link" \
  -O inputs/checkpoints
```

Google Drive may rate-limit individual files. In that case, download the
missing files in a browser and place them in the paths above.

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

After download, place files where GVHMR expects them. As of the current
upstream install doc, that means:

```text
C:\ai\gvhmr\inputs\checkpoints\body_models\smpl
C:\ai\gvhmr\inputs\checkpoints\body_models\smplx
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

Run the demo/inference. Use `-s` only if the camera is static; it skips visual
odometry. For handheld or moving-camera video, omit `-s` first:

```powershell
python tools\demo\demo.py --video C:\ai\data\ted1.mp4 -s
```

If the command differs, use the command from GVHMR's current README/docs.

After completion, the main result file should be:

```text
C:\ai\gvhmr\outputs\demo\ted1\hmr4d_results.pt
```

You should also see rendered preview videos such as `2_global.mp4` in the same
output folder. If the expected file is not there, search by run time:

```powershell
dir C:\ai\gvhmr -Recurse -Include *.pt,*.pth,*.pkl,*.npz,*.json
```

Look for files created around the run time in output/demo/result folders.

## 7. Export GVHMR Joints

Clone or copy `vrm-player` on Windows:

```powershell
cd C:\ai
git clone <your-vrm-player-repo-url> vrm-player
cd C:\ai\vrm-player
git switch codex/offline-wham-gvhmr-mvp
```

If the branch is only local on the Mac, copy this script manually:

```text
tools\offline_mocap\export_gvhmr_joints.py
tools\offline_mocap\convert_wham_gvhmr.py
```

GVHMR's `hmr4d_results.pt` stores SMPL/SMPLX parameters. Export dense SMPL-24
joints first, from inside the GVHMR environment:

```powershell
cd C:\ai\gvhmr
conda activate gvhmr
python C:\ai\vrm-player\tools\offline_mocap\export_gvhmr_joints.py `
  C:\ai\gvhmr\outputs\demo\ted1\hmr4d_results.pt `
  -o C:\ai\data\ted1.gvhmr-joints.pt `
  --fps 30
```

If the camera was not static and global motion looks odd, rerun the original
GVHMR demo without `-s` before exporting.

## 8. Convert GVHMR Joints To vrm-player JSON

Run the converter with the exported joints file:

```powershell
cd C:\ai\vrm-player
conda activate gvhmr
python tools\offline_mocap\convert_wham_gvhmr.py `
  C:\ai\data\ted1.gvhmr-joints.pt `
  --source gvhmr `
  --fps 30 `
  -o C:\ai\data\ted1.gvhmr.json
```

If it says it could not find a `[frames, joints, 3]` array, inspect available
keys:

```powershell
python tools\offline_mocap\convert_wham_gvhmr.py `
  C:\ai\data\ted1.gvhmr-joints.pt `
  --source gvhmr
```

If needed, rerun with a dot-path:

```powershell
python tools\offline_mocap\convert_wham_gvhmr.py `
  C:\ai\data\ted1.gvhmr-joints.pt `
  --source gvhmr `
  --key joints3d `
  -o C:\ai\data\ted1.gvhmr.json
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

## 9. Import Into vrm-player

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

## 10. Quality Checks

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

Make sure you are converting `ted1.gvhmr-joints.pt`, not GVHMR's raw
`hmr4d_results.pt`. If unsure, inspect the file structure in Python:

```powershell
python - << "PY"
import torch
p = r"C:\ai\data\ted1.gvhmr-joints.pt"
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

