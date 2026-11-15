import { generatedLooks } from "./generated/looks.js";
import type { LookCategory, Preset } from "./types.js";

export type { LookCategory, LookCategoryId, Palette, Preset, ScenePalette } from "./types.js";

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
    onAccent: "#ffffff",
  },
  dark: {
    surface: "#0a0a0a",
    surfaceRaised: "#171717",
    fg: "#f5f5f5",
    fgMuted: "#a3a3a3",
    line: "#2e2e2e",
    accent: "#60a5fa",
    onAccent: "#0a0a0a",
  },
  scene: { base: "#d4d4d8", accent: "#3b82f6", metal: "#c0c4cc", glass: "#8fb4e3", emissive: "#93c5fd" },
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
    onAccent: "#ffffff",
  },
  dark: {
    surface: "#08090d",
    surfaceRaised: "#10131c",
    fg: "#f0f0f2",
    fgMuted: "#9aa3b0",
    line: "#232838",
    accent: "#dda77d",
    onAccent: "#08090d",
  },
  scene: { base: "#9cabb8", accent: "#c07b42", metal: "#dda77d", glass: "#7fa3dc", emissive: "#3b5bd9" },
};

/** Every look: the hand-made ones, then the converted ones (`bun run looks`, from assets/src/looks). */
export const presets: readonly Preset[] = [neutral, hedronite, ...generatedLooks];

/** The looks in each category, in display order; empty categories are left out. */
export function presetsByCategory(all: readonly Preset[] = presets): readonly { readonly category: LookCategory; readonly presets: readonly Preset[] }[] {
  return lookCategories.map((category) => ({ category, presets: all.filter((preset) => preset.category === category.id) })).filter((group) => group.presets.length > 0);
}
