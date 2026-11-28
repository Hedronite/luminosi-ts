import { createFinishedMaterial } from "@hedronite/lts-materials/finished";
import { describe, expect, it } from "vitest";

describe("@hedronite/lts-materials/finished", () => {
  it("resolves the workspace subpath export", () => {
    const handle = createFinishedMaterial("matte", "grain");
    expect(handle.id).toBe("grain");
    handle.dispose();
  });
});