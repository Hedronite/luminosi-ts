import { inksFor, type ScreenEffectId } from "@hedronite/lts-postfx";
import { useId, type ReactNode } from "react";
import { usePreset } from "./look";

// A fixed scatter, so the grain hint looks the same on every render.
const specks = Array.from({ length: 40 }, (_, i) => [((i * 37) % 97) / 97, ((i * 61) % 89) / 89] as const);

/** A flat hint of a screen effect, in the inks it would print with. */
export function ScreenSwatch({ id, size }: { readonly id: ScreenEffectId; readonly size: number }) {
  const inks = inksFor(usePreset().scene);
  const clip = useId();
  const smoke = useId();
  const disc = <circle cx="1" cy="1" r="0.92" fill={inks.cool[0]} fillOpacity={0.55} />;
  const dots = (from: number, to: number): ReactNode =>
    Array.from({ length: 10 }, (_, row) =>
      Array.from({ length: 10 }, (_, col) => {
        const level = (row + col) / 18;
        if (row < from * 10 || row >= to * 10 || (row * 7 + col * 3) % 4 > level * 4) return null;
        return <rect key={`${String(row)}-${String(col)}`} x={0.1 + col * 0.18} y={0.1 + row * 0.18} width={0.13} height={0.13} fill={level > 0.6 ? inks.cool[2] : inks.cool[1]} />;
      }),
    );
  const drawings: { readonly [Id in ScreenEffectId]: () => ReactNode } = {
      dither: () => {
        return dots(0, 1);
      },
      ascii: () => {
        return (
          <text x="1" y={1.2} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="0.5" fontWeight="600" fill={inks.cool[2]}>
            @#+:
          </text>
        );
      },
      crystallize: () => {
        return (
          <>
            {dots(0.5, 1)}
            <text x="1" y={0.82} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="0.5" fontWeight="600" fill={inks.cool[2]}>
              @#
            </text>
          </>
        );
      },
      grain: () => {
        return specks.map(([x, y], i) => <rect key={i} x={0.15 + x * 1.7} y={0.15 + y * 1.7} width={0.05} height={0.05} fill={inks.hot} fillOpacity={0.8} />);
      },
      scan: () => {
        return (
          <>
            {dots(0.4, 0.6)}
            <line x1="0" y1="1.05" x2="2" y2="1.05" stroke={inks.rule} strokeWidth={0.05} />
          </>
        );
      },
      lens: () => {
        return (
          <>
            <circle cx="1.15" cy="0.9" r="0.5" fill={inks.cool[1]} fillOpacity={0.35} />
            <circle cx="1.15" cy="0.9" r="0.5" fill="none" stroke={inks.rule} strokeWidth={0.05} />
          </>
        );
      },
      crt: () => {
        return (
          <>
            <rect x="0.2" y="0.3" width="1.6" height="1.4" rx="0.3" fill={inks.cool[0]} fillOpacity={0.7} />
            {Array.from({ length: 7 }, (_, i) => (
              <line key={i} x1="0.3" x2="1.7" y1={0.45 + i * 0.18} y2={0.45 + i * 0.18} stroke={inks.cool[2]} strokeOpacity={0.55} strokeWidth={0.05} />
            ))}
          </>
        );
      },
      smoke: () => {
        return (
          <>
            <defs>
              <radialGradient id={smoke} cx="0.4" cy="0.6" r="0.6">
                <stop offset="0" stopColor={inks.warm[1]} stopOpacity={0.8} />
                <stop offset="0.5" stopColor={inks.cool[1]} stopOpacity={0.6} />
                <stop offset="1" stopColor={inks.cool[0]} stopOpacity={0} />
              </radialGradient>
            </defs>
            <rect width="2" height="2" fill={`url(#${smoke})`} />
          </>
        );
      },
  };
  const content = drawings[id]();
  return (
    <svg width={size} height={size} viewBox="0 0 2 2" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <circle cx="1" cy="1" r="0.92" />
        </clipPath>
      </defs>
      {disc}
      <g clipPath={`url(#${clip})`}>{content}</g>
      <circle cx="1" cy="1" r="0.92" fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.04} />
    </svg>
  );
}
