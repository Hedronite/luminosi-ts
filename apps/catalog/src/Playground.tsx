import { FramedSolid, LibraryObject, PrimitiveMesh, StudioLights } from "@hedronite/lts-adapters";
import { ScreenEffectsPass, WebGPUCanvas, WebGPUStudioEnvironment } from "@hedronite/lts-adapters/webgpu";
import { Close } from "@hedronite/lts-icons/react";
import { isMaterialId, materialIds, materialPreset, type MaterialId } from "@hedronite/lts-materials";
import { screenEffectIds, screenEffectInfo, type ScreenEffectConfig } from "@hedronite/lts-postfx";
import { isPrimitiveId, primitiveIds, primitiveInfo, type PrimitiveId, type Vec3 } from "@hedronite/lts-primitives";
import { effectIds, effectInfo, isEffectId, type EffectId } from "@hedronite/lts-shaders";
import type { Hex, ScenePalette } from "@hedronite/lts-tokens";
import { useMemo, useRef, useState } from "react";
import { arrange, MAX_PLACEMENTS, scaleOf, toJson, toTsx, type Composition, type InkMode, type Item, type Placement } from "./composition";
import { CopyButton } from "./CopyButton";
import { usePreset } from "./look";
import { MaterialLineup } from "./MaterialLineup";
import { stageFrameloop, useStageShown, WakeOnShow } from "./onscreen";
import { usePlaceable, type Placeable } from "./placeable";
import { stageEffect } from "./presentation";
import { Controls, GpuCounts, StageClock, StageFrame, useMotion } from "./scene";

const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";

type AddKind = Item["kind"];
const addKinds: readonly (readonly [AddKind, string])[] = [
  ["primitive", "Primitive"],
  ["framed", "Framed solid"],
  ["object", "Object"],
];
const isAddKind = (value: string): value is AddKind => addKinds.some(([kind]) => kind === value);

const inkModes: readonly (readonly [InkMode, string])[] = [
  ["look", "From the look (two inks)"],
  ["accent", "One ink: accent"],
  ["emissive", "One ink: glow"],
  ["glass", "One ink: glass"],
];
const isInkMode = (value: string): value is InkMode => inkModes.some(([mode]) => mode === value);

let nextKey = 0;
const keyed = (item: Item): Placement => {
  nextKey += 1;
  return { ...item, key: String(nextKey) };
};

const starter: Composition = {
  lightIntensity: 1,
  effects: [],
  ink: "look",
  placements: [
    keyed({ kind: "primitive", primitive: "platonic-cube", material: "satin" }),
    keyed({ kind: "framed", primitive: "archimedean-truncated-icosahedron", faces: "glass", edges: "metal" }),
    keyed({ kind: "primitive", primitive: "platonic-octahedron", material: "metal" }),
  ],
};

const objectName = (id: string, objects: readonly Placeable[]): string => objects.find((object) => object.id === id)?.name ?? id;

/** How a placement reads in the scene list and in its remove button's name. */
function describePlacement(item: Item, objects: readonly Placeable[]): string {
  switch (item.kind) {
    case "primitive":
      return `${primitiveInfo(item.primitive).name}, ${item.shader === undefined ? materialPreset(item.material).name : effectInfo[item.shader].name}`;
    case "framed":
      return `Framed ${primitiveInfo(item.primitive).name.toLowerCase()}${item.shader === undefined ? "" : `, ${effectInfo[item.shader].name}`}`;
    case "object":
      return item.material === undefined ? objectName(item.object, objects) : `${objectName(item.object, objects)}, ${materialPreset(item.material).name}`;
  }
}

const tilt: [number, number, number] = [0.3, 0.5, 0];

function Placed({ placement, position, palette }: { readonly placement: Placement; readonly position: Vec3; readonly palette: ScenePalette }) {
  const at = { position, scale: scaleOf(placement), rotation: tilt };
  switch (placement.kind) {
    case "primitive":
      return <PrimitiveMesh primitive={placement.primitive} material={placement.material} {...(placement.shader === undefined ? {} : { shader: placement.shader })} palette={palette} {...at} />;
    case "framed":
      return <FramedSolid primitive={placement.primitive} faces={placement.faces} {...(placement.shader === undefined ? {} : { shader: placement.shader })} edges={placement.edges} palette={palette} {...at} />;
    case "object":
      return <LibraryObject object={placement.object} {...(placement.material === undefined ? {} : { params: { material: placement.material } })} palette={palette} {...at} />;
  }
}

/** Compose primitives, framed solids and objects in any material, under screen effects; export it as JSON or code. */
export function Playground() {
  const preset = usePreset();
  const [composition, setComposition] = useState<Composition>(starter);
  const [kind, setKind] = useState<AddKind>("primitive");
  const [primitive, setPrimitive] = useState<PrimitiveId>("platonic-dodecahedron");
  const [material, setMaterial] = useState<MaterialId>("ceramic");
  // A surface shader in place of the material, for primitives and framed faces.
  const [shader, setShader] = useState<EffectId | undefined>(undefined);
  const { objects, failed: objectsFailed } = usePlaceable();
  const [object, setObject] = useState<string>("dress-watch");
  const positions = arrange(composition.placements.length);
  const full = composition.placements.length >= MAX_PLACEMENTS;
  const effects = useMemo((): readonly ScreenEffectConfig[] => composition.effects.map((id) => stageEffect(id, 4)), [composition.effects]);
  const monochrome: Hex | undefined = composition.ink === "look" ? undefined : preset.scene[composition.ink];
  const takesShader = kind === "primitive" || kind === "framed";
  // Of the objects, the ones whose descriptor has a material take one; the rest bring their own.
  const objectTakesMaterial = objects.find((option) => option.id === object)?.takesMaterial === true;
  const takesMaterial = takesShader || objectTakesMaterial;
  const withShader = takesShader && shader !== undefined ? { shader } : {};
  const animated = composition.effects.length > 0 || composition.placements.some((placement) => placement.kind !== "object" && placement.shader !== undefined && effectInfo[placement.shader].animated === true);
  const host = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const motion = useMotion(animated);
  const shown = useStageShown(host);

  const item = ((): Item => {
    switch (kind) {
      case "primitive":
        return { kind, primitive, material, ...withShader };
      case "framed":
        return { kind, primitive, faces: material, edges: "metal", ...withShader };
      case "object":
        return { kind, object, ...(objectTakesMaterial ? { material } : {}) };
    }
  })();

  return (
    <>
      <section aria-labelledby="playground-title" className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="flex flex-col gap-4">
          <h2 id="playground-title" className="text-lg font-semibold">
            Playground
          </h2>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="playground-kind">Add</label>
            <select
              id="playground-kind"
              className={field}
              value={kind}
              onChange={(event) => {
                const next = event.target.value;
                if (!isAddKind(next)) return;
                setKind(next);
                // Framed solids start in glass, as on hedronite.com.
                if (next === "framed" && shader === undefined) setMaterial("glass");
              }}
            >
              {addKinds.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {kind === "object" ? (
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="playground-object">Object</label>
              <select
                id="playground-object"
                className={field}
                value={object}
                onChange={(event) => {
                  setObject(event.target.value);
                }}
              >
                {objects.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              {objectsFailed ? (
                <p role="alert" className="text-fg-muted">
                  The objects could not be loaded. Reload the page to try again.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="playground-primitive">Primitive</label>
              <select
                id="playground-primitive"
                className={field}
                value={primitive}
                onChange={(event) => {
                  if (isPrimitiveId(event.target.value)) setPrimitive(event.target.value);
                }}
              >
                {primitiveIds.map((id) => (
                  <option key={id} value={id}>
                    {primitiveInfo(id).name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {takesMaterial ? (
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="playground-material">{kind === "framed" ? "Faces" : "Surface"}</label>
              <select
                id="playground-material"
                className={field}
                value={takesShader && shader !== undefined ? `shader:${shader}` : material}
                onChange={(event) => {
                  const value = event.target.value;
                  const shaderId = value.startsWith("shader:") ? value.slice("shader:".length) : "";
                  if (isEffectId(shaderId)) {
                    setShader(shaderId);
                  } else if (isMaterialId(value)) {
                    setMaterial(value);
                    setShader(undefined);
                  }
                }}
              >
                <optgroup label="Materials">
                  {materialIds.map((id) => (
                    <option key={id} value={id}>
                      {materialPreset(id).name}
                    </option>
                  ))}
                </optgroup>
                {takesShader ? (
                  <optgroup label="Surface shaders">
                    {effectIds.map((id) => (
                      <option key={id} value={`shader:${id}`}>
                        {effectInfo[id].name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              {kind === "framed" ? <p className="text-fg-muted">Edges in metal, in the look's accent.</p> : null}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">Built from its spec, in the look's colors.</p>
          )}
          <button
            type="button"
            disabled={full}
            onClick={() => {
              setComposition((c) => ({ ...c, placements: [...c.placements, keyed(item)] }));
            }}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          >
            {full ? `Scene is full (${String(MAX_PLACEMENTS)})` : "Add to scene"}
          </button>

          <ol aria-label="Scene" className="flex flex-col gap-1">
            {composition.placements.map((placement) => {
              const label = describePlacement(placement, objects);
              return (
                <li key={placement.key} className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5 text-sm">
                  {label}
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() => {
                      setComposition((c) => ({ ...c, placements: c.placements.filter((p) => p.key !== placement.key) }));
                    }}
                    className="rounded p-1 hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <Close size={16} />
                  </button>
                </li>
              );
            })}
          </ol>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Screen effects</legend>
            {screenEffectIds.map((id) => (
              <label key={id} className="flex min-h-6 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={composition.effects.includes(id)}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setComposition((c) => ({ ...c, effects: on ? [...c.effects, id] : c.effects.filter((other) => other !== id) }));
                  }}
                />
                {screenEffectInfo[id].name}
              </label>
            ))}
          </fieldset>
          {composition.effects.length === 0 ? null : (
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="playground-ink">Ink</label>
              <select
                id="playground-ink"
                className={field}
                value={composition.ink}
                onChange={(event) => {
                  const next = event.target.value;
                  if (isInkMode(next)) setComposition((c) => ({ ...c, ink: next }));
                }}
              >
                {inkModes.map(([mode, label]) => (
                  <option key={mode} value={mode}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span>
              Light <output>{composition.lightIntensity.toFixed(1)}</output>
            </span>
            <input
              type="range"
              min={0.2}
              max={2.5}
              step={0.1}
              value={composition.lightIntensity}
              onChange={(event) => {
                setComposition((c) => ({ ...c, lightIntensity: Number(event.target.value) }));
              }}
            />
          </label>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <StageFrame
            group={host}
            motion={motion}
            label={`The composed scene: ${String(composition.placements.length)} things${composition.effects.length === 0 ? "" : `, under ${composition.effects.map((id) => screenEffectInfo[id].name).join(", ")}`}.`}
            className="h-96 overflow-hidden rounded-xl border border-line bg-surface-raised"
            testId="playground-viewport"
          >
            {/* Screen effects and some shaders animate, so the scene renders every frame while any are on. */}
            {/* The WebGPU renderer (WebGL 2 where WebGPU is missing) runs surface shaders and screen effects together. */}
            <WebGPUCanvas frameloop={stageFrameloop(shown, !animated || motion.still)} dpr={[1, 2]} camera={{ position: [0, 2.2, 5.5], fov: 40 }}>
              <WakeOnShow shown={shown} />
              <WebGPUStudioEnvironment />
              <StudioLights intensity={composition.lightIntensity} />
              <Controls keys={host} />
              <StageClock clockRef={clock} running={animated && !motion.still} />
              {composition.placements.map((placement, i) => (
                <Placed key={placement.key} placement={placement} position={positions[i] ?? [0, 0, 0]} palette={preset.scene} />
              ))}
              {effects.length === 0 ? null : <ScreenEffectsPass effects={effects} palette={preset.scene} {...(monochrome === undefined ? {} : { monochrome })} />}
              <GpuCounts target={host} clockRef={clock} />
            </WebGPUCanvas>
          </StageFrame>
          {[
            { label: "JSON export", code: toJson(composition) },
            { label: "React export", code: toTsx(composition) },
          ].map((snippet) => (
            <section key={snippet.label} aria-label={snippet.label}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{snippet.label}</h3>
                <CopyButton text={snippet.code} what={snippet.label} />
              </div>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-surface-raised p-3 text-xs">
                <code>{snippet.code}</code>
              </pre>
            </section>
          ))}
        </div>
      </section>
      <MaterialLineup />
    </>
  );
}
