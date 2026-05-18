# Offline Mocap Import MVP

This path is for higher-quality video mocap where an external Python model
does the expensive recovery first, then `vrm-player` retargets the result to
the current VRM.

```text
video.mp4
  -> WHAM / GVHMR offline run
  -> result.pt / result.pkl / result.npz
  -> tools/offline_mocap/convert_wham_gvhmr.py
  -> *.wham.json / *.gvhmr.json
  -> Capture > Anim export / drag-drop
  -> Animation queue
```

## Browser Input Contract

The importer accepts `.motion.json`, `.wham.json`, and `.gvhmr.json`.

Preferred canonical shape:

```json
{
  "version": 1,
  "name": "walk",
  "source": "wham",
  "fps": 30,
  "frames": [
    {
      "time": 0,
      "root": { "position": [0, 0, 0] },
      "joints": {
        "hips": { "position": [0, 1, 0] },
        "spine": { "position": [0, 1.2, 0] },
        "leftUpperLeg": { "position": [0.1, 1, 0] }
      },
      "contacts": { "leftFoot": true, "rightFoot": false }
    }
  ]
}
```

MVP shortcut shape:

```json
{
  "name": "walk",
  "source": "gvhmr",
  "fps": 30,
  "joints3d": [[[0, 1, 0]]]
}
```

When no `jointNames` are provided, `joints3d` is interpreted as SMPL-24 order.

## Converter

Run WHAM/GVHMR in its own Python environment, then convert the saved result:

```bash
python tools/offline_mocap/convert_wham_gvhmr.py path/to/result.pt --source gvhmr --fps 30
```

If the converter picks the wrong array, pass a dot-path:

```bash
python tools/offline_mocap/convert_wham_gvhmr.py result.pkl --source wham --key results.smpl_joints
```

The generated JSON can be loaded through the existing animation import flow.

## Two-Camera MediaPipe MVP

### Browser UI

The player can generate a rough two-camera motion JSON directly in the browser:

```text
Capture -> Multi-view
  -> Front...
  -> Side...
  -> set FPS / Offset / Depth / Scale
  -> Generate motion JSON
```

The browser path downloads the generated `.browser.multiview.motion.json` and
`*.fusion.report.json`, then immediately imports the motion JSON into the
animation queue.

For the bundled FreeMoCap sample videos, use the browser-compatible H.264 copies:

- `data/multiview-test/freemocap/browser/Cam1_front_h264.mp4` as `Front`
- `data/multiview-test/freemocap/browser/Cam2_side_h264.mp4` as `Side`
- `FPS = 6`
- `Offset = 0`
- `Depth = x`
- `Scale = 1`

The original FreeMoCap `.mp4` files use MPEG-4 Part 2 video. OpenCV can read
them, but browser `<video>` may reject them. Convert any similar test pair to
H.264 before using the browser UI:

```bash
ffmpeg -i input.mp4 -c:v libx264 -pix_fmt yuv420p -movflags +faststart -an output_h264.mp4
```

### Python CLI

For synchronized front/side videos, use the local rough-orthogonal two-camera
converter:

```bash
python -m pip install -r tools/offline_mocap/requirements.txt
```

```bash
python tools/offline_mocap/video_pair_to_motion_mediapipe.py \
  --front data/multiview-test/freemocap/freemocap_test_data/synchronized_videos/sesh_2022-09-19_16_16_50_in_class_jsm_synced_Cam1.mp4 \
  --side data/multiview-test/freemocap/freemocap_test_data/synchronized_videos/sesh_2022-09-19_16_16_50_in_class_jsm_synced_Cam2.mp4 \
  --output data/multiview-test/freemocap/freemocap_test_data/freemocap_cam1_cam2.multiview.motion.json \
  --fps 6 \
  --side-offset-frames 0 \
  --side-depth-axis x
```

The script writes:

- `*.multiview.motion.json` - load this in the player through `Capture > Anim export > Load` or drag-drop.
- `*.front.pose.json` and `*.side.pose.json` - per-view MediaPipe debug output.
- `*.fusion.report.json` - frame counts, sync settings, calibration settings and joint coverage stats.
- `*.fusion.analysis.json` - diagnostic ranges, bone-length drift, root drift and candidate axis/scale/offset rankings.

This is an MVP fusion mode, not calibrated triangulation. Use `--side-depth-axis`,
`--depth-scale`, `--depth-offset`, `--front-mirror-x` and `--side-mirror-x` to
tune the result for a specific camera pair.
