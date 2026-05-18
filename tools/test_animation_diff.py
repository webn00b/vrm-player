import json
import math
import tempfile
import unittest
from pathlib import Path

import animation_diff as diff


def quat_x(deg: float) -> list[float]:
    half = math.radians(deg) / 2
    return [math.sin(half), 0.0, 0.0, math.cos(half)]


class AnimationDiffTest(unittest.TestCase):
    def test_reports_visible_quaternion_change(self):
        before = {
            "channels": {
                "rightLowerArm": {
                    "times": [0],
                    "values": quat_x(0),
                }
            }
        }
        after = {
            "channels": {
                "rightLowerArm": {
                    "times": [0],
                    "values": quat_x(30),
                }
            }
        }
        report = diff.compare_payloads(before, after, before_name="before.json", after_name="after.json")
        self.assertEqual(report["summary"]["changedBones"], 1)
        self.assertEqual(report["summary"]["visualChangedKeyframes"], 1)
        self.assertGreater(report["summary"]["maxDeltaDeg"], 29)

    def test_separates_hemisphere_only_change(self):
        before = {
            "channels": {
                "hips": {
                    "times": [0],
                    "values": [0, 0, 0, 1],
                }
            }
        }
        after = {
            "channels": {
                "hips": {
                    "times": [0],
                    "values": [0, 0, 0, -1],
                }
            }
        }
        report = diff.compare_payloads(before, after, before_name="before.json", after_name="after.json")
        self.assertEqual(report["summary"]["visualChangedKeyframes"], 0)
        self.assertEqual(report["summary"]["hemisphereOnlyKeyframes"], 1)

    def test_writes_markdown(self):
        report = diff.compare_payloads(
            {"channels": {"hips": {"times": [0], "values": [0, 0, 0, 1]}}},
            {"channels": {"hips": {"times": [0], "values": [0, 0, 0, -1]}}},
            before_name="before.json",
            after_name="after.json",
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "diff.md"
            diff.write_markdown(report, path)
            text = path.read_text(encoding="utf-8")
        self.assertIn("Animation diff", text)
        self.assertIn("Hemisphere-only", text)


if __name__ == "__main__":
    unittest.main()
