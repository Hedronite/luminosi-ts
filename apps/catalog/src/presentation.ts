import type { ScreenEffectConfig, ScreenEffectId } from "@hedronite/lts-postfx";

/**
 * How the catalog's stages put each screen effect on show: its stack entry, given how many seconds a visitor should
 * wait between sweeps. The scan sweeps every `sweepSeconds` instead of its default 9, so it shows up while you look;
 * the others have nothing to tune. Keyed by the effect id type, so a new effect does not compile until it has a line.
 */
const entries: { readonly [Id in ScreenEffectId]: (sweepSeconds: number) => ScreenEffectConfig } = {
  smoke: () => ({ id: "smoke" }),
  crystallize: () => ({ id: "crystallize" }),
  dither: () => ({ id: "dither" }),
  ascii: () => ({ id: "ascii" }),
  scan: (period) => ({ id: "scan", params: { period } }),
  lens: () => ({ id: "lens" }),
  crt: () => ({ id: "crt" }),
  grain: () => ({ id: "grain" }),
};

export const stageEffect = (id: ScreenEffectId, sweepSeconds: number): ScreenEffectConfig => entries[id](sweepSeconds);
