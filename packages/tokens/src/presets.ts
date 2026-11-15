import type { Hex } from "./color.js";

/** Semantic interface colors for one color scheme. */
export interface Palette {
  readonly surface: Hex;
  readonly surfaceRaised: Hex;
  readonly fg: Hex;
  readonly fgMuted: Hex;
  readonly line: Hex;
  readonly accent: Hex;
  /** Text and icons drawn on the accent color. */
  readonly onAccent: Hex;
}

/** Colors for 3D materials, shared by every scheme. */
export interface ScenePalette {
  readonly base: Hex;
  readonly accent: Hex;
  readonly metal: Hex;
  readonly glass: Hex;
  readonly emissive: Hex;
}

/** A complete look: interface colors for light and dark, and scene colors. Swap the preset to swap the look. */
export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly light: Palette;
  readonly dark: Palette;
  readonly scene: ScenePalette;
}

/** The default: neutral grays with a quiet blue accent. */
export const neutral: Preset = {
  id: "neutral",
  name: "Neutral",
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

/** An optional pack: copper and lapis on deep slate, after hedronite.com. */
export const hedronite: Preset = {
  id: "hedronite",
  name: "Hedronite",
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

export const presets: readonly Preset[] = [neutral, hedronite];
