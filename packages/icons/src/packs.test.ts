import { beforeAll, describe, expect, it } from "vitest";
import { packIconToSvg, paintAttributes } from "./pack.js";
import { iconPacks, loadIconPack } from "./packs/index.js";

const viewBox = /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/;
const pathData =/^[Mm][\d\s.,eE+\-MmLlHhVvCcSsQqTtAaZz]*$/;
const colors = /^(currentColor|none|#[0-9a-fA-F]{3,8})$/;

describe("icon packs", () => {
  it("list every pack with a license, a credit and a source", () => {
    expect(iconPacks.map((p) => p.id)).toEqual(Object.keys(loadIconPack));
    for (const pack of iconPacks) {
      expect(pack.license).toMatch(/^(ISC|MIT|CC-BY-4\.0)$/);
      expect(pack.credit.length).toBeGreaterThan(0);
      expect(pack.source).toMatch(/^https:\/\//);
      expect(pack.count).toBeGreaterThan(0);
    }
  });

  // A pack is a module of megabytes of data, and loading it (reading and transforming the file) takes longer on a CI runner than checking it.
  // Each pack is loaded before its test, so the test is the check.
  describe.each(iconPacks.map((p) => [p.id]))("%s", (id) => {
    let loaded: Awaited<ReturnType<NonNullable<(typeof loadIconPack)[string]>>> | undefined;
    beforeAll(async () => {
      const load = loadIconPack[id];
      if (load === undefined) throw new Error(`no loader for ${id}`);
      loaded = await load();
    });

    it("has every icon with a valid grid, path data and paint, and ids and names that are unique", () => {
      if (loaded === undefined) throw new Error(`${id} was not loaded`);
      const { pack, icons } = loaded;
      expect(icons).toHaveLength(pack.count);
      expect(new Set(icons.map((i) => i.id)).size).toBe(icons.length);
      expect(new Set(icons.map((i) => i.importName)).size).toBe(icons.length);
      // A pack holds thousands of icons and each has a handful of checks, so the checks are plain tests and one `expect` reads what they found:
      // an `expect` call per check costs more than the check. A failure still names the icon and what is wrong with it.
      const problems: string[] = [];
      for (const icon of icons) {
        if (!viewBox.test(icon.viewBox)) problems.push(`${icon.id}: viewBox "${icon.viewBox}"`);
        if (icon.paths.length === 0) problems.push(`${icon.id}: no paths`);
        for (const paint of [icon.paint, ...icon.paths]) {
          for (const key of ["fill", "stroke"] as const) {
            const value = paint[key];
            if (value !== undefined && !colors.test(value)) problems.push(`${icon.id}: ${key}=${value}`);
          }
        }
        for (const path of icon.paths) if (!pathData.test(path.d)) problems.push(`${icon.id}: path data "${path.d.slice(0, 40)}"`);
      }
      expect(problems).toEqual([]);
    });
  });
});

describe("rendering a pack icon", () => {
  const icon = {
    id: "box",
    name: "Box",
    importName: "box",
    viewBox: "0 0 512 512",
    paint: { fill: "none", stroke: "currentColor", strokeWidth: "32" },
    paths: [{ d: "M0 0h10v10H0z", fill: "currentColor", fillRule: "evenodd" as const }],
  };

  it("as an SVG string, with the icon's grid and each path's paint", () => {
    const svg = packIconToSvg(icon, { size: 32, title: "Box & co" });
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain('stroke-width="32"');
    expect(svg).toContain('<path d="M0 0h10v10H0z" fill="currentColor" fill-rule="evenodd"/>');
    expect(svg).toContain("<title>Box &amp; co</title>");
    expect(svg).toContain('role="img"');
    expect(Object.keys(paintAttributes)).toContain("strokeOpacity");
  });

});
