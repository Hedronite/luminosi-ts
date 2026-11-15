import type { Hex } from "./color.js";

// The shape of a look. Kept apart from the looks themselves so generated looks can use it.

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

/** Where a look comes from. Looks are grouped by category wherever they are listed. */
export type LookCategoryId = "core" | "virtualmachinist" | "omarchy";

export interface LookCategory {
  readonly id: LookCategoryId;
  readonly name: string;
  readonly description: string;
}

/** A complete look: interface colors for light and dark, and scene colors. Swap the preset to swap the look. */
export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly category: LookCategoryId;
  /**
   * A look made for one scheme only (most Omarchy themes are either dark or light). It keeps that
   * scheme whatever the viewer prefers; `light` and `dark` then hold the same palette.
   */
  readonly scheme?: "light" | "dark";
  /** Who made the colors, when it isn't us. */
  readonly credit?: string;
  readonly light: Palette;
  readonly dark: Palette;
  readonly scene: ScenePalette;
}
