import { describe, expect, it } from "vitest";
import { z } from "zod";
import { descriptors } from "./descriptors.js";

const cube = descriptors.find((descriptor) => descriptor.meta.id === "platonic-cube");
if (cube === undefined) throw new Error("no cube descriptor");

describe("primitive descriptors, built", () => {
  it("build every primitive's geometry under its id", async () => {
    await Promise.all(
      descriptors.map(async (descriptor) => {
        const geometry = await descriptor.build();
        expect(geometry.name).toBe(descriptor.meta.id);
        expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
        geometry.dispose();
      }),
    );
  });

  it("scale the solid about its centre", async () => {
    const size = async (params?: unknown): Promise<number> => {
      const geometry = await cube.build(params);
      geometry.computeBoundingBox();
      return geometry.boundingBox?.max.x ?? 0;
    };
    const unit = await size();
    expect(await size({ scale: 2 })).toBeCloseTo(unit * 2, 6);
    expect(await size({ scale: 1 })).toBeCloseTo(unit, 6);
  });

  it("take the parameter's bounds from the schema", async () => {
    await expect(cube.build({ scale: 10 })).rejects.toThrow(z.ZodError);
    expect(cube.fields).toEqual([expect.objectContaining({ key: "scale", label: "Size", type: "number", min: 0.25, max: 4, step: 0.05, default: 1, group: "Shape" })]);
  });

  it("write the snippet for the scale in use", () => {
    expect(cube.snippets()[0]?.code).toContain('createPolyhedronGeometry(primitive("platonic-cube"));\nconst mesh = new Mesh(');
    expect(cube.snippets({ scale: 1.5 })[0]?.code).toContain("geometry.scale(1.5, 1.5, 1.5);\nconst mesh = new Mesh(");
  });
});
