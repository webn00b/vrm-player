# Quest 3 hand-tracking → vrm-player fingers — plan

Capture accurate **fingers** (the one level a single camera can't do) with the
Quest 3's built-in hand tracking, and overlay them onto a body animation in
vrm-player. Quest sees full finger articulation (26 joints/hand, on-device) —
exactly what MediaPipe + heuristics can't recover from a flat video.

## Scope & honest limits

- **In scope:** the wearer's hands/fingers → a finger-track file → applied on top
  of a body BVH in vrm-player.
- **Out of scope:** body. Quest infers legs (IK guess), and it can't film another
  person (no raw camera access). It tracks *you*, first-person, in the headset.
- **Workflow reality:** you wear the Quest. So this is for *your own* gestures,
  recorded while wearing it — not "process a video of someone".

## Architecture

```
Quest 3 (you wearing it)
  Unity + Meta XR SDK hand tracking  →  per-frame 26-joint hand poses
  map Quest hand joints → VRM finger bones (local quaternions)
  write hand-track JSON  (start/stop in-app)
        │  (sideload via Quest dev mode)
        ▼
hand-track.json  ←── exchange contract (below)
        │
        ▼
vrm-player: import + HandTrackPlayer (mirror the existing face-track player)
  overlay finger rotations on top of the body BVH during replay/record
```

Reuse the **face-track sidecar pattern already in the repo** (`faceTrack.ts` +
`FaceTrackPlayer` + `--face` in bvh-to-video): per-frame values sampled by time,
applied on top of the body clip. Fingers are the same shape — per-frame local
quaternions on a fixed set of bones.

## Exchange contract — `*.hands.json`

```jsonc
{
  "version": 1,
  "fps": 30,
  "source": "quest3",
  "frames": [
    { "t": 0.0,
      "left":  { "leftThumbProximal": [x,y,z,w], "leftThumbIntermediate": [...], ... },
      "right": { "rightIndexProximal": [...], ... } }
  ]
}
```

- Keys = **VRM humanoid finger bone names** (the 15/hand vrm-player already drives:
  `${side}${Thumb|Index|Middle|Ring|Little}${Metacarpal|Proximal|Intermediate|Distal}`,
  see `FINGER_VRM_NAMES` in `directPoseConfig.ts`).
- Values = **local quaternion** `[x,y,z,w]` for that bone, in the VRM convention.
- `left`/`right` may be absent on frames where the hand isn't tracked (hold last).

The mapping Quest-joint → VRM-bone (axes + rest offset) is the real work — done
once in the Unity app, so vrm-player just applies clean local quats.

## Quest side (Unity)

1. Unity LTS + **Meta XR Core SDK** (or OpenXR `XR_EXT_hand_tracking`). Quest dev
   mode on (free Meta dev account → enable in the Meta Quest phone app → sideload).
2. Read hand skeleton each frame (`OVRHand` / `OVRSkeleton`, 26 bones/hand) with
   per-bone rotations + tracking confidence.
3. **Retarget Quest hand bones → VRM finger bones:** match the chains
   (thumb/index/middle/ring/little × segments), convert each joint's rotation
   into the VRM bone's local frame (calibrate the rest-pose offset once against a
   flat open hand). This is the crux — verify by rendering an open hand → flat.
4. Simple in-headset UI: **Record / Stop**, 30 fps, countdown. On stop, write
   `*.hands.json` to app storage; pull via `adb pull` (or share).
5. (Optional) include head/wrist world pose so wrists can be positioned, not just
   finger curl.

## vrm-player side (small)

1. `src/mocap/hands/handTrack.ts` — parse/validate `*.hands.json` (mirror
   `wilorHands.ts` / `faceTrack.ts`).
2. `HandTrackPlayer.applyAt(timeSec)` — sample frame, set the VRM finger bones'
   local quaternions (mirror `FaceTrackPlayer`). Runs after the body applier so
   fingers override.
3. UI hook: load a `.hands.json` alongside a body clip (like the face sidecar);
   `bvh-to-video --hands <file>` for headless verification.
4. Sync: align by a **clap/marker at the start** (set an offset), or record body
   + hands in one take and align by timecode. MVP: manual offset slider.

## Milestones

1. **Spike (proves it):** Unity Quest app dumps raw hand joints to JSON; eyeball
   in a viewer. Confirms tracking quality + export works.
2. **Retarget:** Quest→VRM finger mapping; render an open/fist/point hand on the
   avatar — fingers match.
3. **vrm-player import + HandTrackPlayer:** overlay on a body BVH; `--hands` CLI.
4. **Sync UX:** offset alignment, load in the Capture/Player UI.

## Risks / notes

- **Mapping axes** (Quest bone frame → VRM bone frame) is fiddly — calibrate
  against a known flat hand, verify by render (same measure-first discipline).
- **First-person only** + weak body → this is a *fingers add-on*, not a full
  solution. Best paired with body from the video pipeline.
- **Sync** between two separate captures is the practical friction.
- Effort: the Unity app is the bulk; the vrm-player side is small (face-track
  twin). No changes to the body pipeline.
