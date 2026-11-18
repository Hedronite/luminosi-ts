import { describe, expect, it } from "vitest";
import { z } from "zod";
import { descriptors } from "./descriptors.js";
import { isScreenEffectId, screenEffectSchemas } from "./effects.js";

const find = (id: string) => {
  const descriptor = descriptors.find((candidate) => candidate.meta.id === id);
  if (descriptor === undefined) throw new Error(`no descriptor for ${id}`);
  return descriptor;
};

describe("screen effect descriptors, built", () => {
  it("build a step that puts the effect over a scene, for every effect", async () => {
    // A ScreenEffects needs a renderer, which this test does not have, so the step is built and not run.
    const steps = await Promise.all(descriptors.map((descriptor) => descriptor.build()));
    expect(steps).toHaveLength(descriptors.length);
    for (const step of steps) expect(step).toBeTypeOf("function");
  });

  it("take each effect's own schema, defaults and bounds", () => {
    for (const descriptor of descriptors) {
      const { id } = descriptor.meta;
      if (!isScreenEffectId(id)) throw new Error(`${id} is not a screen effect`);
      expect(descriptor.parameters).toBe(screenEffectSchemas[id]);
    }
    expect(find("scan").defaults).toEqual({ period: 9, sweep: 1.8, depth: 2 });
    expect(find("scan").fields.find((field) => field.key === "period")).toMatchObject({ type: "number", min: 1, max: 60, default: 9 });
    expect(find("scan").fields.find((field) => field.key === "depth")).toMatchObject({ type: "choice", options: [1, 2] });
    expect(find("ascii").fields.find((field) => field.key === "ramp")).toMatchObject({ type: "string" });
  });

  it("refuse parameters outside the schema", async () => {
    await expect(find("scan").build({ period: 0 })).rejects.toThrow(z.ZodError);
    await expect(find("scan").build({ depth: 3 })).rejects.toThrow(z.ZodError);
  });

  it("write both snippets with the id", () => {
    const snippets = find("lens").snippets();
    expect(snippets.map((snippet) => snippet.label)).toEqual(["TypeScript", "React"]);
    expect(snippets[0]?.code).toContain('[{ id: "lens" }]');
    expect(snippets[1]?.code).toContain('const stack = [{ id: "lens" }] as const;');
  });
});
