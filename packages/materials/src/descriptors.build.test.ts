import { hedronite, neutral } from "@hedronite/lts-tokens";
import { describe, expect, it } from "vitest";
import { descriptors } from "./descriptors.js";
import { isMaterialId } from "./presets.js";
import { createMaterial } from "./three.js";

describe("material descriptors, built", () => {
  it("build every preset as createMaterial does, in the neutral colors or the palette given", async () => {
    const cases = descriptors.flatMap((descriptor) => [undefined, hedronite.scene].map((palette) => ({ descriptor, palette })));
    await Promise.all(
      cases.map(async ({ descriptor, palette }) => {
        const { id } = descriptor.meta;
        if (!isMaterialId(id)) throw new Error(`${id} is not a material preset`);
        const material = await descriptor.build({}, palette);
        const direct = createMaterial(id, palette ?? neutral.scene);
        expect(material.name).toBe(id);
        expect(material.color.getHex()).toBe(direct.color.getHex());
        expect(material.roughness).toBe(direct.roughness);
        material.dispose();
        direct.dispose();
      }),
    );
  });

  it("have no parameters yet, and say so", () => {
    for (const descriptor of descriptors) {
      expect(descriptor.fields).toEqual([]);
      expect(descriptor.defaults).toEqual({});
    }
  });

  it("show the id in the snippet", () => {
    expect(descriptors.find((descriptor) => descriptor.meta.id === "glass")?.snippets()[0]?.code).toContain('createMaterial("glass", hedronite.scene)');
  });
});
