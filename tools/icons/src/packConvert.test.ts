import { describe, expect, it } from "vitest";
import { convertSvg, humanize, importName, normalizeColor, svgFromTsx } from "./packConvert.js";

describe("convertSvg", () => {
  it("keeps a Lucide icon's root stroke as the icon's paint, shapes as paths", () => {
    const icon = convertSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="4" y="4" width="16" height="10" rx="2"/></svg>',
      "lucide/sample",
    );
    expect(icon.viewBox).toBe("0 0 24 24");
    expect(icon.paint).toEqual({ fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" });
    expect(icon.paths.length).toBeGreaterThanOrEqual(1);
    for (const path of icon.paths) expect(path.d).toMatch(/^[Mm]/);
  });

  it("keeps a mixed Famicons icon's per-path fill and stroke, with black as currentColor", () => {
    const icon = convertSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle fill="none" stroke="#000" stroke-width="32" cx="256" cy="56" r="40"/><path d="M10 10h100v100H10z"/></svg>',
      "famicons/sample",
    );
    expect(icon.viewBox).toBe("0 0 512 512");
    expect(icon.paths.some((p) => p.fill === "none" && p.stroke === "currentColor" && p.strokeWidth === "32")).toBe(true);
    expect(icon.paths.some((p) => p.stroke === undefined)).toBe(true);
  });

  it("reads paint from inline styles, as Famicons writes its outlines", () => {
    const icon = convertSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><line x1="256" y1="112" x2="256" y2="400" style="fill:none;stroke:#000;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px"/></svg>',
      "famicons/add-outline",
    );
    expect(icon.paths[0]).toMatchObject({ fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "32" });
  });

  it("lets an inline style beat a presentation attribute", () => {
    const icon = convertSvg('<svg viewBox="0 0 24 24"><path d="M0 0h4v4H0z" fill="red" style="fill:#000"/></svg>', "x/style");
    expect(icon.paths[0]?.fill).toBe("currentColor");
  });

  it("reads CoreUI's CSS-variable color as currentColor", () => {
    const icon = convertSvg('<svg viewBox="0 0 512 512"><path fill="var(--ci-primary-color, currentcolor)" d="M0 0h10v10H0z"/></svg>', "coreui/sample");
    expect(icon.paths[0]?.fill).toBe("currentColor");
  });

  it("keeps an isocons icon's black strokes as currentColor and its own grid", () => {
    const icon = convertSvg('<svg width="103" height="101" viewBox="0 0 103 101" fill="none"><path d="M1 1L50 50" stroke="black" stroke-width="2" stroke-linecap="round"/></svg>', "isocons/sample");
    expect(icon.viewBox).toBe("0 0 103 101");
    expect(icon.paths[0]).toMatchObject({ stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" });
  });

  it("pushes a group's paint down onto its paths, multiplying opacity", () => {
    const icon = convertSvg(
      '<svg viewBox="0 0 24 24"><g fill="#000" opacity=".5"><path d="M0 0h4v4H0z" opacity=".5"/><path d="M10 10h4v4h-4z"/></g><path d="M20 20h2v2h-2z"/></svg>',
      "stash/sample",
    );
    const opacities = icon.paths.map((p) => p.opacity);
    expect(opacities).toContain("0.25");
    expect(opacities).toContain(".5");
    expect(icon.paths.at(-1)?.opacity).toBeUndefined();
  });

  it("refuses what it can't keep, naming the icon", () => {
    expect(() => convertSvg('<svg viewBox="0 0 24 24"><text>hi</text></svg>', "x/text")).toThrow(/x\/text/);
    expect(() => convertSvg("<svg><path d=\"M0 0h1\"/></svg>", "x/no-viewbox")).toThrow(/viewBox/);
    // Root attributes are read from the source as written (SVGO already drops invalid values on paths).
    expect(() => convertSvg('<svg viewBox="0 0 24 24" stroke-linecap="wobbly"><path d="M0 0h1"/></svg>', "x/cap")).toThrow(/stroke-linecap/);
  });

  it("does not mistake stroke-width for a rectangle's width", () => {
    const icon = convertSvg('<svg viewBox="0 0 24 24"><rect x="2" y="7" width="19" height="10" rx="3" stroke="#000" stroke-width="1.5"/></svg>', "stash/rect");
    expect(icon.paths[0]?.strokeWidth).toBe("1.5");
  });
});

describe("svgFromTsx", () => {
  it("pulls the plain SVG out of a Stash component", () => {
    const tsx = `export const AirplaneIcon = React.forwardRef<SVGSVGElement, IconProps>(({ color = 'currentColor', ...props }, forwardedRef) => {
      return (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props} ref={forwardedRef}>
        <path d="M0 0h10v10H0z" fill={color} fillRule="evenodd" clipRule="evenodd" opacity={0.4}/>
      </svg>);
    });`;
    const svg = svgFromTsx(tsx, "stash/airplane");
    expect(svg).not.toMatch(/props|forwardedRef|\{/);
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('opacity="0.4"');
    expect(convertSvg(svg, "stash/airplane").paths[0]).toMatchObject({ fill: "currentColor", fillRule: "evenodd" });
  });
});

describe("names", () => {
  it("makes every id a valid, unclashing export name", () => {
    expect(importName("arrow-right")).toBe("arrowRight");
    expect(importName("3d")).toBe("icon3d");
    expect(importName("delete")).toBe("deleteIcon");
    expect(importName("pack")).toBe("packIcon");
    expect(importName("icons")).toBe("iconsIcon");
    expect(importName("v0")).toBe("v0Icon");
    expect(humanize("arrow-right")).toBe("Arrow right");
  });

  it("normalizes the blacks", () => {
    for (const black of ["black", "#000", "#000000", "currentcolor", "currentColor", "var(--x, currentcolor)"]) expect(normalizeColor(black)).toBe("currentColor");
    expect(normalizeColor("#fff")).toBe("#fff");
  });
});
