import { createRegistry, registerManifest } from "@hedronite/lts-core";
import { describe, expect, it } from "vitest";
import * as icons from "./index.js";
import { allIcons, manifest } from "./manifest.js";
import { iconToSvg } from "./svg.js";

const pathData = /^[Mm][\d\s.,eE+\-MmLlHhVvCcSsQqTtAaZz]*$/;

describe("icon set", () => {
  it("has between 20 and 200 icons, each with a name and path data", () => {
    expect(allIcons.length).toBeGreaterThanOrEqual(20);
    expect(allIcons.length).toBeLessThanOrEqual(200);
    for (const icon of allIcons) {
      expect(icon.name.length).toBeGreaterThan(0);
      expect(icon.paths.length).toBeGreaterThan(0);
      for (const d of icon.paths) expect(d).toMatch(pathData);
    }
  });

  it("keeps ids unique and sorted", () => {
    const ids = allIcons.map((icon) => icon.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it("registers its manifest with the core registry, one asset per icon", () => {
    const registry = createRegistry();
    registerManifest(registry, manifest);
    expect(registry.list({ kind: "icon" }).map((a) => a.id)).toEqual(allIcons.map((icon) => icon.id));
    expect(registry.get("arrow-right")?.package).toBe("@hedronite/lts-icons");
  });

  it("exports every icon by name from the package root", () => {
    const exported = new Set(Object.values(icons).filter((v) => typeof v === "object"));
    for (const icon of allIcons) expect(exported.has(icon)).toBe(true);
  });
});

describe("iconToSvg", () => {
  it("renders a decorative icon hidden from assistive technology", () => {
    const svg = iconToSvg(icons.check);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toContain("<title>");
  });

  it("names a titled icon and escapes the title", () => {
    const svg = iconToSvg(icons.check, { title: 'Done <now> & "ok"', size: 32, strokeWidth: 1.5 });
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>Done &lt;now&gt; &amp; &quot;ok&quot;</title>");
    expect(svg).toContain('width="32"');
    expect(svg).toContain('stroke-width="1.5"');
  });
});
