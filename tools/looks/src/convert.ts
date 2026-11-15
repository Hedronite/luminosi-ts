import { contrastRatio, parseHex, relativeLuminance, type Hex, type LookCategoryId, type Palette, type Preset, type ScenePalette } from "@hedronite/lts-tokens";
import { z } from "zod";

/**
 * Omarchy `colors.toml` → a LuminosiTS look.
 *
 * Omarchy themes name their colors by role (backgrounds and foregrounds in tiers, an accent, a
 * selection, ANSI colors). The look takes:
 *
 * | Look            | Dark theme                     | Light theme                    |
 * |-----------------|--------------------------------|--------------------------------|
 * | surface         | background                     | background                     |
 * | surfaceRaised   | lighter_background             | dark_background                |
 * | fg              | foreground                     | foreground                     |
 * | fgMuted         | dark_foreground, else muted    | dark_foreground, else muted    |
 * | line            | selection                      | darker_background              |
 * | accent          | accent                         | accent                         |
 * | onAccent        | surface, fg, white or black: the first that reads on the accent  |
 * | scene.base      | light_foreground               | muted                          |
 * | scene.metal     | bright_foreground              | dark_foreground                |
 * | scene.accent    | accent (as given)              | accent (as given)              |
 * | scene.glass     | cyan                           | cyan                           |
 * | scene.emissive  | blue                           | blue                           |
 *
 * Every look must pass WCAG 2.2: 4.5:1 for fg and fgMuted on both surfaces and for onAccent on
 * the accent, 3:1 for the accent on the surface. Where a theme's own color falls short, the
 * converter moves it the least it can toward where it needs to go (fgMuted toward fg; fg and the
 * accent toward white on a dark theme, black on a light one), in 5% steps, and records the change.
 * Nothing is changed silently.
 *
 * The look keeps the theme's own scheme (`scheme: "dark"` or `"light"`), as Omarchy does.
 */

const TEXT = 4.5;
const UI = 3;

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "expected a #rrggbb color")
  .transform((value): Hex => `#${value.slice(1).toLowerCase()}`);

/** The roles the converter reads. Other keys (Hyprland borders, icon marks, ANSI colors) are ignored. */
const omarchyColorsSchema = z.object({
  mode: z.enum(["dark", "light"]).optional(),
  accent: hex,
  selection: hex,
  muted: hex,
  background: hex,
  dark_background: hex,
  darker_background: hex,
  lighter_background: hex,
  foreground: hex,
  dark_foreground: hex,
  light_foreground: hex,
  bright_foreground: hex,
  cyan: hex,
  blue: hex,
});


export interface LookMeta {
  readonly id: string;
  readonly name: string;
  readonly category: LookCategoryId;
  readonly credit?: string;
}

export interface Conversion {
  readonly preset: Preset;
  /** Every color the converter had to move, and why. Empty when the theme passes as it is. */
  readonly adjustments: readonly string[];
}

/** Mixes two colors in sRGB: t = 0 is `from`, t = 1 is `to`. */
export function mix(from: Hex, to: Hex, t: number): Hex {
  const a = parseHex(from);
  const b = parseHex(to);
  const channel = (i: 0 | 1 | 2): string =>
    Math.round(a[i] + (b[i] - a[i]) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

const ratio = (a: Hex, b: Hex): string => `${contrastRatio(a, b).toFixed(2)}:1`;
/** The lowest contrast `color` has on any of `backgrounds`, for the notes. */
const worst = (color: Hex, backgrounds: readonly Hex[]): string => `${Math.min(...backgrounds.map((bg) => contrastRatio(color, bg))).toFixed(2)}:1 at worst`;
const STEPS = Array.from({ length: 21 }, (_, i) => i / 20);

/** The first of `candidates` that reads at `min` on every background, or undefined. */
function firstReadable(candidates: readonly (readonly [string, Hex])[], backgrounds: readonly Hex[], min: number): readonly [string, Hex] | undefined {
  return candidates.find(([, color]) => backgrounds.every((bg) => contrastRatio(color, bg) >= min));
}

/** Moves `color` toward `target` in 5% steps until it reads at `min` on every background. */
function nudge(color: Hex, target: Hex, backgrounds: readonly Hex[], min: number): readonly [Hex, number] | undefined {
  for (const t of STEPS) {
    const moved = mix(color, target, t);
    if (backgrounds.every((bg) => contrastRatio(moved, bg) >= min)) return [moved, t];
  }
  return undefined;
}

/** Converts parsed Omarchy colors into a look, with the adjustments it took to pass contrast. */
export function convertOmarchy(input: unknown, meta: LookMeta): Conversion {
  const colors = omarchyColorsSchema.parse(input);
  const dark = colors.mode === undefined ? relativeLuminance(colors.background) < 0.18 : colors.mode === "dark";
  const scheme = dark ? "dark" : "light";
  const extreme: Hex = dark ? "#ffffff" : "#000000";
  const adjustments: string[] = [];

  const surface = colors.background;
  const surfaceRaised = dark ? colors.lighter_background : colors.dark_background;
  const surfaces = [surface, surfaceRaised] as const;

  // Text.
  let fg: Hex;
  const fgPick = firstReadable([["foreground", colors.foreground], ["bright_foreground", colors.bright_foreground]], surfaces, TEXT);
  if (fgPick !== undefined) {
    fg = fgPick[1];
    if (fgPick[0] !== "foreground") adjustments.push(`fg: foreground ${colors.foreground} (${worst(colors.foreground, surfaces)}) is too faint; used bright_foreground ${fg}`);
  } else {
    const moved = nudge(colors.foreground, extreme, surfaces, TEXT);
    if (moved === undefined) throw new RangeError(`${meta.id}: no foreground reaches ${String(TEXT)}:1 on its surfaces`);
    fg = moved[0];
    adjustments.push(`fg: foreground ${colors.foreground} moved ${String(Math.round(moved[1] * 100))}% toward ${extreme} → ${fg}`);
  }

  let fgMuted: Hex;
  const mutedPick = firstReadable([["dark_foreground", colors.dark_foreground], ["muted", colors.muted]], surfaces, TEXT);
  if (mutedPick !== undefined) {
    fgMuted = mutedPick[1];
    if (mutedPick[0] !== "dark_foreground") adjustments.push(`fgMuted: dark_foreground ${colors.dark_foreground} (${worst(colors.dark_foreground, surfaces)}) is too faint; used muted ${fgMuted}`);
  } else {
    // fg passes by construction, so moving toward it always ends.
    const moved = nudge(colors.dark_foreground, fg, surfaces, TEXT);
    if (moved === undefined) throw new RangeError(`${meta.id}: fgMuted cannot reach ${String(TEXT)}:1`);
    fgMuted = moved[0];
    adjustments.push(`fgMuted: dark_foreground ${colors.dark_foreground} (${worst(colors.dark_foreground, surfaces)}) moved ${String(Math.round(moved[1] * 100))}% toward fg → ${fgMuted}`);
  }

  // The accent must stand out from the surface and carry readable text.
  const onAccentFor = (accent: Hex): Hex | undefined =>
    ([surface, fg, "#ffffff", "#000000"] as const).find((candidate) => contrastRatio(candidate, accent) >= TEXT);
  let accent: Hex | undefined;
  let onAccent: Hex | undefined;
  for (const t of STEPS) {
    const candidate = mix(colors.accent, extreme, t);
    const text = onAccentFor(candidate);
    if (contrastRatio(candidate, surface) >= UI && text !== undefined) {
      accent = candidate;
      onAccent = text;
      if (t > 0) adjustments.push(`accent: ${colors.accent} (${ratio(colors.accent, surface)} on the surface) moved ${String(Math.round(t * 100))}% toward ${extreme} → ${candidate}`);
      break;
    }
  }
  if (accent === undefined || onAccent === undefined) throw new RangeError(`${meta.id}: no accent reaches ${String(UI)}:1 with readable text on it`);

  const palette: Palette = {
    surface,
    surfaceRaised,
    fg,
    fgMuted,
    line: dark ? colors.selection : colors.darker_background,
    accent,
    onAccent,
  };
  const scene: ScenePalette = {
    base: dark ? colors.light_foreground : colors.muted,
    accent: colors.accent,
    metal: dark ? colors.bright_foreground : colors.dark_foreground,
    glass: colors.cyan,
    emissive: colors.blue,
  };
  const preset: Preset = {
    id: meta.id,
    name: meta.name,
    category: meta.category,
    scheme,
    ...(meta.credit === undefined ? {} : { credit: meta.credit }),
    light: palette,
    dark: palette,
    scene,
  };
  return { preset, adjustments };
}
