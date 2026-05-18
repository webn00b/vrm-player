import json
import math
import tempfile
import unittest
from pathlib import Path

import animation_repair as repair
import animation_validator as validator


def quat_x(deg: float) -> list[float]:
    half = math.radians(deg) / 2
    return [math.sin(half), 0.0, 0.0, math.cos(half)]


class AnimationRepairTest(unittest.TestCase):
    def repair_payload(self, payload, **kwargs):
        defaults = dict(
            fix_norm=True,
            fix_continuity=True,
            clamp_rom=True,
            smooth_jitter=False,
            jitter_deg=60.0,
        )
        defaults.update(kwargs)
        return repair.AnimationRepairer(**defaults).repair_payload(payload)

    def validate_payload(self, payload):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "anim.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            trace = validator.load_motion_trace(path)
        return validator.AnimationValidator(validator.ValidatorOptions()).validate(trace)

    def test_clamps_lower_arm_rom(self):
        payload = {
            "duration": 1,
            "channels": {
                "rightLowerArm": {
                    "times": [0],
                    "values": quat_x(-45),
                }
            },
        }
        before = self.validate_payload(payload)
        self.assertTrue(any(issue["category"] == "rom" for issue in before["issues"]))
        repaired = self.repair_payload(payload)
        after = self.validate_payload(repaired)
        self.assertFalse(any(issue["category"] == "rom" for issue in after["issues"]))

    def test_fixes_antipodal_continuity(self):
        payload = {
            "duration": 1,
            "channels": {
                "hips": {
                    "times": [0, 0.033],
                    "values": [0, 0, 0, 1, 0, 0, 0, -1],
                }
            },
        }
        repaired = self.repair_payload(payload, clamp_rom=False)
        values = repaired["channels"]["hips"]["values"]
        self.assertEqual(values[7], 1)

    def test_normalizes_quaternion(self):
        payload = {
            "duration": 1,
            "channels": {
                "hips": {
                    "times": [0],
                    "values": [0, 0, 0, 2],
                }
            },
        }
        repaired = self.repair_payload(payload, clamp_rom=False)
        values = repaired["channels"]["hips"]["values"]
        self.assertAlmostEqual(values[3], 1.0)

    def test_writes_markdown_repair_report(self):
        payload = {
            "duration": 1,
            "channels": {
                "rightUpperArm": {
                    "times": [0, 0.033, 0.066],
                    "values": [*quat_x(0), *quat_x(0), *quat_x(0)],
                },
                "rightLowerArm": {
                    "times": [0, 0.033, 0.066],
                    "values": [*quat_x(-45), *quat_x(-45), *quat_x(-45)],
                },
            },
        }
        repairer = repair.AnimationRepairer(
            fix_norm=True,
            fix_continuity=True,
            clamp_rom=True,
            smooth_jitter=False,
            jitter_deg=60,
        )
        before = repair.validate_payload(payload, "before")
        repaired = repairer.repair_payload(payload)
        after = repair.validate_payload(repaired, "after")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "repair_report.md"
            repair.write_repair_markdown(
                input_path=Path("input.json"),
                output_path=Path("output.json"),
                markdown_path=path,
                before=before,
                after=after,
                repair_stats=repairer.stats,
                passes=repaired["repair"]["passes"],
                diff_report=None,
            )
            text = path.read_text(encoding="utf-8")
        self.assertIn("Automatically Fixed", text)
        self.assertIn("Motion Diff", text)
        self.assertIn("Retarget Fix Candidates", text)
        self.assertIn("Manual / AI Review", text)


if __name__ == "__main__":
    unittest.main()
