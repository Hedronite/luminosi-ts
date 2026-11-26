import type { EnvironmentKind } from "./schema.js";

/** Default PMREM prefilter blur sigma for the studio room, shared by runtime and adapters. */
export const STUDIO_BLUR = 0.04;

export type RoomColorToken =
  | "WHITE"
  | "BLACK"
  | "neutral.ground"
  | "neutral.base"
  | "hedronite.sky"
  | "hedronite.fill"
  | "dusk.key"
  | "dusk.rim"
  | "dusk.ambient";

export type RoomColorExpr = RoomColorToken | readonly ["mix", RoomColorToken, RoomColorToken, number];

/** [colorExpr, emissiveIntensity, x, y, z, sx, sy, sz] */
export type RoomCardSpec = readonly [RoomColorExpr, number, number, number, number, number, number, number];

export interface RoomSpec {
  readonly blur: number;
  readonly wall: RoomColorExpr;
  readonly roughness: number;
  readonly contact: RoomColorExpr;
  readonly point: RoomColorExpr;
  readonly pointIntensity: number;
  readonly cards: readonly RoomCardSpec[];
}

/**
 * Pure-data six-lit-card studio-box room specs (`gallery`, `dusk`, `noir`), shared by `./three` and `./emit`
 * so the scene root and `./emit` stay free of `three` and `@hedronite/lts-tokens`.
 */
export const ROOM_SPECS: Readonly<Record<Exclude<EnvironmentKind, "studio">, RoomSpec>> = {
  gallery: {
    blur: 0.06,
    wall: ["mix", "WHITE", "neutral.ground", 0.28],
    roughness: 0.9,
    contact: ["mix", "BLACK", "neutral.ground", 0.2],
    point: "WHITE",
    pointIntensity: 620,
    cards: [
      ["WHITE", 58, 0, 19.2, 0, 12, 0.15, 12],
      ["neutral.ground", 8, 0, 0.4, 0, 18, 0.15, 18],
      ["hedronite.sky", 38, -15.2, 12.5, 2, 0.15, 8, 12],
      [["mix", "WHITE", "neutral.base", 0.25], 26, 15.2, 12.5, -1, 0.15, 7, 11],
      ["WHITE", 22, 0, 10.5, 14.5, 10, 5.5, 0.15],
      ["hedronite.fill", 18, 1.5, 13.5, -14.2, 8, 4.5, 0.15],
    ],
  },
  dusk: {
    blur: 0.08,
    wall: ["mix", "BLACK", "dusk.ambient", 0.72],
    roughness: 0.92,
    contact: ["mix", "BLACK", "dusk.ambient", 0.15],
    point: "dusk.key",
    pointIntensity: 320,
    cards: [
      [["mix", "dusk.ambient", "dusk.rim", 0.55], 28, 0, 19.4, 0, 14, 0.15, 14],
      ["dusk.ambient", 4, 0, 0.4, 0, 16, 0.15, 16],
      ["dusk.key", 54, -15.5, 6.2, 3.5, 0.15, 4.2, 12],
      ["dusk.rim", 30, 15.2, 14.2, -3.5, 0.15, 5.2, 10],
      [["mix", "dusk.key", "dusk.ambient", 0.45], 16, -2.5, 7.2, 14.4, 9, 3.6, 0.15],
      ["hedronite.sky", 26, 3.2, 13.8, -14.1, 7.5, 4.4, 0.15],
    ],
  },
  noir: {
    blur: 0.03,
    wall: "BLACK",
    roughness: 0.98,
    contact: "BLACK",
    point: "WHITE",
    pointIntensity: 180,
    cards: [
      ["WHITE", 82, 0, 19.6, 0, 0.7, 0.1, 9],
      ["BLACK", 0, 0, 0.4, 0, 16, 0.1, 16],
      ["WHITE", 64, -15.6, 13.8, 1.5, 0.12, 10, 0.9],
      [["mix", "BLACK", "hedronite.fill", 0.22], 5, 15.4, 10.5, 2, 0.15, 4, 6],
      [["mix", "BLACK", "WHITE", 0.15], 3, 0, 8.5, 14.6, 5, 2.2, 0.12],
      [["mix", "WHITE", "dusk.rim", 0.4], 44, 1.5, 14.6, -14.4, 6.5, 0.45, 0.12],
    ],
  },
};

/** Prefilter blur sigmas by room kind. */
export const ROOM_BLUR: Readonly<Record<EnvironmentKind, number>> = {
  studio: STUDIO_BLUR,
  gallery: ROOM_SPECS.gallery.blur,
  dusk: ROOM_SPECS.dusk.blur,
  noir: ROOM_SPECS.noir.blur,
};
