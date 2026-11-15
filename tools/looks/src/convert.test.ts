import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, hedron, type Hex } from "@hedronite/lts-tokens";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { convertOmarchy, mix, pairLooks } from "./convert.js";
import { parseFlatToml } from "./toml.js";

const meta = { id: "your-look", name: "Your look", category: "omarchy" } as const;

/** Hedron's Omahedron colors.toml (VirtualMachinist/Omahedron themes/hedron, 20c5dc40), transcribed. */
const hedronToml = `
# Hedron
mode = "dark"
accent = "#a96a38"
selection = "#1c2450"
muted = "#8b93b8"
background = "#0a0e1e"
dark_background = "#080b18"
darker_background = "#060a16"
lighter_background = "#141a38"
foreground = "#eef1ff"
dark_foreground = "#8b93b8"
light_foreground = "#b7bfe8"
bright_foreground = "#f4f8ff"
red = "#c45c4a"
cyan = "#9dc3d4"
blue = "#2e5ab8"
hyprland_active_border = "rgba(a96a38ee)"
`;

const hexArb = fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 })).map(([r, g, b]): Hex => `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`);

describe("parseFlatToml", () => {
  it("reads key = \"value\" pairs and skips comments and blank lines", () => {
    expect(parseFlatToml('# theme\n\nmode = "dark"\naccent = "#7aa2f7"  # blue\nborder = "rgba(1, 2, 3)"\n')).toEqual({ mode: "dark", accent: "#7aa2f7", border: "rgba(1, 2, 3)" });
  });

  it("refuses what it doesn't understand, naming the line", () => {
    expect(() => parseFlatToml('mode = "dark"\n[colors]\n')).toThrow(/line 2/);
    expect(() => parseFlatToml("size = 12")).toThrow(SyntaxError);
    expect(() => parseFlatToml('a = "x"\na = "y"')).toThrow(/twice/);
  });
});

describe("convertOmarchy", () => {
  it("maps Hedron's roles onto the same surfaces and text the hand-made hedron look uses", () => {
    const { preset } = convertOmarchy(parseFlatToml(hedronToml), { ...meta, id: "hedron-converted", category: "virtualmachinist" });
    expect(preset.scheme).toBe("dark");
    const { surface, surfaceRaised, fg, fgMuted, line } = preset.dark;
    expect({ surface, surfaceRaised, fg, fgMuted, line }).toEqual({
      surface: hedron.dark.surface,
      surfaceRaised: hedron.dark.surfaceRaised,
      fg: hedron.dark.fg,
      fgMuted: hedron.dark.fgMuted,
      line: hedron.dark.line,
    });
    expect(preset.scene).toMatchObject({ base: hedron.scene.base, accent: "#a96a38", glass: hedron.scene.glass, emissive: hedron.scene.emissive });
  });

  it("keeps Hedron's copper accent, with black text on it (4.8:1)", () => {
    const { preset, adjustments } = convertOmarchy(parseFlatToml(hedronToml), meta);
    expect([preset.dark.accent, preset.dark.onAccent]).toEqual(["#a96a38", "#000000"]);
    expect(adjustments).toEqual([]);
  });

  it("says when it had to move a color, and by how much", () => {
    // Tokyo Night's dim text (#565f89) is 2.9:1 on its background, and its muted color is fainter still.
    const toml = readFileSync(join(import.meta.dirname, "../../../assets/src/looks/omarchy/tokyo-night/colors.toml"), "utf8");
    const { preset, adjustments } = convertOmarchy(parseFlatToml(toml), { ...meta, id: "tokyo-night" });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatch(/^fgMuted: dark_foreground #565f89 \(2\.\d\d:1 at worst\) moved \d+% toward fg → #[0-9a-f]{6}$/);
    expect(contrastRatio(preset.dark.fgMuted, preset.dark.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("passes WCAG for any theme it is given, dark or light", () => {
    fc.assert(
      fc.property(fc.array(hexArb, { minLength: 13, maxLength: 13 }), fc.boolean(), fc.boolean(), (c, isDark, saysMode) => {
        const [bg = "#000000", ...rest] = c;
        // Real themes are clearly dark or clearly light: the background sits near one end. The mode
        // is sometimes left out, so the converter has to infer it.
        const background = mix(bg, isDark ? "#000000" : "#ffffff", 0.7);
        const mode = saysMode ? (isDark ? "dark" : "light") : undefined;
        const roles = ["accent", "selection", "muted", "dark_background", "darker_background", "lighter_background", "foreground", "dark_foreground", "light_foreground", "bright_foreground", "cyan", "blue"] as const;
        const input: Record<string, string> = { background, ...(mode === undefined ? {} : { mode }) };
        roles.forEach((role, i) => {
          input[role] = rest[i] ?? "#808080";
        });
        // Surfaces must be tiers of the background, as in every Omarchy theme.
        input["lighter_background"] = mix(background, "#ffffff", 0.06);
        input["dark_background"] = mix(background, "#000000", 0.06);
        const { preset } = convertOmarchy(input, meta);
        const p = preset.dark;
        for (const [text, bg2] of [["fg", "surface"], ["fg", "surfaceRaised"], ["fgMuted", "surface"], ["fgMuted", "surfaceRaised"], ["onAccent", "accent"]] as const) {
          expect(contrastRatio(p[text], p[bg2])).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrastRatio(p.accent, p.surface)).toBeGreaterThanOrEqual(3);
        expect(preset.light).toEqual(preset.dark);
      }),
      { numRuns: 300 },
    );
  });

  it("keeps a theme that already passes exactly as written", () => {
    const toml = parseFlatToml(hedronToml.replace('accent = "#a96a38"', 'accent = "#dda77d"'));
    const { preset, adjustments } = convertOmarchy(toml, meta);
    expect(adjustments).toEqual([]);
    expect(preset.dark.accent).toBe("#dda77d");
  });

  it("takes the scheme from the background when mode is missing", () => {
    // Hedron Light's roles (Omahedron themes/hedron-light), with no mode line.
    const light = parseFlatToml(`
accent = "#7a4a32"
selection = "#c3d4e6"
muted = "#7d88a0"
background = "#eef3f8"
dark_background = "#e2ebf3"
darker_background = "#c9d8e6"
lighter_background = "#f9fbfd"
foreground = "#14265e"
dark_foreground = "#7d88a0"
light_foreground = "#3a4a78"
bright_foreground = "#14265e"
cyan = "#3a6a80"
blue = "#22418c"
`);
    const { preset } = convertOmarchy(light, meta);
    expect(preset.scheme).toBe("light");
    expect([preset.light.surface, preset.light.surfaceRaised, preset.light.line]).toEqual([hedron.light.surface, hedron.light.surfaceRaised, hedron.light.line]);
    expect(convertOmarchy(parseFlatToml(hedronToml.replace('mode = "dark"', "")), meta).preset.scheme).toBe("dark");
  });

  it("refuses a theme missing a role it reads", () => {
    expect(() => convertOmarchy(parseFlatToml('mode = "dark"\naccent = "#ffffff"'), meta)).toThrow();
    expect(() => convertOmarchy({ ...parseFlatToml(hedronToml), accent: "blue" }, meta)).toThrow();
  });
});

describe("pairLooks", () => {
  const omarchy = (id: string) =>
    convertOmarchy(parseFlatToml(readFileSync(join(import.meta.dirname, `../../../assets/src/looks/omarchy/${id}/colors.toml`), "utf8")), { ...meta, id });

  it("makes one look that follows the viewer: light from the light theme, dark from the dark one", () => {
    const dark = omarchy("catppuccin");
    const light = omarchy("catppuccin-latte");
    const { preset, adjustments } = pairLooks(dark, light, { ...meta, id: "catppuccin", name: "Catppuccin" });
    expect(preset.scheme).toBeUndefined();
    expect(preset.dark).toEqual(dark.preset.dark);
    expect(preset.light).toEqual(light.preset.light);
    expect(preset.scene).toEqual(dark.preset.scene);
    expect(adjustments).toHaveLength(dark.adjustments.length + light.adjustments.length);
    expect(adjustments.every((note) => note.startsWith("dark (catppuccin)") || note.startsWith("light (catppuccin-latte)"))).toBe(true);
  });

  it("refuses members in the wrong scheme", () => {
    const dark = omarchy("catppuccin");
    const light = omarchy("catppuccin-latte");
    expect(() => pairLooks(light, dark, meta)).toThrow(RangeError);
    expect(() => pairLooks(dark, dark, meta)).toThrow(RangeError);
  });
});
