import { vendorCredits } from "@hedronite/lts-core";
import { describe, expect, it } from "vitest";
import { loadRegistry } from "./index.js";

describe("the origins of the registered assets", () => {
  const origins = loadRegistry()
    .list()
    .flatMap((asset) => (asset.origin === undefined ? [] : [{ id: asset.id, origin: asset.origin }]));

  it("are there to check", () => {
    expect(origins.length).toBeGreaterThan(0);
  });

  it.each(origins.map(({ id, origin }) => [id, origin] as const))("%s names how it stands to its source, and a vendored folder whose credit the package holds", (_, origin) => {
    expect(["ported", "adopted", "inspired"]).toContain(origin.relation);
    expect(vendorCredits[origin.vendor]).toBeDefined();
  });
});
