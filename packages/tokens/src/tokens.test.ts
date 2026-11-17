import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseHex, relativeLuminance } from "./color.js";
import { themeCss } from "./css.js";
import { presets, type Palette } from "./presets.js";

const hex = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map(([r, g, b]) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`);

describe("color math", () => {
  it("parses #rrggbb and rejects anything else", () => {
    expect(parseHex("#2563eb")).toEqual([37, 99, 235]);
    expect(() => parseHex("blue")).toThrow();
    expect(() => parseHex("#fff")).toThrow();
  });

  it("puts black at 0 and white at 1, with contrast 21", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
  });

  it("gives a symmetric contrast between 1 and 21 for any pair", () => {
    fc.assert(
      fc.property(hex, hex, (a, b) => {
        const ratio = contrastRatio(a, b);
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(21);
        expect(contrastRatio(b, a)).toBeCloseTo(ratio, 12);
      }),
    );
  });
});

// WCAG 2.2: 4.5:1 for body text, 3:1 for UI components and large text.
const textPairs: readonly (readonly [keyof Palette, keyof Palette])[] = [
  ["fg", "surface"],
  ["fg", "surfaceRaised"],
  ["fgMuted", "surface"],
  ["fgMuted", "surfaceRaised"],
  ["onAccent", "accent"],
];

describe.each(presets.flatMap((preset) => [[preset.id, "light", preset.light] as const, [preset.id, "dark", preset.dark] as const]))(
  "%s preset, %s scheme",
  (_id, _scheme, palette) => {
    it.each(textPairs)("%s on %s has at least 4.5:1 contrast", (fg, bg) => {
      expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
    });

    it("accent on both surfaces has at least 3:1 contrast (controls and focus rings)", () => {
      expect(contrastRatio(palette.accent, palette.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(palette.accent, palette.surfaceRaised)).toBeGreaterThanOrEqual(3);
    });
  },
);

describe("themeCss", () => {
  const css = themeCss(presets);

  it("maps every semantic color to a utility through @theme inline", () => {
    expect(css).toContain("@theme inline {");
    for (const name of ["surface", "surface-raised", "fg", "fg-muted", "line", "accent", "on-accent"]) {
      expect(css).toContain(`--color-${name}: var(--lts-${name});`);
    }
  });

  it("makes the first preset the default and scopes the others", () => {
    expect(css).toContain(':root, :root[data-preset="neutral"] {');
    expect(css).toContain(':root[data-preset="hedronite"] {');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });
});
