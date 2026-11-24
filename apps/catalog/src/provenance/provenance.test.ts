import type { AssetOrigin, VendorProvenance } from "@hedronite/lts-core";
import { describe, expect, it } from "vitest";
import { relationWords, sourceOf } from "./provenance";

const folder: VendorProvenance = {
  license: "MIT",
  licenseIds: ["MIT"],
  policies: [{ class: "adopt-with-attribution", spdx: "MIT", files: [], fileCount: 2 }],
  totalFiles: 2,
  fetched: true,
  transformations: [],
  sources: [
    { repo: "https://github.com/one/first", commit: "a".repeat(40) },
    { repo: "https://github.com/two/second", commit: "b".repeat(40) },
  ],
  vendoredOn: "2026-11",
  reviewer: "someone",
};
const one = { ...folder, sources: [folder.sources[0] ?? { repo: "", commit: "" }] };
const origin = (fields: Partial<AssetOrigin>): AssetOrigin => ({ vendor: "folder", relation: "ported", path: "src/a.ts", ...fields });

describe("the repository a ported path came from", () => {
  it("is the source at the origin's commit, not the folder's first one", () => {
    expect(sourceOf(origin({ commit: "b".repeat(40) }), folder)).toEqual({ repo: "https://github.com/two/second", commit: "b".repeat(40) });
  });
  it("is nothing when the origin names a commit the folder does not have", () => {
    expect(sourceOf(origin({ commit: "c".repeat(40) }), folder)).toBeUndefined();
  });
  it("is the folder's one source when the origin names no commit", () => {
    expect(sourceOf(origin({}), one)?.repo).toBe("https://github.com/one/first");
  });
  it("is nothing when the folder has several sources and the origin names no commit, rather than one of them", () => {
    expect(sourceOf(origin({}), folder)).toBeUndefined();
  });
  it("is nothing when the folder names no repository at all", () => {
    expect(sourceOf(origin({}), { ...folder, sources: [] })).toBeUndefined();
  });
  it("names each relation the way the credit labels do", () => {
    expect(Object.values(relationWords).map((words) => words.split(":")[0])).toEqual(["Ported", "Adopted", "Inspired by"]);
  });
});
