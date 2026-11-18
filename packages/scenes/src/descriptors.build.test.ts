import { hedronite } from "@hedronite/lts-tokens";
import { describe, expect, it } from "vitest";
import { descriptors } from "./descriptors.js";

describe("scene kit descriptors, built", () => {
  it("build every kit as a named group of lights and shapes", async () => {
    await Promise.all(
      descriptors.map(async (descriptor) => {
        const group = await descriptor.build({}, hedronite.scene);
        expect(group.name).toBe(descriptor.meta.id);
        expect(group.children.length).toBeGreaterThan(0);
      }),
    );
  });

  it("name the kit, not the asset id, in the snippet", () => {
    for (const descriptor of descriptors) {
      expect(descriptor.snippets()[0]?.code).toContain(`createSceneKit("${descriptor.meta.id.replace(/^scene-/, "")}")`);
    }
  });
});
