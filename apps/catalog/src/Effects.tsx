import type { AssetMeta } from "@hedronite/lts-core";
import { materialIds, materialPreset } from "@hedronite/lts-materials";
import { screenEffectIds, screenEffectInfo, type ScreenEffectId } from "@hedronite/lts-postfx";
import { primitiveIds, primitiveInfo } from "@hedronite/lts-primitives";
import { effectIds, effectInfo, isEffectId } from "@hedronite/lts-shaders";
import type { Hex } from "@hedronite/lts-tokens";
import { useRef, useState } from "react";
import { AssetPreview } from "./AssetPreview";
import { EffectStage } from "./EffectStage";
import { usePreset } from "./look";
import { usePlaceable, type Placeable } from "./placeable";
import { useStageEffects } from "./stageEffects";
import { parseSubject, parseSurface, subjectValue, surfaceValue, type StageSubject, type StageSurface } from "./stage";

const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";

/** One-ink prints, from the look's own colors. */
const inkModes = [
  { id: "look", label: "From the look (two inks)" },
  { id: "accent", label: "One ink: accent" },
  { id: "emissive", label: "One ink: glow" },
  { id: "glass", label: "One ink: glass" },
] as const;
type InkMode = (typeof inkModes)[number]["id"];
const isInkMode = (value: string): value is InkMode => inkModes.some((mode) => mode.id === value);

const subjectName = (subject: StageSubject, objects: readonly Placeable[]): string =>
  subject.kind === "solid" ? primitiveInfo(subject.id).name : (objects.find((object) => object.id === subject.id)?.name ?? subject.id);

const surfaceName = (surface: StageSurface): string => {
  switch (surface.kind) {
    case "own":
      return "its own materials";
    case "framed":
      return "framed glass";
    case "material":
      return materialPreset(surface.id).name;
    case "shader":
      return effectInfo[surface.id].name;
  }
};

/**
 * Every effect on one stage: a solid or a real object, surfaced in framed glass, any material or any
 * surface shader, under any stack of screen effects.
 */
export function Effects({ shaders }: { readonly shaders: readonly AssetMeta[] }) {
  const preset = usePreset();
  const { objects, failed } = usePlaceable();
  const [stack, setStack] = useState<readonly ScreenEffectId[]>(["scan", "lens"]);
  const [subject, setSubject] = useState<StageSubject>({ kind: "solid", id: "archimedean-truncated-icosahedron" });
  const [surface, setSurface] = useState<StageSurface>({ kind: "framed" });
  const [ink, setInk] = useState<InkMode>("look");
  const host = useRef<HTMLDivElement>(null);
  const effects = useStageEffects(stack);
  const monochrome: Hex | undefined = ink === "look" ? undefined : preset.scene[ink];
  // Solids have no surface of their own, objects can't be framed: offer what applies.
  const plain: StageSurface = subject.kind === "solid" ? { kind: "framed" } : { kind: "own" };
  const shown = surface.kind === "own" || surface.kind === "framed" ? plain : surface;

  return (
    <section aria-labelledby="effects-title" className="mt-6">
      <h2 id="effects-title" className="text-lg font-semibold">
        Effects
      </h2>
      <p className="mt-1 max-w-prose text-sm text-fg-muted">
        Surface shaders and screen effects on one stage. Put a shader on a solid or a real object, stack screen effects from hedronite.com over it in the look's inks, and point at the stage for the lens.
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[18rem_1fr]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="effects-subject">Subject</label>
            <select
              id="effects-subject"
              className={field}
              value={subjectValue(subject)}
              onChange={(event) => {
                const next = parseSubject(event.target.value, objects);
                if (next !== undefined) setSubject(next);
              }}
            >
              <optgroup label="Objects">
                {objects.map((object) => (
                  <option key={object.id} value={subjectValue({ kind: "object", id: object.id })}>
                    {object.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Solids">
                {primitiveIds.map((id) => (
                  <option key={id} value={subjectValue({ kind: "solid", id })}>
                    {primitiveInfo(id).name}
                  </option>
                ))}
              </optgroup>
            </select>
            {failed ? (
              <p role="alert" className="text-fg-muted">
                The objects could not be loaded. Reload the page to try again.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="effects-surface">Surface</label>
            <select
              id="effects-surface"
              className={field}
              value={surfaceValue(shown)}
              onChange={(event) => {
                const next = parseSurface(event.target.value);
                if (next !== undefined) setSurface(next);
              }}
            >
              <option value={surfaceValue(plain)}>{plain.kind === "framed" ? "Framed glass (hedronite.com)" : "Its own materials"}</option>
              <optgroup label="Surface shaders">
                {effectIds.map((id) => (
                  <option key={id} value={surfaceValue({ kind: "shader", id })}>
                    {effectInfo[id].name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Materials">
                {materialIds.map((id) => (
                  <option key={id} value={surfaceValue({ kind: "material", id })}>
                    {materialPreset(id).name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Screen effects</legend>
            {screenEffectIds.map((id) => (
              <label key={id} className="flex min-h-6 items-center gap-2 text-sm">
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
          {stack.length === 0 ? null : (
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
          )}
        </div>

        <div ref={host} data-testid="effects-stage" className="overflow-hidden rounded-xl border border-line bg-surface-raised">
          <EffectStage
            effects={effects}
            palette={preset.scene}
            subject={subject}
            surface={shown}
            monochrome={monochrome}
            host={host}
            className="h-[22rem] w-full sm:h-[28rem]"
            label={`${subjectName(subject, objects)} in ${surfaceName(shown)}, under ${stack.length === 0 ? "no screen effects" : stack.map((id) => screenEffectInfo[id].name).join(", ")}.`}
          />
        </div>
      </div>

      <section aria-labelledby="surface-title" className="mt-10">
        <h3 id="surface-title" className="font-semibold">
          Surface shaders
        </h3>
        <p className="mt-1 text-sm text-fg-muted">Effects that live on a surface. Pick one to put it on the stage, under whatever screen effects are on.</p>
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
          {shaders.map((meta) => {
            const id = meta.id;
            if (!isEffectId(id)) return null;
            const on = shown.kind === "shader" && shown.id === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setSurface({ kind: "shader", id });
                    host.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                  }}
                  className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-xl border border-line p-3 text-center hover:bg-surface-raised aria-pressed:border-accent aria-pressed:ring-2 aria-pressed:ring-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <AssetPreview meta={meta} size={56} />
                  <span className="text-sm">{meta.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}
