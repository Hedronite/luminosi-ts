import { vendorCredits } from "@hedronite/lts-core";
import { describe, expect, it } from "vitest";
import { loadRegistry } from "./index.js";

describe("the origins of the registered assets", () => {
  const origins = loadRegistry()
    .list()
    .flatMap((asset) => (asset.origin === undefined ? [] : [{ id: asset.id, origin: asset.origin }]));

  it("are the CRT effect and the soap film, both ported", () => {
    expect(origins.map(({ id, origin }) => [id, origin.relation]).toSorted()).toEqual([
      ["crt", "ported"],
      ["soap-film", "ported"],
    ]);
  });

  it.each(origins.map(({ id, origin }) => [id, origin.vendor] as const))("%s names a vendored folder whose credit the package holds", (_, vendor) => {
    expect(vendorCredits[vendor]).toBeDefined();
  });
});
