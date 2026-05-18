import json
import math
import tempfile
import unittest
from pathlib import Path

import animation_validator as av


def quat_x(deg: float) -> list[float]:
    half = math.radians(deg) / 2.0
    return [math.sin(half), 0.0, 0.0, math.cos(half)]


class AnimationValidatorTest(unittest.TestCase):
    def validate_payload(self, payload):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "trace.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            trace = av.load_motion_trace(path)
        return av.AnimationValidator(av.ValidatorOptions()).validate(trace)

    def test_detects_rom_violation_from_channel_animation(self):
        payload = {
            "duration": 1,
            "channels": {
                "rightLowerArm": {
                    "times": [0, 0.033],
                    "values": [0, 0, 0, 1, *quat_x(-45)],
                }
            },
        }
        report = self.validate_payload(payload)
        self.assertTrue(any(issue["category"] == "rom" for issue in report["issues"]))

    def test_detects_foot_slide_from_frame_trace(self):
        payload = {
            "fps": 30,
            "frames": [
                {
                    "time": 0,
                    "bones": {"leftFoot": {"localQuat": [0, 0, 0, 1], "worldPos": [0, 0.01, 0]}},
                },
                {
                    "time": 1 / 30,
                    "bones": {"leftFoot": {"localQuat": [0, 0, 0, 1], "worldPos": [0.1, 0.01, 0]}},
                },
            ],
        }
        report = self.validate_payload(payload)
        self.assertTrue(any(issue["category"] == "foot-slide" for issue in report["issues"]))

    def test_valid_idle_channel_has_no_errors(self):
        payload = {
            "duration": 1,
            "channels": {
                "hips": {
                    "times": [0, 0.033],
                    "values": [0, 0, 0, 1, 0, 0, 0, 1],
                }
            },
        }
        report = self.validate_payload(payload)
        self.assertEqual(report["summary"]["severityCounts"].get("error", 0), 0)

    def test_reads_canonical_motion_joints(self):
        payload = {
            "fps": 30,
            "frames": [
                {
                    "time": 0,
                    "root": {"position": [0, 1, 0]},
                    "joints": {
                        "leftFoot": {"position": [0, 0.01, 0]},
                    },
                },
                {
                    "time": 1 / 30,
                    "root": {"position": [0, 1, 0]},
                    "joints": {
                        "leftFoot": {"position": [0.1, 0.01, 0]},
                    },
                },
            ],
        }
        report = self.validate_payload(payload)
        self.assertTrue(any(issue["category"] == "foot-slide" for issue in report["issues"]))


if __name__ == "__main__":
    unittest.main()
