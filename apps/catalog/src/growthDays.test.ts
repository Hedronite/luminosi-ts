import { assetKinds, type AssetMeta } from "@hedronite/lts-core";
import { describe, expect, it } from "vitest";
import { byNewest, growth } from "./growthDays.js";

const asset = (id: string, kind: AssetMeta["kind"], added?: string): AssetMeta => ({
  id,
  kind,
  name: id,
  tags: [],
  version: "0.1.0",
  ...(added === undefined ? {} : { added }),
});

const assets = [asset("a", "icon", "2026-11-10"), asset("b", "primitive", "2026-11-15"), asset("c", "icon", "2026-11-15"), asset("d", "icon")];

describe("growth", () => {
  it("groups by day, newest first, with counts per kind, and skips undated assets", () => {
    const days = growth(assets, assetKinds);
    expect(days.map((d) => d.date)).toEqual(["2026-11-15", "2026-11-10"]);
    expect(days[0]?.byKind).toEqual([
      ["icon", 1],
      ["primitive", 1],
    ]);
    expect(days.flatMap((d) => d.assets).map((a) => a.id)).not.toContain("d");
  });
});

describe("byNewest", () => {
  it("puts the newest first and keeps order within a day", () => {
    expect(byNewest(assets).map((a) => a.id)).toEqual(["b", "c", "a", "d"]);
  });
});
