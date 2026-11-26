import { BLACK, contrastRatio, mixHex, relativeLuminance, WHITE, type Hex } from "./color.js";
import { generatedLooks } from "./generated/looks.js";
import type { BasePalette, LookCategory, Palette, Preset, RawPreset, SceneLighting, ScenePalette } from "./types.js";

export type { BasePalette, LookCategory, LookCategoryId, Palette, Preset, RawPreset, SceneColorKey, SceneLighting, SceneLightRole, SceneLookPalette, ScenePalette, ToneMapping } from "./types.js";

const TEXT_STEPS = Array.from({ length: 21 }, (_, i) => i / 20);

/** Derives `accentText` from `accent` so it achieves >= 4.5:1 contrast against both `surface` and `surfaceRaised`. */
export function deriveAccentText(palette: BasePalette, scheme?: "light" | "dark"): Hex {
  const dark = scheme === undefined ? relativeLuminance(palette.surface) < 0.18 : scheme === "dark";
  const extreme = dark ? WHITE : BLACK;
  const surfaces = [palette.surface, palette.surfaceRaised] as const;
  for (const t of TEXT_STEPS) {
    const moved = mixHex(palette.accent, extreme, t);
    if (surfaces.every((bg) => contrastRatio(moved, bg) >= 4.5)) return moved;
  }
  return palette.fg;
}

/** Derives default lighting, tone mapping, and exposure tokens from a look's scene colors and primary scheme. */
export function deriveSceneLighting(scene: ScenePalette, scheme: "light" | "dark", surface: Hex): SceneLighting {
  const dark = scheme === "dark";
  return {
    key: mixHex(WHITE, scene.accent, dark ? 0.18 : 0.08),
    fill: mixHex(WHITE, dark ? scene.glass : scene.base, dark ? 0.25 : 0.15),
    rim: mixHex(WHITE, scene.emissive, dark ? 0.3 : 0.15),
    ambient: mixHex(dark ? surface : WHITE, scene.base, dark ? 0.35 : 0.25),
    sky: mixHex(WHITE, scene.glass, 0.2),
    ground: mixHex(surface, scene.base, 0.45),
    toneMapping: dark ? "aces" : "neutral",
    exposure: dark ? 1.05 : 1,
  };
}

/** Hydrates a compact look (with optional explicit overrides) into a full `Preset`. */
export function hydratePreset(raw: RawPreset): Preset {
  const scheme = raw.scheme ?? "dark";
  const refSurface = scheme === "light" ? raw.light.surface : raw.dark.surface;
  const derived = deriveSceneLighting(raw.scene, scheme, refSurface);
  const fillPalette = (p: RawPreset["light"], s: "light" | "dark"): Palette => ({
    ...p,
    accentText: p.accentText ?? deriveAccentText(p, raw.scheme ?? s),
  });
  return {
    ...raw,
    light: fillPalette(raw.light, "light"),
    dark: fillPalette(raw.dark, "dark"),
    scene: {
      ...raw.scene,
      key: raw.scene.key ?? derived.key,
      fill: raw.scene.fill ?? derived.fill,
      rim: raw.scene.rim ?? derived.rim,
      ambient: raw.scene.ambient ?? derived.ambient,
      sky: raw.scene.sky ?? derived.sky,
      ground: raw.scene.ground ?? derived.ground,
      toneMapping: raw.scene.toneMapping ?? derived.toneMapping,
      exposure: raw.scene.exposure ?? derived.exposure,
    },
  };
}

/** Every category, in display order. */
export const lookCategories: readonly LookCategory[] = [
  { id: "core", name: "Core", description: "The LuminosiTS default." },
  { id: "virtualmachinist", name: "VirtualMachinist", description: "First-party looks: the hedronite.com tokens, and Hedron and Hedron Light from the Omahedron theme pack." },
  { id: "omarchy", name: "Omarchy", description: "Omarchy's themes, converted from their colors.toml (MIT; ported schemes credit their authors)." },
];

/** The default: neutral grays with a quiet blue accent. */
export const neutral: Preset = {
  id: "neutral",
  name: "Neutral",
  category: "core",
  light: {
    surface: "#ffffff",
    surfaceRaised: "#f5f5f5",
    fg: "#171717",
    fgMuted: "#525252",
    line: "#d4d4d4",
    accent: "#2563eb",
    accentText: "#2563eb",
    onAccent: "#ffffff",
  },
  dark: {
    surface: "#0a0a0a",
    surfaceRaised: "#171717",
    fg: "#f5f5f5",
    fgMuted: "#a3a3a3",
    line: "#2e2e2e",
    accent: "#60a5fa",
    accentText: "#60a5fa",
    onAccent: "#0a0a0a",
  },
  scene: {
    base: "#d4d4d8",
    accent: "#3b82f6",
    metal: "#c0c4cc",
    glass: "#8fb4e3",
    emissive: "#93c5fd",
    key: "#ffffff",
    fill: "#ffffff",
    rim: "#ffffff",
    ambient: "#ffffff",
    sky: "#ffffff",
    ground: "#d8d4cc",
    toneMapping: "aces",
    exposure: 1,
  },
};

/** An optional pack, canonical: copper and lapis on deep slate, from the hedronite.com tokens. */
export const hedronite: Preset = {
  id: "hedronite",
  name: "Hedronite",
  category: "virtualmachinist",
  light: {
    surface: "#f6f5f3",
    surfaceRaised: "#ebe9e5",
    fg: "#10131c",
    fgMuted: "#4a5261",
    line: "#cfd3d9",
    accent: "#8f5426",
    accentText: "#8f5426",
    onAccent: "#ffffff",
  },
  dark: {
    surface: "#08090d",
    surfaceRaised: "#10131c",
    fg: "#f0f0f2",
    fgMuted: "#9aa3b0",
    line: "#232838",
    accent: "#dda77d",
    accentText: "#dda77d",
    onAccent: "#08090d",
  },
  scene: {
    base: "#9cabb8",
    accent: "#c07b42",
    metal: "#dda77d",
    glass: "#7fa3dc",
    emissive: "#3b5bd9",
    key: "#f2e2d4",
    fill: "#d7e3f5",
    rim: "#bec9f2",
    ambient: "#798bb5",
    sky: "#dfe8f6",
    ground: "#a3a1a0",
    toneMapping: "aces",
    exposure: 1,
  },
};

/** Every look: the hand-made ones, then the converted ones (`bun run looks`, from assets/src/looks). */
export const presets: readonly Preset[] = [neutral, hedronite, ...generatedLooks.map(hydratePreset)];

/** The looks in each category, in display order; empty categories are left out. */
export function presetsByCategory(all: readonly Preset[] = presets): readonly { readonly category: LookCategory; readonly presets: readonly Preset[] }[] {
  return lookCategories.map((category) => ({ category, presets: all.filter((preset) => preset.category === category.id) })).filter((group) => group.presets.length > 0);
}

/** Resolves lighting, tone mapping, and exposure tokens for any ScenePalette, defaulting to neutral's rig for 5-color inline palettes. */
export function sceneLighting(palette: ScenePalette): SceneLighting {
  const fallback = neutral.scene;
  return {
    key: palette.key ?? fallback.key,
    fill: palette.fill ?? fallback.fill,
    rim: palette.rim ?? fallback.rim,
    ambient: palette.ambient ?? fallback.ambient,
    sky: palette.sky ?? fallback.sky,
    ground: palette.ground ?? fallback.ground,
    toneMapping: palette.toneMapping ?? fallback.toneMapping,
    exposure: palette.exposure ?? fallback.exposure,
  };
}

/** Multiplicative mood tints for lighting kits that shift white neutral lights into a twilight key/rim/ambient mood while still following every look's lighting tokens. */
export const duskLightTints = {
  key: "#ffb36b",
  rim: "#7aa2ff",
  ambient: "#2a2f45",
} as const satisfies Record<"key" | "rim" | "ambient", `#${string}`>;
