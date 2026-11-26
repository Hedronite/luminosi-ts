import type { Hex } from "./color.js";

// The shape of a look. Kept apart from the looks themselves so generated looks can use it.

/** Base interface colors stored for a scheme before deriving `accentText`. */
export interface BasePalette {
  readonly surface: Hex;
  readonly surfaceRaised: Hex;
  readonly fg: Hex;
  readonly fgMuted: Hex;
  readonly line: Hex;
  readonly accent: Hex;
  /** Text and icons drawn on the accent color. */
  readonly onAccent: Hex;
}

/** Semantic interface colors for one color scheme. */
export interface Palette extends BasePalette {
  /** Accent color guaranteed >= 4.5:1 against both surface and surfaceRaised for body text. */
  readonly accentText: Hex;
}

/** Supported renderer tone mapping modes for a look. */
export type ToneMapping = "aces" | "agx" | "neutral";

/** Material color slots on every ScenePalette. */
export type SceneColorKey = "base" | "accent" | "metal" | "glass" | "emissive";

/** Semantic stage light color roles on every full look. */
export type SceneLightRole = "key" | "fill" | "rim" | "ambient" | "sky" | "ground";

/** Stage lighting, tone mapping, and exposure tokens carried by every full look. */
export interface SceneLighting {
  readonly key: Hex;
  readonly fill: Hex;
  readonly rim: Hex;
  readonly ambient: Hex;
  readonly sky: Hex;
  readonly ground: Hex;
  readonly toneMapping: ToneMapping;
  readonly exposure: number;
}

/** Colors for 3D materials (and optional stage lighting tokens), shared by every scheme. */
export interface ScenePalette {
  readonly base: Hex;
  readonly accent: Hex;
  readonly metal: Hex;
  readonly glass: Hex;
  readonly emissive: Hex;
  readonly key?: Hex;
  readonly fill?: Hex;
  readonly rim?: Hex;
  readonly ambient?: Hex;
  readonly sky?: Hex;
  readonly ground?: Hex;
  readonly toneMapping?: ToneMapping;
  readonly exposure?: number;
}

/** A complete look's scene palette: material colors plus required lighting, tone mapping, and exposure tokens. */
export type SceneLookPalette = ScenePalette & SceneLighting;

/** Where a look comes from. Looks are grouped by category wherever they are listed. */
export type LookCategoryId = "core" | "virtualmachinist" | "omarchy";

export interface LookCategory {
  readonly id: LookCategoryId;
  readonly name: string;
  readonly description: string;
}

/** Compact look shape before deriving `accentText` and default scene lighting. */
export interface RawPreset {
  readonly id: string;
  readonly name: string;
  readonly category: LookCategoryId;
  readonly scheme?: "light" | "dark";
  readonly credit?: string;
  readonly light: BasePalette & { readonly accentText?: Hex };
  readonly dark: BasePalette & { readonly accentText?: Hex };
  readonly scene: ScenePalette;
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
  readonly scene: SceneLookPalette;
}
