import type { AssetMeta } from "@hedronite/lts-core";
import { materialIds, materialPreset } from "@hedronite/lts-materials";
import { screenEffectIds, screenEffectInfo, type ScreenEffectConfig, type ScreenEffectId } from "@hedronite/lts-postfx";
import { isPrimitiveId, primitiveIds, primitiveInfo, type PrimitiveId } from "@hedronite/lts-primitives";
import type { Hex } from "@hedronite/lts-tokens";
import { useMemo, useRef, useState } from "react";
import { AssetPreview } from "./AssetPreview";
import { EffectStage, type StageStyle } from "./EffectStage";
import { usePreset } from "./look";

const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";

/** One-ink prints, from the look's own colors. */
const inkModes = [
  { id: "look", label: "From the look (two inks)" },
  { id: "accent", label: "One ink: accent" },
  { id: "emissive", label: "One ink: glow" },
  { id: "glass", label: "One ink: glass" },
] as const;
type InkMode = (typeof inkModes)[number]["id"];

const isStyle = (value: string): value is StageStyle => value === "framed" || materialIds.some((id) => id === value);
const isInkMode = (value: string): value is InkMode => inkModes.some((mode) => mode.id === value);

/** Every effect: screen effects stacked live over a solid, and the surface shaders as assets. */
export function Effects({ shaders, onOpen }: { readonly shaders: readonly AssetMeta[]; readonly onOpen: (meta: AssetMeta, trigger: HTMLElement) => void }) {
  const preset = usePreset();
  const [stack, setStack] = useState<readonly ScreenEffectId[]>(["scan", "lens"]);
  const [solid, setSolid] = useState<PrimitiveId>("archimedean-truncated-icosahedron");
  const [style, setStyle] = useState<StageStyle>("framed");
  const [ink, setInk] = useState<InkMode>("look");
  const host = useRef<HTMLDivElement>(null);
  // The sweep comes round every 4 s here, not 9, so it shows up while you look.
  const effects = useMemo((): readonly ScreenEffectConfig[] => stack.map((id) => (id === "scan" ? { id, params: { period: 4 } } : { id })), [stack]);
  const monochrome: Hex | undefined = ink === "look" ? undefined : preset.scene[ink];

  return (
    <section aria-labelledby="effects-title" className="mt-6">
      <h2 id="effects-title" className="text-lg font-semibold">
        Effects
      </h2>
      <p className="mt-1 max-w-prose text-sm text-fg-muted">
        Screen effects from hedronite.com, printed in the look's inks. Stack them over any solid; point at the stage for the lens.
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[18rem_1fr]">
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Screen effects</legend>
            {screenEffectIds.map((id) => (
              <label key={id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={stack.includes(id)}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setStack((current) => (on ? [...current, id] : current.filter((other) => other !== id)));
                  }}
                />
                {screenEffectInfo[id].name}
                {screenEffectInfo[id].interactive === true ? <span className="text-fg-muted">(point or tap)</span> : null}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="effects-solid">Solid</label>
            <select
              id="effects-solid"
              className={field}
              value={solid}
              onChange={(event) => {
                if (isPrimitiveId(event.target.value)) setSolid(event.target.value);
              }}
            >
              {primitiveIds.map((id) => (
                <option key={id} value={id}>
                  {primitiveInfo(id).name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="effects-style">Surface</label>
            <select
              id="effects-style"
              className={field}
              value={style}
              onChange={(event) => {
                if (isStyle(event.target.value)) setStyle(event.target.value);
              }}
            >
              <option value="framed">Framed glass (hedronite.com)</option>
              {materialIds.map((id) => (
                <option key={id} value={id}>
                  {materialPreset(id).name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="effects-ink">Ink</label>
            <select
              id="effects-ink"
              className={field}
              value={ink}
              onChange={(event) => {
                if (isInkMode(event.target.value)) setInk(event.target.value);
              }}
            >
              {inkModes.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div ref={host} data-testid="effects-stage" className="overflow-hidden rounded-xl border border-line bg-surface-raised">
          <EffectStage
            effects={effects}
            palette={preset.scene}
            paletteId={preset.id}
            solid={solid}
            style={style}
            monochrome={monochrome}
            host={host}
            className="h-[22rem] w-full sm:h-[28rem]"
            label={`${primitiveInfo(solid).name} under ${stack.length === 0 ? "no screen effects" : stack.map((id) => screenEffectInfo[id].name).join(", ")}.`}
          />
        </div>
      </div>

      <section aria-labelledby="surface-title" className="mt-10">
        <h3 id="surface-title" className="font-semibold">
          Surface shaders
        </h3>
        <p className="mt-1 text-sm text-fg-muted">Effects that live on a surface instead of the whole frame. Open one to see it on a sphere.</p>
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
          {shaders.map((meta) => (
            <li key={meta.id}>
              <button
                type="button"
                onClick={(event) => {
                  onOpen(meta, event.currentTarget);
                }}
                className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-xl border border-line p-3 text-center hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <AssetPreview meta={meta} size={56} />
                <span className="text-sm">{meta.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
