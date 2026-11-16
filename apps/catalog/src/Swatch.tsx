import { materialPreset, type MaterialId } from "@hedronite/lts-materials";
import { useId } from "react";
import { usePreset } from "./look";

/**
 * A flat stand-in for a material: its preset color, with a highlight that tightens as roughness drops.
 * A thin film adds a band of shifting color; a sheen adds a soft light at the rim.
 */
export function Swatch({ id, size }: { readonly id: MaterialId; readonly size: number }) {
  const preset = materialPreset(id);
  const scene = usePreset().scene;
  const color = scene[preset.color];
  const gradient = useId();
  const film = useId();
  const sheen = useId();
  const highlight = 0.15 + (1 - preset.roughness) * 0.55;
  return (
    <svg width={size} height={size} viewBox="0 0 2 2" aria-hidden="true">
      <defs>
        <radialGradient id={gradient} cx="0.35" cy="0.3" r={0.9 - (1 - preset.roughness) * 0.45}>
          <stop offset="0" stopColor="#ffffff" stopOpacity={highlight} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
        <linearGradient id={film} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0.1" stopColor={scene.glass} />
          <stop offset="0.5" stopColor={scene.accent} />
          <stop offset="0.9" stopColor={scene.emissive} />
        </linearGradient>
        <radialGradient id={sheen} r="0.5">
          <stop offset="0.7" stopColor={preset.sheenColor === undefined ? color : scene[preset.sheenColor]} stopOpacity={0} />
          <stop offset="1" stopColor={preset.sheenColor === undefined ? color : scene[preset.sheenColor]} stopOpacity={0.85} />
        </radialGradient>
      </defs>
      <circle cx="1" cy="1" r="0.92" fill={color} fillOpacity={preset.transmission === undefined ? 1 : 0.45} />
      {preset.iridescence === undefined ? null : <circle cx="1" cy="1" r="0.92" fill={`url(#${film})`} fillOpacity={preset.iridescence * 0.5} />}
      {preset.sheen === undefined ? null : <circle cx="1" cy="1" r="0.92" fill={`url(#${sheen})`} fillOpacity={preset.sheen} />}
      <circle cx="1" cy="1" r="0.92" fill={`url(#${gradient})`} />
      <circle cx="1" cy="1" r="0.92" fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.04} />
    </svg>
  );
}
