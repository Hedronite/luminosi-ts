import { hedronite } from "@hedronite/lts-tokens";
import { NodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { descriptors } from "./descriptors.js";
import { effectSchemas, isEffectId } from "./info.js";

const find = (id: string) => {
  const descriptor = descriptors.find((candidate) => candidate.meta.id === id);
  if (descriptor === undefined) throw new Error(`no descriptor for ${id}`);
  return descriptor;
};

describe("shader descriptors, built", () => {
  it("build every shader with its default parameters, in the neutral colors or the palette given", async () => {
    const cases = descriptors.flatMap((descriptor) => [undefined, hedronite.scene].map((palette) => ({ descriptor, palette })));
    await Promise.all(
      cases.map(async ({ descriptor, palette }) => {
        const material = await descriptor.build({}, palette);
        expect(material).toBeInstanceOf(NodeMaterial);
        material.dispose();
      }),
    );
  });

  it("take each shader's own schema, defaults and bounds", () => {
    for (const descriptor of descriptors) {
      const { id } = descriptor.meta;
      if (!isEffectId(id)) throw new Error(`${id} is not an effect`);
      expect(descriptor.parameters).toBe(effectSchemas[id]);
    }
    expect(find("fresnel-glow").defaults).toEqual({ power: 2.5, intensity: 2 });
    expect(find("fresnel-glow").fields.find((field) => field.key === "power")).toMatchObject({ type: "number", min: 0.5, max: 8, default: 2.5 });
    expect(find("fresnel-glow").fields.find((field) => field.key === "base")).toMatchObject({ type: "color", optional: true });
    expect(find("dissolve").fields.find((field) => field.key === "progress")).toMatchObject({ optional: true });
  });

  it("build with the parameters given, and refuse ones outside the schema", async () => {
    const material = await find("fresnel-glow").build({ power: 5, glow: "#ff0000" });
    expect(material).toBeInstanceOf(NodeMaterial);
    material.dispose();
    await expect(find("fresnel-glow").build({ power: 99 })).rejects.toThrow(z.ZodError);
    await expect(find("toon").build({ bands: 1.5 })).rejects.toThrow(z.ZodError);
  });

  it("show the id in the snippet", () => {
    expect(find("toon").snippets()[0]?.code).toContain('createEffectMaterial("toon")');
  });
});
