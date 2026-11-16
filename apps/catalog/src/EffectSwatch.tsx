import type { EffectId } from "@hedronite/lts-shaders";
import { useId, type ReactNode } from "react";
import { usePreset } from "./look";

/** A flat hint of what a shader does: a rim glow, a vertical blend, a glowing core, flat bands, and so on. */
export function EffectSwatch({ id, size }: { readonly id: EffectId; readonly size: number }) {
  const { scene } = usePreset();
  const paint = useId();
  // What fills the disc, and an outline when the effect has one of its own.
  const { defs, ink }: { readonly defs: ReactNode; readonly ink?: string } = (() => {
    switch (id) {
      case "fresnel-glow":
        return {
          defs: (
            <radialGradient id={paint} r="0.5">
              <stop offset="0.55" stopColor={scene.base} />
              <stop offset="1" stopColor={scene.emissive} />
            </radialGradient>
          ),
        };
      case "height-gradient":
        return {
          defs: (
            <linearGradient id={paint} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0.15" stopColor={scene.base} />
              <stop offset="0.85" stopColor={scene.accent} />
            </linearGradient>
          ),
        };
      case "pulse":
        return {
          defs: (
            <radialGradient id={paint} r="0.5">
              <stop offset="0" stopColor={scene.emissive} />
              <stop offset="1" stopColor={scene.emissive} stopOpacity={0.35} />
            </radialGradient>
          ),
        };
      case "toon":
        // Hard stops: flat bands, lit from the upper right.
        return {
          defs: (
            <linearGradient id={paint} x1="0.9" y1="0.1" x2="0.1" y2="0.9">
              <stop offset="0.4" stopColor={scene.accent} />
              <stop offset="0.4" stopColor={scene.accent} stopOpacity={0.65} />
              <stop offset="0.75" stopColor={scene.accent} stopOpacity={0.65} />
              <stop offset="0.75" stopColor={scene.accent} stopOpacity={0.35} />
            </linearGradient>
          ),
          ink: "#000000",
        };
      case "refraction":
        return {
          defs: (
            <radialGradient id={paint} cx="0.42" cy="0.4" r="0.6">
              <stop offset="0" stopColor={scene.glass} stopOpacity={0.15} />
              <stop offset="0.8" stopColor={scene.glass} stopOpacity={0.45} />
              <stop offset="1" stopColor={scene.glass} stopOpacity={0.9} />
            </radialGradient>
          ),
        };
      case "dissolve":
        return {
          defs: (
            <linearGradient id={paint} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0.5" stopColor={scene.base} />
              <stop offset="0.58" stopColor={scene.emissive} />
              <stop offset="0.64" stopColor={scene.emissive} stopOpacity={0} />
            </linearGradient>
          ),
        };
      case "hologram":
        return {
          defs: (
            <pattern id={paint} width="2" height="0.16" patternUnits="userSpaceOnUse">
              <rect width="2" height="0.09" fill={scene.emissive} fillOpacity={0.75} />
            </pattern>
          ),
        };
    }
  })();
  return (
    <svg width={size} height={size} viewBox="0 0 2 2" aria-hidden="true">
      <defs>{defs}</defs>
      <circle cx="1" cy="1" r="0.92" fill={`url(#${paint})`} />
      {ink === undefined ? (
        <circle cx="1" cy="1" r="0.92" fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.04} />
      ) : (
        <circle cx="1" cy="1" r="0.88" fill="none" stroke={ink} strokeWidth={0.1} />
      )}
    </svg>
  );
}
