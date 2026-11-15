"""Contract tests for the lts-object-spec emission target.

The expectations come from the forge's own rules (generate_threejs_factory.py, emit_target.py) and
the ObjectSpec contract, not from reading the emitter. The last class runs the forge's real socket.

Run: python3 -m unittest discover -s tools/img-to-object/tests
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent / "plugin"
UPSTREAM = HERE.parent / "upstream"
sys.path.insert(0, str(PLUGIN))

import emit_object_spec as eos  # noqa: E402
import install  # noqa: E402


def spec(components, materials=None, **extra):
    return {
        "targetId": "your-test-object",
        "targetName": "Your test object",
        "schemaVersion": "2.1",
        "materials": materials if materials is not None else [{"id": "shell", "baseColor": "#808080", "roughness": {"base": 0.6}}],
        "componentTree": components,
        **extra,
    }


def box(cid, **fields):
    return {"id": cid, "primitive": "box", "material": "shell", **fields}


def parts_by_id(object_spec):
    return {p["id"]: p for p in object_spec["parts"]}


class Shapes(unittest.TestCase):
    def test_a_box_is_unit_sized_with_its_dimensions_as_size_factors(self):
        out, _ = eos.emit(spec([box("body", dimensions={"width": 1.0, "height": 0.46, "depth": 0.78}, transform={"position": [0, 0.2, 0], "rotation": [0.1, 0, 0]})]))
        body = parts_by_id(out)["body"]
        self.assertEqual(body["shape"], {"type": "box", "size": [1.0, 1.0, 1.0]})
        self.assertEqual(body["scale"], [1.0, 0.46, 0.78])
        self.assertEqual(body["position"], [0.0, 0.2, 0.0])
        self.assertEqual(body["rotation"], [0.1, 0.0, 0.0])

    def test_transform_scale_wins_over_dimensions(self):
        out, _ = eos.emit(spec([box("body", dimensions={"width": 5, "height": 5, "depth": 5}, transform={"scale": [1, 2, 3]})]))
        self.assertEqual(parts_by_id(out)["body"]["scale"], [1.0, 2.0, 3.0])

    def test_a_radius_sizes_width_and_depth(self):
        out, _ = eos.emit(spec([{"id": "drum", "primitive": "cylinder", "material": "shell", "dimensions": {"radius": 0.25, "height": 0.1}}]))
        drum = parts_by_id(out)["drum"]
        self.assertEqual(drum["shape"]["type"], "cylinder")
        self.assertEqual(drum["scale"], [0.5, 0.1, 0.5])

    def test_the_forges_two_sizing_traps_are_kept_and_reported(self):
        out, report = eos.emit(spec([
            box("lid", dimensions={"width": 1.0, "height": 0.2, "depth": 0.8}, transform={"scale": [1, 1, 1]}),
            {"id": "bulb", "primitive": "sphere", "material": "shell", "dimensions": {"radius": 0.05}},
        ]))
        self.assertEqual(parts_by_id(out)["lid"]["scale"], [1.0, 1.0, 1.0])
        self.assertEqual(parts_by_id(out)["bulb"]["scale"], [0.1, 1.0, 0.1])
        self.assertTrue(any("'lid'" in w and "overrides" in w for w in report["warnings"]))
        self.assertTrue(any("'bulb'" in w and "height at 1" in w for w in report["warnings"]))

    def test_each_supported_primitive_becomes_an_objectspec_shape(self):
        expected = {
            "box": "box", "sphere": "sphere", "ellipsoid": "sphere", "cylinder": "cylinder", "cone": "cylinder",
            "capsule": "lathe", "torus": "torus", "lathe": "lathe", "plane-card": "box", "instanced-cluster": "box",
        }
        components = [{"id": f"p-{k}", "primitive": k, "material": "shell"} for k in expected]
        out, report = eos.emit(spec(components))
        got = {p["id"]: p["shape"]["type"] for p in out["parts"]}
        self.assertEqual(got, {f"p-{k}": v for k, v in expected.items()})
        self.assertEqual(parts_by_id(out)["p-cone"]["shape"]["radiusTop"], 0.0)
        self.assertTrue(any("capsule" in n for n in report["notes"]))

    def test_a_capsule_profile_is_closed_at_both_poles(self):
        points = eos.capsule_profile()
        self.assertEqual(points[0], [0.0, -0.7])
        self.assertEqual(points[-1], [0.0, 0.7])
        self.assertTrue(all(r >= 0 for r, _ in points))

    def test_a_torus_tube_follows_its_ratio(self):
        out, _ = eos.emit(spec([{"id": "ring", "primitive": "torus", "material": "shell", "geometryDescriptor": {"torusTubeRatio": 0.2}}]))
        self.assertAlmostEqual(parts_by_id(out)["ring"]["shape"]["tube"], 0.09)

    def test_unsupported_shapes_fail_loudly_naming_each_component(self):
        with self.assertRaises(eos.EmitError) as caught:
            eos.emit(spec([box("body"), {"id": "handle", "primitive": "extrude", "material": "shell"}, {"id": "blob", "primitive": "sphere", "material": "shell", "geometryDescriptor": {"sdf": {"primitives": []}}}]))
        message = str(caught.exception)
        self.assertIn("'handle'", message)
        self.assertIn("'blob'", message)


class Hierarchy(unittest.TestCase):
    def test_parents_come_before_children_whatever_the_source_order(self):
        out, _ = eos.emit(spec([box("lid", parent="body"), box("body"), box("latch", parent="lid")]))
        order = [p["id"] for p in out["parts"]]
        self.assertLess(order.index("body"), order.index("lid"))
        self.assertLess(order.index("lid"), order.index("latch"))
        self.assertEqual(parts_by_id(out)["latch"]["parent"], "lid")

    def test_an_unknown_parent_hangs_the_part_from_the_root_with_a_warning(self):
        out, report = eos.emit(spec([box("lid", parent="frame")]))
        self.assertNotIn("parent", parts_by_id(out)["lid"])
        self.assertTrue(any("frame" in w for w in report["warnings"]))

    def test_a_parent_loop_fails(self):
        with self.assertRaises(eos.EmitError):
            eos.emit(spec([box("a", parent="b"), box("b", parent="a")]))

    def test_ids_become_unique_slugs(self):
        out, _ = eos.emit(spec([box("lidHinge"), box("lid_hinge")]))
        self.assertEqual([p["id"] for p in out["parts"]], ["lid-hinge", "lid-hinge-2"])

    def test_an_attached_cylinder_runs_from_start_to_end_with_its_pivot_at_the_start(self):
        leg = {"id": "leg", "primitive": "cylinder", "material": "shell", "attachment": {"localStart": [0, 0, 0], "localEnd": [0.5, 0, 0], "baseRadius": 0.04, "endRadius": 0.02}}
        out, _ = eos.emit(spec([leg]))
        part = parts_by_id(out)["leg"]
        self.assertEqual(part["shape"], {"type": "cylinder", "radiusTop": 0.02, "radiusBottom": 0.04, "height": 0.5, "segments": 24})
        self.assertEqual(part["position"], [0.0, 0.0, 0.0])
        self.assertEqual(part["shapePosition"], [0.25, 0.0, 0.0])
        # +y turned onto +x is a quarter turn about -z.
        self.assertEqual(part["shapeRotation"][0], 0.0)
        self.assertEqual(part["shapeRotation"][1], 0.0)
        self.assertAlmostEqual(part["shapeRotation"][2], -math.pi / 2, places=6)
        self.assertEqual(part["scale"], [1.0, 1.0, 1.0])

    def test_sockets_hang_from_their_component_with_unique_ids(self):
        body = box("body", actionProfile={"sockets": [{"id": "lidHingeSocket", "localPosition": [0, 0.2, -0.3]}, {"id": "body"}]})
        out, _ = eos.emit(spec([body]))
        self.assertEqual([s["id"] for s in out["sockets"]], ["body-lid-hinge-socket", "body-body"])
        self.assertEqual(out["sockets"][0]["parent"], "body")
        self.assertEqual(out["sockets"][0]["position"], [0.0, 0.2, -0.3])
        self.assertNotIn(out["sockets"][1]["id"], {p["id"] for p in out["parts"]})


class Materials(unittest.TestCase):
    def row(self, material):
        out, report = eos.emit(spec([box("body", material=material["id"])], materials=[material]))
        return out["materials"][report["materials"][0]["id"]], report["materials"][0]

    def test_a_polished_metal_takes_the_metal_preset_and_slot(self):
        mapped, _ = self.row({"id": "gold", "baseColor": "#d4a373", "metalness": {"base": 0.95}, "roughness": {"base": 0.2}})
        self.assertEqual((mapped["preset"], mapped["color"]), ("metal", "metal"))
        self.assertEqual((mapped["roughness"], mapped["metalness"]), (0.2, 0.95))

    def test_a_rough_metal_is_brushed(self):
        mapped, _ = self.row({"id": "steel", "baseColor": "#a0a0a0", "metalness": 1, "roughness": 0.5})
        self.assertEqual(mapped["preset"], "metal-brushed")

    def test_a_near_black_rough_plastic_is_a_dark_shade_of_base(self):
        mapped, row = self.row({"id": "shell", "baseColor": "#212327", "roughness": {"base": 0.8}})
        self.assertEqual((mapped["preset"], mapped["color"]), ("matte", "base"))
        self.assertLess(mapped["shade"], 0.25)
        self.assertEqual(row["sourceColor"], "#212327")

    def test_a_saturated_color_takes_the_accent_slot(self):
        mapped, _ = self.row({"id": "leather", "baseColor": "#6b3f1f", "roughness": 0.5})
        self.assertEqual(mapped["color"], "accent")

    def test_transmission_makes_glass_and_emission_makes_emissive(self):
        self.assertEqual(self.row({"id": "lens", "baseColor": "#ffffff", "transmission": 0.9})[0]["preset"], "glass")
        self.assertEqual(self.row({"id": "lamp", "baseColor": "#ffeeaa", "emissiveIntensity": 2})[0]["preset"], "emissive")

    def test_the_shade_reproduces_the_source_brightness_under_neutral(self):
        for color in ("#212327", "#6b3f1f", "#d4a373", "#f5f5f5", "#808080"):
            _, row = self.row({"id": "m", "baseColor": color, "roughness": 0.5})
            source = max(int(color[i:i + 2], 16) for i in (1, 3, 5))
            result = max(int(row["neutralResult"][i:i + 2], 16) for i in (1, 3, 5))
            self.assertLessEqual(abs(source - result), 1, f"{color} -> {row['neutralResult']}")

    def test_only_used_materials_are_emitted(self):
        out, _ = eos.emit(spec([box("body")], materials=[{"id": "shell", "baseColor": "#808080"}, {"id": "spare", "baseColor": "#ff0000"}]))
        self.assertEqual(list(out["materials"]), ["shell"])

    def test_an_unknown_material_uses_the_forge_fallback_with_a_warning(self):
        out, report = eos.emit(spec([box("body", material="nope")]))
        self.assertEqual(len(out["materials"]), 1)
        self.assertTrue(any("nope" in w for w in report["warnings"]))


class Repetition(unittest.TestCase):
    def test_a_radial_system_is_a_ring_of_copies_like_the_factory(self):
        system = {"id": "boltRing", "count": 4, "primitive": "cylinder", "parent": "body", "material": "shell",
                  "instanceScale": [0.05, 0.02, 0.05], "placement": {"mode": "radial", "axis": [0, 1, 0], "radius": 1.0}}
        out, _ = eos.emit(spec([box("body")], repetitionSystems=[system]))
        copies = [p for p in out["parts"] if p["id"].startswith("bolt-ring-")]
        self.assertEqual([c["id"] for c in copies], ["bolt-ring-1", "bolt-ring-2", "bolt-ring-3", "bolt-ring-4"])
        for c in copies:
            self.assertEqual(c["parent"], "body")
            self.assertEqual(c["scale"], [0.05, 0.02, 0.05])
            self.assertAlmostEqual(math.hypot(*c["position"]), 0.5, places=6)
            self.assertAlmostEqual(c["position"][1], 0.0, places=6)

    def test_a_system_whose_parts_are_already_built_is_not_repeated(self):
        system = {"id": "latches", "count": 2, "elementComponentIds": ["body"]}
        out, report = eos.emit(spec([box("body")], repetitionSystems=[system]))
        self.assertEqual(len(out["parts"]), 1)
        self.assertTrue(any("latches" in n for n in report["notes"]))


class Output(unittest.TestCase):
    def test_the_same_spec_gives_the_same_bytes_and_no_negative_zero(self):
        source = spec([box("lid", parent="body", transform={"position": [-0.0, 1e-9, -1e-9]}), box("body")])
        a = eos.dumps(eos.emit(source)[0])
        b = eos.dumps(eos.emit(json.loads(json.dumps(source)))[0])
        self.assertEqual(a, b)
        self.assertNotIn("-0.0,", a)
        self.assertNotIn("-0.0\n", a)

    def test_the_header_names_the_object(self):
        out, _ = eos.emit(spec([box("body")]))
        self.assertEqual((out["format"], out["version"], out["id"], out["name"]), ("lts-object-spec", 1, "your-test-object", "Your test object"))

    def test_the_upstream_conformance_fixture_emits(self):
        source = json.loads((UPSTREAM / "forge/tests/fixtures/reference_target_conformance_spec.json").read_text(encoding="utf-8"))
        out, report = eos.emit(source)
        self.assertEqual(len(out["parts"]), report["parts"])
        self.assertGreaterEqual(len(out["parts"]), len(source["componentTree"]))
        used = {p["material"] for p in out["parts"]}
        self.assertEqual(used, set(out["materials"]))


def _action_ready(workspace: Path) -> None:
    sys.path.insert(0, str(UPSTREAM / "forge" / "_shared"))
    from workflow_state import new_state, save_state  # noqa: PLC0415

    state = new_state("ref.png", spec=str(workspace / "spec.json"))
    for entry in state["checklist"]:
        entry["status"] = "done"
        entry["evidence"] = ["fixture"]
    state["currentPass"] = state["status"] = state["currentStep"] = "complete"
    save_state(workspace / ".img2threejs" / "state.json", state)


class ThroughTheForgeSocket(unittest.TestCase):
    """emit_target.py --target lts-object-spec, with the plugin installed into a temp IMG2_HOME."""

    def run_socket(self, workspace: Path, home: Path, source: dict) -> subprocess.CompletedProcess:
        spec_path = workspace / "spec.json"
        spec_path.write_text(json.dumps(source), encoding="utf-8")
        env = {**os.environ, "IMG2_HOME": str(home)}
        return subprocess.run(
            [sys.executable, str(UPSTREAM / "forge/stage3_build/emit_target.py"), "--spec", str(spec_path), "--target", "lts-object-spec", "--workspace", str(workspace)],
            capture_output=True, text=True, env=env, timeout=120,
        )

    def test_an_action_ready_workspace_gets_a_verified_deterministic_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            home, workspace = Path(tmp) / "home", Path(tmp) / "ws"
            workspace.mkdir()
            install.install(home)
            _action_ready(workspace)
            proc = self.run_socket(workspace, home, spec([box("body"), box("lid", parent="body")]))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            artifact = workspace / ".img2/artifacts/lts-object-spec/object-spec.json"
            emitted = json.loads(artifact.read_text(encoding="utf-8"))
            self.assertEqual([p["id"] for p in emitted["parts"]], ["body", "lid"])
            provenance = json.loads(proc.stdout)["provenance"]
            self.assertEqual(provenance.get("determinismVerified"), True, provenance)
            state = json.loads((workspace / ".img2threejs/state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["targetSelection"], {"pluginId": "lts-object-spec", "kind": "lts-object-spec"})

    def test_a_workspace_mid_pass_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            home, workspace = Path(tmp) / "home", Path(tmp) / "ws"
            workspace.mkdir()
            install.install(home)
            proc = self.run_socket(workspace, home, spec([box("body")]))
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("action-ready", proc.stderr)

    def test_an_unsupported_spec_fails_and_leaves_no_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            home, workspace = Path(tmp) / "home", Path(tmp) / "ws"
            workspace.mkdir()
            install.install(home)
            _action_ready(workspace)
            proc = self.run_socket(workspace, home, spec([{"id": "handle", "primitive": "extrude", "material": "shell"}]))
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("handle", proc.stderr)
            self.assertFalse((workspace / ".img2/artifacts/lts-object-spec/object-spec.json").exists())

    def test_reinstalling_replaces_the_registry_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            install.install(home)
            install.install(home)
            rows = json.loads((home / "plugins.json").read_text(encoding="utf-8"))["plugins"]
            self.assertEqual([r["id"] for r in rows], ["lts-object-spec"])


if __name__ == "__main__":
    unittest.main()
