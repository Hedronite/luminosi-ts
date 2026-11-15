import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createObjectFromSpec, parseObjectSpec, shadeHex, type ObjectSpec } from "@hedronite/lts-objects";
import { disposeObject } from "@hedronite/lts-primitives";
import { neutral } from "@hedronite/lts-tokens";
import { Box3, Vector3, type Object3D } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

// The Python emitter's output, checked by the TypeScript side that consumes it.

const tool = join(import.meta.dirname, "..");
const emitter = join(tool, "plugin", "emit_object_spec.py");
const out = mkdtempSync(join(tmpdir(), "lts-object-spec-"));
afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

const reportSchema = z.object({
  parts: z.number(),
  materials: z.array(z.object({ id: z.string(), color: z.enum(["base", "accent", "metal", "glass", "emissive"]), shade: z.number(), neutralResult: z.string() })),
  warnings: z.array(z.string()),
});

function emit(source: string): { spec: ObjectSpec; report: z.output<typeof reportSchema> } {
  const name = source.replace(/\W+/g, "-");
  const target = join(out, `${name}.json`);
  const result = spawnSync("python3", ["-I", emitter, "--spec", source, "--out", target], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`emitter failed: ${result.stderr}`);
  const spec: unknown = JSON.parse(readFileSync(target, "utf8"));
  const report: unknown = JSON.parse(readFileSync(join(out, `${name}.report.json`), "utf8"));
  return { spec: parseObjectSpec(spec), report: reportSchema.parse(report) };
}

const named = (root: Object3D, name: string): Object3D => {
  const object = root.getObjectByName(name);
  if (object === undefined) throw new Error(`no object named ${name}`);
  return object;
};

/** A part's shape: the mesh inside its pivot. */
const shapeOf = (root: Object3D, id: string): Object3D => {
  const shape = named(root, id).children.find((child) => child.name === id);
  if (shape === undefined) throw new Error(`no shape for ${id}`);
  return shape;
};

const center = (object: Object3D): readonly number[] => new Box3().setFromObject(object).getCenter(new Vector3()).toArray();

const lamp = join(tool, "fixtures", "your-desk-lamp.sculpt.json");
const conformance = join(tool, "upstream", "forge", "tests", "fixtures", "reference_target_conformance_spec.json");

describe("the lts-object-spec emitter", () => {
  it("measures shades against the same neutral palette the library ships", () => {
    const result = spawnSync("python3", ["-I", "-c", `import sys; sys.path.insert(0, ${JSON.stringify(join(tool, "plugin"))}); import json, emit_object_spec as e; print(json.dumps(e.NEUTRAL_SCENE))`], { encoding: "utf8" });
    const palette: unknown = JSON.parse(result.stdout);
    expect(palette).toEqual({ ...neutral.scene });
  });

  it.each([
    ["the desk lamp sample", lamp],
    ["the upstream conformance spec", conformance],
  ])("turns %s into a valid ObjectSpec that builds and frees", (_, source) => {
    const { spec, report } = emit(source);
    expect(spec.parts).toHaveLength(report.parts);
    const root = createObjectFromSpec(spec, { palette: neutral.scene });
    expect(new Box3().setFromObject(root).isEmpty()).toBe(false);
    disposeObject(root);
  });

  it("reports shades that shadeHex reproduces exactly", () => {
    for (const source of [lamp, conformance]) {
      for (const row of emit(source).report.materials) {
        expect(shadeHex(neutral.scene[row.color], row.shade)).toBe(row.neutralResult);
      }
    }
  });

  it("places the lamp's parts where the sculpt spec puts them", () => {
    const { spec, report } = emit(lamp);
    expect(report.warnings).toEqual([]);
    const root = createObjectFromSpec(spec);
    root.updateMatrixWorld(true);
    // The base: a 0.6-wide, 0.06-tall disc resting on the floor.
    const base = new Box3().setFromObject(shapeOf(root, "base"));
    expect(base.max.x - base.min.x).toBeCloseTo(0.6, 5);
    expect(base.min.y).toBeCloseTo(0, 5);
    expect(base.max.y).toBeCloseTo(0.06, 5);
    // The arm runs from the stem's 0.54 mark (world y 0.6) out to (0.3, 0.8); its middle is halfway.
    const [ax, ay, az] = center(shapeOf(root, "arm"));
    expect(ax).toBeCloseTo(0.15, 3);
    expect(ay).toBeCloseTo(0.7, 3);
    expect(az).toBeCloseTo(0, 3);
    // The shade hangs from the arm's pivot, not from its tilted, offset shape.
    const shade = named(root, "shade").getWorldPosition(new Vector3());
    expect(shade.toArray().map((v) => Math.round(v * 1e4) / 1e4)).toEqual([0.3, 0.72, 0]);
    // Three feet in a ring of radius 0.25 under the base.
    const feet = spec.parts.filter((p) => p.id.startsWith("foot-ring-"));
    expect(feet).toHaveLength(3);
    for (const foot of feet) {
      expect(Math.hypot(...foot.position)).toBeCloseTo(0.25, 6);
    }
    expect(spec.sockets.map((s) => s.id)).toEqual(["base-cable-exit"]);
    disposeObject(root);
  });

  it("maps the lamp's materials onto presets and palette slots", () => {
    const { spec } = emit(lamp);
    expect(spec.materials["base-metal"]).toMatchObject({ preset: "metal-brushed", color: "metal" });
    expect(spec.materials["shade-fabric"]).toMatchObject({ preset: "matte", color: "accent" });
    expect(spec.materials["bulb-glow"]).toMatchObject({ preset: "emissive", color: "emissive" });
  });
});
