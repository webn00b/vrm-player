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

