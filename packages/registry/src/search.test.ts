import { assetKinds, type AssetMeta } from "@hedronite/lts-core";
import { describe, expect, it } from "vitest";
import { filterAssets, kindCounts, rankAssets } from "./search.js";

const asset = (id: string, kind: AssetMeta["kind"], tags: string[] = []): AssetMeta => ({
  id,
  kind,
  name: id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
  tags,
  version: "0.1.0",
});

const assets = [asset("arrow-right", "icon", ["navigation"]), asset("cube", "primitive", ["geometry"]), asset("check", "icon", ["status"])];

describe("filterAssets", () => {
  it("returns everything for an empty query", () => {
    expect(filterAssets(assets, { text: "  ", kind: "all" })).toEqual(assets);
  });

  it("matches name, id and tags, case-insensitively", () => {
    expect(filterAssets(assets, { text: "ARROW", kind: "all" }).map((a) => a.id)).toEqual(["arrow-right"]);
    expect(filterAssets(assets, { text: "geometry", kind: "all" }).map((a) => a.id)).toEqual(["cube"]);
  });

  it("requires every word to match", () => {
    expect(filterAssets(assets, { text: "arrow status", kind: "all" })).toEqual([]);
  });

  it("filters by kind", () => {
    expect(filterAssets(assets, { text: "", kind: "icon" }).map((a) => a.id)).toEqual(["arrow-right", "check"]);
  });
});

describe("kindCounts", () => {
  it("lists only the kinds present, in catalog order, with counts", () => {
    expect(kindCounts(assets, assetKinds)).toEqual([
      ["icon", 2],
      ["primitive", 1],
    ]);
  });
});

describe("rankAssets", () => {
  it("ranks an exact id first, then names, prefixes, words and tags", () => {
    const pool = [asset("cube-outline", "icon", ["geometry"]), asset("cube", "primitive", ["platonic"]), asset("ice-cube-tray", "object", ["kitchen"])];
    expect(rankAssets(pool, "cube").map((r) => [r.asset.id, r.score])).toEqual([
      ["cube", 100],
      ["cube-outline", 60],
      ["ice-cube-tray", 40],
    ]);
  });

  it("filters by kind and matches nothing for empty text", () => {
    expect(rankAssets(assets, "arrow", "primitive")).toEqual([]);
    expect(rankAssets(assets, "  ")).toEqual([]);
  });
});
