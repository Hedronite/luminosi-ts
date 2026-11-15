import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boundaries, budgets, iconPacks, kinds, list, newIcon, packages, root, search, show } from "./commands.js";

const data = (envelope: ReturnType<typeof kinds>): unknown => (envelope.ok ? envelope.data : undefined);

describe("read commands", () => {
  it("lists the icon packs with their licenses and import paths", () => {
    const text = JSON.stringify(data(iconPacks()));
    expect(text).toContain('"id":"lucide"');
    expect(text).toContain('"license":"ISC"');
    expect(text).toContain('"import":"@hedronite/lts-icons/packs/lucide"');
  });

  it("counts every kind", () => {
    const result = kinds();
    expect(result.ok).toBe(true);
    expect(JSON.stringify(data(result))).toMatch(/"icon":\d+/);
  });

  it("searches by name, best match first", () => {
    const result = search("crystal", { limit: 5 });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(data(result))).toContain('"id":"crystal-cluster"');
  });

  it("shows an asset with its package and snippets", () => {
    const result = show("platonic-icosahedron");
    expect(result.ok).toBe(true);
    const text = JSON.stringify(data(result));
    expect(text).toContain('"package":"@hedronite/lts-primitives"');
    expect(text).toContain('primitive(\\"platonic-icosahedron\\")');
  });

  it("answers an unknown id with the closest matches", () => {
    const result = show("platonic-icosahedrn");
    expect(result).toMatchObject({ ok: false, kind: "unknown_asset", exit: 1 });
    expect(JSON.stringify(result)).toMatch(/"matches":\[[^\]]*"platonic-icosahedron"/);
  });

  it("lists by kind and rejects an unknown kind as a usage error", () => {
    const icons = list({ kind: "icon", limit: 500 });
    expect(JSON.stringify(data(icons))).toMatch(/"total":\d{2,}/);
    expect(list({ kind: "sound" })).toMatchObject({ ok: false, kind: "usage", exit: 2 });
  });

  it("summarizes packages with their exports", () => {
    const text = JSON.stringify(data(packages()));
    expect(text).toContain('"name":"@hedronite/lts-icons"');
    expect(text).toContain('"./react"');
  });

  it("reads the import rules from the dependency-cruiser config", () => {
    expect(JSON.stringify(data(boundaries()))).toContain('"name":"no-circular"');
  });

  it("reports budgets after a build, or says it needs one", () => {
    const text = JSON.stringify(budgets());
    expect(text.includes('"id":"crystal-cluster-glb"') || text.includes('"kind":"not_built"')).toBe(true);
  });
});

describe("newIcon", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';
  const base = { name: "Dash", tags: ["action"], svg, dryRun: true, today: "2026-11-15" };

  it("plans a new icon without writing anything on a dry run", () => {
    const result = newIcon("lumin-test-dash", base);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(data(result))).toContain('"svgPath":"assets/src/icons/lumin-test-dash.svg"');
    expect(existsSync(join(root, "assets/src/icons/lumin-test-dash.svg"))).toBe(false);
  });

  it.each([
    ["Bad Id", base, "usage"],
    ["check", base, "exists"],
    ["lumin-test-a", { ...base, svg: svg.replace("0 0 24 24", "0 0 32 32") }, "invalid"],
    ["lumin-test-b", { ...base, svg: svg.replace("<path", "<g><path").replace("</svg>", "</g></svg>") }, "invalid"],
    ["lumin-test-c", { ...base, svg: svg.replace("<path", '<path fill="red"') }, "invalid"],
    ["lumin-test-d", { ...base, tags: [] }, "usage"],
  ] as const)("refuses %s with %s", (id, options, kind) => {
    expect(newIcon(id, options)).toMatchObject({ ok: false, kind });
  });
});
