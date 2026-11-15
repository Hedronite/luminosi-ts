import type { EffectId } from "@hedronite/lts-shaders";
import { useId } from "react";
import { usePreset } from "./look";

/** A flat hint of what a shader does: a rim glow, a vertical blend, or a glowing core. */
export function EffectSwatch({ id, size }: { readonly id: EffectId; readonly size: number }) {
  const { scene } = usePreset();
  const gradient = useId();
  const fill = (() => {
    switch (id) {
      case "fresnel-glow":
        return (
          <radialGradient id={gradient} r="0.5">
            <stop offset="0.55" stopColor={scene.base} />
            <stop offset="1" stopColor={scene.emissive} />
          </radialGradient>
        );
      case "height-gradient":
        return (
          <linearGradient id={gradient} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0.15" stopColor={scene.base} />
            <stop offset="0.85" stopColor={scene.accent} />
          </linearGradient>
        );
      case "pulse":
        return (
          <radialGradient id={gradient} r="0.5">
            <stop offset="0" stopColor={scene.emissive} />
            <stop offset="1" stopColor={scene.emissive} stopOpacity={0.35} />
          </radialGradient>
        );
    }
  })();
  return (
    <svg width={size} height={size} viewBox="0 0 2 2" aria-hidden="true">
      <defs>{fill}</defs>
      <circle cx="1" cy="1" r="0.92" fill={`url(#${gradient})`} />
      <circle cx="1" cy="1" r="0.92" fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.04} />
    </svg>
  );
}
