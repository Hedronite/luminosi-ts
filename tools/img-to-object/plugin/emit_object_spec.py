#!/usr/bin/env python3
"""Emit a LuminosiTS ObjectSpec from a forge sculpt spec (`object-sculpt-spec.json`).

This is the `lts-object-spec` emission target: the forge runs it through its own socket
(`emit_target.py --target lts-object-spec`) once a workspace is action-ready. It reads the same
fields the forge's TypeScript emitter reads and follows the same rules, so the ObjectSpec and the
generated factory describe the same object:

- each component is a pivot (its transform's position and rotation, relative to its parent) holding
  one unit-sized shape whose size factors come from `transform.scale`, else `dimensions`; those
  factors never reach the children;
- a cylinder, cone or capsule with an `attachment` becomes a tapered cylinder from `localStart` to
  `localEnd`, with its pivot at the start;
- sockets come from `actionProfile.sockets`;
- repetition systems are radial rings of `count` copies, as the factory builds them.

Colors map onto the LuminosiTS palette: each material gets a preset (from its metalness,
roughness, transmission and emission), a palette slot and a shade that reproduces its lightness
under the neutral preset, plus its roughness and metalness. The source colors and every
approximation go into a report beside the artifact.

What has no ObjectSpec equivalent yet (extrusions, sweeps, tubes, blades, implicit and visual-hull
surfaces) fails loudly, naming each component; nothing is dropped silently.

Standard library only. Deterministic: the same spec gives the same bytes.

Copyright the LuminosiTS contributors. MIT OR Apache-2.0.
"""

from __future__ import annotations

import argparse
import colorsys
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

FORMAT = "lts-object-spec"
VERSION = 1
MAX_PARTS = 512

# The neutral token preset's scene colors (@hedronite/lts-tokens). Shades are computed against these;
# a test in tools/img-to-object checks they still match the TypeScript source.
NEUTRAL_SCENE = {
    "base": "#d4d4d8",
    "accent": "#3b82f6",
    "metal": "#c0c4cc",
    "glass": "#8fb4e3",
    "emissive": "#93c5fd",
}

# The forge's fallbacks (generate_threejs_factory.py), so a sparse spec builds the same object.
FALLBACK_COLOR = "#8A7A5F"
DEFAULT_TORUS_TUBE = 0.08
DEFAULT_LATHE_PROFILE = {"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24}
ATTACHMENT_PRIMITIVES = {"cylinder", "cone", "capsule", "tube", "curve-sweep"}
VALID_PRIMITIVES = {
    "box", "sphere", "ellipsoid", "cylinder", "cone", "capsule", "torus", "tube", "lathe", "extrude",
    "ground-blade", "curve-sweep", "tapered-sweep", "plane-card", "instanced-cluster",
}
UNSUPPORTED_PRIMITIVES = {"tube", "extrude", "ground-blade", "curve-sweep", "tapered-sweep"}


class EmitError(Exception):
    """The spec can't be expressed as an ObjectSpec; the message names what and where."""


# ----------------------------------------------------------------------------- numbers and names


def num(value: float) -> float:
    """Six decimals and never -0, which JSON can't carry: the output must round-trip unchanged."""
    rounded = round(float(value), 6)
    return 0.0 if rounded == 0 else rounded


def vec(values: Any, fallback: tuple[float, float, float]) -> list[float]:
    if isinstance(values, list) and len(values) == 3 and all(is_number(v) for v in values):
        return [num(v) for v in values]
    return [num(v) for v in fallback]


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def slug(value: Any, fallback: str) -> str:
    text = str(value) if value is not None else ""
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", text)
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    text = re.sub(r"-{2,}", "-", text)[:64].strip("-")
    return text or fallback


class Ids:
    """Hands out unique slugs, so two source ids that slug alike never collide."""

    def __init__(self) -> None:
        self.taken: set[str] = set()

    def take(self, value: Any, fallback: str) -> str:
        base = slug(value, fallback)
        candidate, n = base, 2
        while candidate in self.taken:
            suffix = f"-{n}"
            candidate = base[: 64 - len(suffix)].strip("-") + suffix
            n += 1
        self.taken.add(candidate)
        return candidate


# ----------------------------------------------------------------------------- rotations


def quaternion_from_unit_vectors(a: list[float], b: list[float]) -> tuple[float, float, float, float]:
    """three.js Quaternion.setFromUnitVectors, as (x, y, z, w)."""
    r = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + 1
    if r < 1e-8:
        r = 0.0
        if abs(a[0]) > abs(a[2]):
            x, y, z, w = -a[1], a[0], 0.0, r
        else:
            x, y, z, w = 0.0, -a[2], a[1], r
    else:
        x = a[1] * b[2] - a[2] * b[1]
        y = a[2] * b[0] - a[0] * b[2]
        z = a[0] * b[1] - a[1] * b[0]
        w = r
    length = math.sqrt(x * x + y * y + z * z + w * w)
    return (x / length, y / length, z / length, w / length)


def euler_xyz(q: tuple[float, float, float, float]) -> list[float]:
    """three.js Euler.setFromQuaternion with the default XYZ order."""
    x, y, z, w = q
    m11 = 1 - 2 * (y * y + z * z)
    m12 = 2 * (x * y - z * w)
    m13 = 2 * (x * z + y * w)
    m22 = 1 - 2 * (x * x + z * z)
    m23 = 2 * (y * z - x * w)
    m32 = 2 * (y * z + x * w)
    m33 = 1 - 2 * (x * x + y * y)
    ey = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        ex = math.atan2(-m23, m33)
        ez = math.atan2(-m12, m11)
    else:
        ex = math.atan2(m32, m22)
        ez = 0.0
    return [num(ex), num(ey), num(ez)]


def normalize(v: list[float]) -> list[float]:
    length = math.sqrt(sum(c * c for c in v))
    return [c / length for c in v] if length > 0 else [0.0, 0.0, 1.0]


def cross(a: list[float], b: list[float]) -> list[float]:
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def rotate_about(v: list[float], axis: list[float], angle: float) -> list[float]:
    """Rodrigues' rotation of v about a unit axis."""
    c, s = math.cos(angle), math.sin(angle)
    dot = sum(v[i] * axis[i] for i in range(3))
    k = cross(axis, v)
    return [v[i] * c + k[i] * s + axis[i] * dot * (1 - c) for i in range(3)]


# ----------------------------------------------------------------------------- colors and materials


def parse_hex(value: Any) -> tuple[int, int, int] | None:
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", value.strip())
    if not match:
        return None
    h = match.group(1)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def scalar(value: Any, key: str = "base") -> float | None:
    if is_number(value):
        return float(value)
    if isinstance(value, dict) and is_number(value.get(key)):
        return float(value[key])
    return None


def source_color(material: dict[str, Any]) -> str:
    albedo = material.get("albedo")
    for candidate in (material.get("baseColor"), material.get("color"), albedo.get("dominant") if isinstance(albedo, dict) else None):
        if parse_hex(candidate) is not None:
            return "#" + "".join(f"{c:02x}" for c in parse_hex(candidate) or (0, 0, 0))
    return FALLBACK_COLOR.lower()


def shade_for(target_value: float, reference_value: float) -> float:
    """The shade that brings the reference color's brightest channel to the target's (see shadeHex)."""
    if reference_value <= 0:
        return 1.0
    if target_value <= reference_value:
        shade = target_value / reference_value
    else:
        shade = 1 + (target_value - reference_value) / (1 - reference_value) if reference_value < 1 else 2.0
    return num(min(2.0, max(0.0, shade)))


def shade_hex(hex_value: str, shade: float) -> str:
    """Python twin of shadeHex in @hedronite/lts-objects, for the report."""
    rgb = parse_hex(hex_value) or (0, 0, 0)
    out = [c * shade if shade <= 1 else c + (255 - c) * (shade - 1) for c in rgb]
    return "#" + "".join(f"{int(round(min(255, max(0, c)))):02x}" for c in out)


def map_material(material: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """An ObjectSpec material for a forge material, and the report row explaining it."""
    color = source_color(material)
    rgb = parse_hex(color) or (0, 0, 0)
    hue, saturation, value = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    roughness = scalar(material.get("roughness"))
    metalness = scalar(material.get("metalness"))
    transmission = scalar(material.get("transmission"))
    clearcoat = scalar(material.get("clearcoat"))
    emissive_intensity = scalar(material.get("emissiveIntensity"))
    if emissive_intensity is None and isinstance(material.get("emissive"), dict):
        emissive_intensity = scalar(material["emissive"].get("intensity"))
    rough = 0.5 if roughness is None else min(1.0, max(0.0, roughness))
    metal = 0.0 if metalness is None else min(1.0, max(0.0, metalness))

    if transmission is not None and transmission > 0.3:
        preset, slot = "glass", "glass"
    elif emissive_intensity is not None and emissive_intensity > 0:
        preset, slot = "emissive", "emissive"
    elif metal >= 0.5:
        preset, slot = ("metal" if rough < 0.3 else "metal-brushed"), "metal"
    else:
        if clearcoat is not None and clearcoat > 0.3:
            preset = "ceramic"
        elif rough >= 0.75:
            preset = "matte"
        else:
            preset = "satin"
        slot = "accent" if saturation >= 0.25 and value > 0.12 else "base"

    reference = parse_hex(NEUTRAL_SCENE[slot]) or (0, 0, 0)
    shade = shade_for(value, max(reference) / 255)
    out: dict[str, Any] = {"preset": preset, "color": slot, "shade": shade, "roughness": num(rough), "metalness": num(metal)}
    report = {
        "source": str(material.get("id")),
        "sourceColor": color,
        "hue": num(hue * 360),
        "saturation": num(saturation),
        "preset": preset,
        "color": slot,
        "shade": shade,
        "neutralResult": shade_hex(NEUTRAL_SCENE[slot], shade),
    }
    return out, report


# ----------------------------------------------------------------------------- shapes


def scale_triple(component: dict[str, Any], transform: dict[str, Any], warnings: list[str], where: str) -> list[float]:
    """The forge's scale_triple: transform.scale if present, else dimensions, else 1.

    Both forge rules that surprise authors are kept, so the ObjectSpec matches the factory, and
    reported: a transform scale hides the dimensions, and a radius with no height or length
    leaves the height at 1."""
    dims = component.get("dimensions")
    if "scale" in transform:
        scale = vec(transform.get("scale"), (1.0, 1.0, 1.0))
        if isinstance(dims, dict) and any(is_number(dims.get(k)) for k in ("width", "height", "depth", "radius", "length")):
            warnings.append(f"{where}: transform.scale {scale} overrides its dimensions, as in the forge")
        return scale
    if isinstance(dims, dict):
        radius = dims.get("radius")
        fallback = radius * 2 if is_number(radius) else 1
        width = dims.get("width", fallback)
        if is_number(radius) and "height" not in dims and "length" not in dims:
            warnings.append(f"{where}: a radius with no height or length leaves the height at 1, as in the forge")
        height = dims.get("height", dims.get("length", 1))
        depth = dims.get("depth", fallback)
        if all(is_number(v) for v in (width, height, depth)):
            return [num(width), num(height), num(depth)]
    return [1.0, 1.0, 1.0]


def capsule_profile() -> list[list[float]]:
    """buildWatertightCapsule(0.35, 0.7): hemispheres on a 0.7 cylinder, as a lathe profile."""
    radius, half, steps = 0.35, 0.35, 8
    points = [[0.0, num(-half - radius)]]
    for i in range(1, steps + 1):
        a = -math.pi / 2 + (math.pi / 2) * i / steps
        points.append([num(radius * math.cos(a)), num(-half + radius * math.sin(a))])
    for i in range(0, steps + 1):
        a = (math.pi / 2) * i / steps
        points.append([num(radius * math.cos(a)), num(half + radius * math.sin(a))])
    points[-1] = [0.0, num(half + radius)]
    return points


def unit_shape(primitive: str, descriptor: dict[str, Any], notes: list[str], where: str) -> dict[str, Any]:
    """The forge's unit-sized geometry for a primitive (geometry_for), as an ObjectSpec shape."""
    if primitive == "box":
        return {"type": "box", "size": [1.0, 1.0, 1.0]}
    if primitive in {"sphere", "ellipsoid"}:
        return {"type": "sphere", "radius": 0.5, "widthSegments": 32, "heightSegments": 16}
    if primitive == "cylinder":
        return {"type": "cylinder", "radiusTop": 0.5, "radiusBottom": 0.5, "height": 1.0, "segments": 32}
    if primitive == "cone":
        return {"type": "cylinder", "radiusTop": 0.0, "radiusBottom": 0.5, "height": 1.0, "segments": 32}
    if primitive == "capsule":
        notes.append(f"{where}: capsule built as a lathe of the same profile")
        return {"type": "lathe", "points": capsule_profile(), "segments": 32}
    if primitive == "torus":
        ratio = descriptor.get("torusTubeRatio")
        tube = 0.45 * float(ratio) if is_number(ratio) and ratio > 0 else DEFAULT_TORUS_TUBE
        return {"type": "torus", "radius": 0.45, "tube": num(tube), "radialSegments": 12, "tubularSegments": 48}
    if primitive == "plane-card":
        notes.append(f"{where}: plane card built as a thin box (two-sided)")
        return {"type": "box", "size": [1.0, 1.0, 0.002]}
    if primitive == "lathe":
        profile = descriptor.get("latheProfile") if isinstance(descriptor.get("latheProfile"), dict) else DEFAULT_LATHE_PROFILE
        raw = profile.get("points") if isinstance(profile.get("points"), list) else DEFAULT_LATHE_PROFILE["points"]
        points = [[num(max(0.0, p[0])), num(p[1])] for p in raw if isinstance(p, list) and len(p) == 2 and all(is_number(c) for c in p)]
        if len(points) < 2:
            raise EmitError(f"{where}: lathe profile needs at least two [radius, y] points")
        segments = profile.get("segments")
        return {"type": "lathe", "points": points, "segments": int(segments) if isinstance(segments, int) and 3 <= segments <= 256 else 24}
    raise EmitError(f"{where}: primitive {primitive!r} has no ObjectSpec shape yet")


def attachment_endpoint(attachment: Any) -> dict[str, Any] | None:
    """makeAttachmentEndpoint: start, end, radii; None when the two ends coincide."""
    if not isinstance(attachment, dict):
        return None
    start = vec(attachment.get("localStart"), (0.0, 0.0, 0.0))
    end = vec(attachment.get("localEnd"), (0.0, 1.0, 0.0))
    delta = [end[i] - start[i] for i in range(3)]
    length = math.sqrt(sum(d * d for d in delta))
    if length <= 0.0001:
        return None
    base_radius = max(0.005, float(attachment["baseRadius"]) if is_number(attachment.get("baseRadius")) else 0.06)
    end_radius = max(0.003, float(attachment["endRadius"]) if is_number(attachment.get("endRadius")) else base_radius * 0.55)
    direction = [d / length for d in delta]
    return {
        "start": start,
        "midpoint": [num(d / 2) for d in delta],
        "rotation": euler_xyz(quaternion_from_unit_vectors([0.0, 1.0, 0.0], direction)),
        "length": num(length),
        "baseRadius": num(base_radius),
        "endRadius": num(end_radius),
    }


# ----------------------------------------------------------------------------- the spec


def ordered_components(components: list[dict[str, Any]], warnings: list[str]) -> list[dict[str, Any]]:
    """Parents before children. An unknown parent hangs the part from the root, as the factory does."""
    by_id = {str(c.get("id")): c for c in components}
    done: set[str] = set()
    out: list[dict[str, Any]] = []

    def visit(component: dict[str, Any], trail: tuple[str, ...]) -> None:
        cid = str(component.get("id"))
        if cid in done:
            return
        if cid in trail:
            raise EmitError(f"component {cid!r}: parent chain loops ({' -> '.join(trail + (cid,))})")
        parent = component.get("parent")
        if parent is not None and str(parent) in by_id and str(parent) != cid:
            visit(by_id[str(parent)], trail + (cid,))
        elif parent not in (None, "root"):
            warnings.append(f"component {cid!r}: unknown parent {parent!r}; hung from the root")
        done.add(cid)
        out.append(component)

    for component in components:
        visit(component, ())
    return out


def emit(spec: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """The ObjectSpec for a sculpt spec, and the report."""
    components = [c for c in spec.get("componentTree", []) or [] if isinstance(c, dict)]
    if not components:
        raise EmitError("componentTree has no components")
    notes: list[str] = []
    warnings: list[str] = []

    unsupported = []
    for c in components:
        descriptor = c.get("geometryDescriptor") if isinstance(c.get("geometryDescriptor"), dict) else {}
        primitive = str(c.get("primitive") or "box")
        if descriptor.get("sdf") or descriptor.get("visualHull"):
            unsupported.append(f"{c.get('id')!r} (implicit or visual-hull surface)")
        elif primitive not in VALID_PRIMITIVES:
            unsupported.append(f"{c.get('id')!r} (unknown primitive {primitive!r})")
        elif primitive in UNSUPPORTED_PRIMITIVES and not (primitive in ATTACHMENT_PRIMITIVES and attachment_endpoint(c.get("attachment"))):
            unsupported.append(f"{c.get('id')!r} ({primitive})")
    if unsupported:
        raise EmitError("no ObjectSpec shape yet for: " + ", ".join(unsupported))

    source_materials: dict[str, dict[str, Any]] = {}
    for m in spec.get("materials", []) or []:
        if isinstance(m, dict) and m.get("id") is not None and str(m["id"]) not in source_materials:
            source_materials[str(m["id"])] = m

    material_ids = Ids()
    materials: dict[str, dict[str, Any]] = {}
    material_rows: list[dict[str, Any]] = []
    material_key: dict[str, str] = {}

    def use_material(source_id: Any, where: str) -> str:
        key = str(source_id) if source_id is not None else ""
        if key not in source_materials:
            if source_materials and not key:
                key = next(iter(source_materials))
            else:
                warnings.append(f"{where}: unknown material {source_id!r}; using the forge's fallback color")
                key = "__fallback__"
                source_materials.setdefault(key, {"id": "fallback", "baseColor": FALLBACK_COLOR, "roughness": 0.6})
        if key not in material_key:
            out_id = material_ids.take(source_materials[key].get("id"), "material")
            mapped, row = map_material(source_materials[key])
            materials[out_id] = mapped
            material_rows.append({"id": out_id, **row})
            material_key[key] = out_id
        return material_key[key]

    part_ids = Ids()
    component_part: dict[str, str] = {}
    parts: list[dict[str, Any]] = []
    sockets: list[dict[str, Any]] = []
    socket_ids_pending: list[tuple[str, dict[str, Any], str]] = []

    for c in ordered_components(components, warnings):
        cid = str(c.get("id"))
        where = f"component {cid!r}"
        pid = part_ids.take(cid, "part")
        component_part[cid] = pid
        transform = c.get("transform") if isinstance(c.get("transform"), dict) else {}
        descriptor = c.get("geometryDescriptor") if isinstance(c.get("geometryDescriptor"), dict) else {}
        primitive = str(c.get("primitive") or "box")
        if primitive == "instanced-cluster":
            base = descriptor.get("baseGeometry")
            primitive = base if isinstance(base, str) and base in VALID_PRIMITIVES and base != "instanced-cluster" else "box"
        if isinstance(c.get("subdivision"), dict) or descriptor.get("subdivision"):
            notes.append(f"{where}: subdivision smoothing is not represented")
        part: dict[str, Any] = {"id": pid}
        parent = c.get("parent")
        if parent is not None and str(parent) in component_part and str(parent) != cid:
            part["parent"] = component_part[str(parent)]
        endpoint = attachment_endpoint(c.get("attachment")) if primitive in ATTACHMENT_PRIMITIVES else None
        rotation = vec(transform.get("rotation"), (0.0, 0.0, 0.0))
        if endpoint is not None:
            part["shape"] = {
                "type": "cylinder",
                "radiusTop": endpoint["endRadius"],
                "radiusBottom": endpoint["baseRadius"],
                "height": endpoint["length"],
                "segments": 24,
            }
            part["position"] = endpoint["start"]
            part["rotation"] = rotation
            part["shapePosition"] = endpoint["midpoint"]
            part["shapeRotation"] = endpoint["rotation"]
            part["scale"] = [1.0, 1.0, 1.0]
        else:
            part["shape"] = unit_shape(primitive, descriptor, notes, where)
            part["position"] = vec(transform.get("position"), (0.0, 0.0, 0.0))
            part["rotation"] = rotation
            part["scale"] = scale_triple(c, transform, warnings, where)
            if any(s <= 0 for s in part["scale"]):
                raise EmitError(f"{where}: size factors must be positive, got {part['scale']}")
        part["material"] = use_material(c.get("material"), where)
        parts.append(part)
        profile = c.get("actionProfile") if isinstance(c.get("actionProfile"), dict) else {}
        for index, socket in enumerate(profile.get("sockets") or []):
            if isinstance(socket, dict):
                socket_ids_pending.append((pid, socket, f"{cid}-{socket.get('id') or f'socket-{index}'}"))

    # Repetition systems, as the factory builds them: radial rings of `count` copies.
    known = {str(c.get("id")) for c in components}
    for index, system in enumerate(spec.get("repetitionSystems", []) or []):
        if not isinstance(system, dict):
            continue
        name = str(system.get("id") or f"rep_{index}")
        elements = [str(e) for e in (system.get("elementComponentIds") or []) if e]
        if elements and all(e in known for e in elements):
            notes.append(f"repetition {name!r}: its parts are built individually; not repeated")
            continue
        count = int(system.get("count") or 0) if is_number(system.get("count") or 0) else 0
        if count <= 0:
            continue
        placement = system.get("placement") if isinstance(system.get("placement"), dict) else {}
        mode = str(placement.get("mode") or "radial")
        if mode != "radial":
            warnings.append(f"repetition {name!r}: placement mode {mode!r} is built as radial, as the factory does")
        primitive = str(system.get("primitive") or "box")
        if primitive not in VALID_PRIMITIVES or primitive in UNSUPPORTED_PRIMITIVES:
            primitive = "box"
        if primitive == "instanced-cluster":
            primitive = "box"
        parent_id = str(system.get("parent") or "root")
        material_source = system.get("material") if system.get("material") is not None else (next(iter(source_materials)) if source_materials else None)
        material = use_material(material_source, f"repetition {name!r}")
        scale = vec(system.get("instanceScale"), (0.1, 0.1, 0.1))
        if any(s <= 0 for s in scale):
            raise EmitError(f"repetition {name!r}: instanceScale must be positive")
        axis = normalize(vec(placement.get("axis"), (0.0, 0.0, 1.0)))
        radius = float(placement["radius"]) if is_number(placement.get("radius")) else 0.0
        start_deg = float(placement["startAngleDeg"]) if is_number(placement.get("startAngleDeg")) else 0.0
        seed = [0.0, 0.0, 1.0] if abs(axis[2]) < 0.9 else [1.0, 0.0, 0.0]
        perp = normalize(cross(axis, seed))
        shape = unit_shape(primitive, {}, notes, f"repetition {name!r}")
        for i in range(count):
            angle = (start_deg + (i * 360) / count) * math.pi / 180
            direction = rotate_about(perp, axis, angle)
            position = [num(d * radius * 0.5) for d in direction] if radius > 0 else [0.0, 0.0, 0.0]
            copy: dict[str, Any] = {"id": part_ids.take(f"{name}-{i + 1}", "copy")}
            if parent_id in component_part:
                copy["parent"] = component_part[parent_id]
            copy.update({
                "shape": shape,
                "material": material,
                "position": position,
                "rotation": euler_xyz(quaternion_from_unit_vectors([1.0, 0.0, 0.0], direction)),
                "scale": scale,
            })
            parts.append(copy)

    if len(parts) > MAX_PARTS:
        raise EmitError(f"{len(parts)} parts is more than an ObjectSpec holds ({MAX_PARTS})")

    for parent_pid, socket, raw_id in socket_ids_pending:
        sockets.append({
            "id": part_ids.take(raw_id, "socket"),
            "parent": parent_pid,
            "position": vec(socket.get("localPosition", socket.get("position")), (0.0, 0.0, 0.0)),
            "rotation": vec(socket.get("localRotation", socket.get("rotation")), (0.0, 0.0, 0.0)),
        })
    if len(sockets) > 64:
        warnings.append(f"{len(sockets)} sockets; kept the first 64")
        sockets = sockets[:64]

    object_id = slug(spec.get("targetId") or spec.get("targetName"), "object")
    name = str(spec.get("targetName") or object_id).strip()[:80] or object_id
    object_spec = {
        "format": FORMAT,
        "version": VERSION,
        "id": object_id,
        "name": name,
        "materials": materials,
        "parts": parts,
        "sockets": sockets,
    }
    report = {
        "source": {"targetId": spec.get("targetId"), "schemaVersion": spec.get("schemaVersion")},
        "parts": len(parts),
        "sockets": len(sockets),
        "materials": material_rows,
        "notes": notes,
        "warnings": warnings,
    }
    return object_spec, report


def dumps(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--spec", type=Path, required=True, help="the forge sculpt spec (object-sculpt-spec.json)")
    parser.add_argument("--out", type=Path, required=True, help="where to write the ObjectSpec JSON")
    parser.add_argument("--report", type=Path, default=None, help="where to write the report (default: beside --out)")
    args = parser.parse_args(argv)
    try:
        raw = args.spec.read_bytes()
        spec = json.loads(raw)
        if not isinstance(spec, dict):
            raise EmitError("the sculpt spec is not a JSON object")
        object_spec, report = emit(spec)
    except (OSError, json.JSONDecodeError, EmitError) as exc:
        print(f"lts-object-spec: {exc}", file=sys.stderr)
        return 2
    report["source"]["specSha256"] = hashlib.sha256(raw).hexdigest()
    report_path = args.report or args.out.with_name(args.out.stem + ".report.json")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(dumps(object_spec), encoding="utf-8")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(dumps(report), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
