import { materialPreset, type MaterialId } from "@hedronite/lts-materials";
import { useId } from "react";
import { usePreset } from "./look";

/** A flat stand-in for a material: its preset color, with a highlight that tightens as roughness drops. */
export function Swatch({ id, size }: { readonly id: MaterialId; readonly size: number }) {
  const preset = materialPreset(id);
  const color = usePreset().scene[preset.color];
  const gradient = useId();
  const highlight = 0.15 + (1 - preset.roughness) * 0.55;
  return (
    <svg width={size} height={size} viewBox="0 0 2 2" aria-hidden="true">
      <defs>
        <radialGradient id={gradient} cx="0.35" cy="0.3" r={0.9 - (1 - preset.roughness) * 0.45}>
          <stop offset="0" stopColor="#ffffff" stopOpacity={highlight} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx="1" cy="1" r="0.92" fill={color} fillOpacity={preset.transmission === undefined ? 1 : 0.45} />
      <circle cx="1" cy="1" r="0.92" fill={`url(#${gradient})`} />
      <circle cx="1" cy="1" r="0.92" fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.04} />
    </svg>
  );
}
