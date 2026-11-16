import { CrystalCluster, FramedSolid, Lattice, LibraryObject, PrimitiveMesh, ScreenEffectsPass, StudioLights } from "@hedronite/lts-adapters";
import { Close } from "@hedronite/lts-icons/react";
import { isMaterialId, materialIds, materialPreset, type MaterialId } from "@hedronite/lts-materials";
import { screenEffectIds, screenEffectInfo, type ScreenEffectConfig } from "@hedronite/lts-postfx";
import { isPrimitiveId, primitiveIds, primitiveInfo, type PrimitiveId, type Vec3 } from "@hedronite/lts-primitives";
import type { Hex, ScenePalette } from "@hedronite/lts-tokens";
import { Canvas } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { arrange, isPlaceableObject, MAX_PLACEMENTS, placeableObjects, scaleOf, toJson, toTsx, type Composition, type InkMode, type Item, type Placement, type PlaceableObject } from "./composition";
import { CopyButton } from "./CopyButton";
import { usePreset } from "./look";
import { MaterialLineup } from "./MaterialLineup";
import { Controls, Environment, GpuCounts } from "./scene";

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

const objectName = (id: PlaceableObject): string => placeableObjects.find((object) => object.id === id)?.name ?? id;

/** How a placement reads in the scene list and in its remove button's name. */
function describePlacement(item: Item): string {
  switch (item.kind) {
    case "primitive":
      return `${primitiveInfo(item.primitive).name}, ${materialPreset(item.material).name}`;
    case "framed":
      return `Framed ${primitiveInfo(item.primitive).name.toLowerCase()}`;
    case "object":
      return item.object === "crystal-cluster" || item.object === "instanced-lattice" ? `${objectName(item.object)}, ${materialPreset(item.material).name}` : objectName(item.object);
  }
}

const tilt: [number, number, number] = [0.3, 0.5, 0];

function Placed({ placement, position, palette }: { readonly placement: Placement; readonly position: Vec3; readonly palette: ScenePalette }) {
  const at = { position, scale: scaleOf(placement), rotation: tilt };
  switch (placement.kind) {
    case "primitive":
      return <PrimitiveMesh primitive={placement.primitive} material={placement.material} palette={palette} {...at} />;
    case "framed":
      return <FramedSolid primitive={placement.primitive} faces={placement.faces} edges={placement.edges} palette={palette} {...at} />;
    case "object":
      switch (placement.object) {
        case "crystal-cluster":
          return <CrystalCluster count={14} spread={0.7} seed={11} material={placement.material} palette={palette} {...at} />;
        case "instanced-lattice":
          return <Lattice size={6} spacing={0.28} nodeScale={0.06} material={placement.material} palette={palette} {...at} />;
        case "dress-watch":
        case "your-desk-lamp":
          return <LibraryObject object={placement.object} palette={palette} {...at} />;
      }
  }
}

/** Compose primitives, framed solids and objects in any material, under screen effects; export it as JSON or code. */
export function Playground() {
  const preset = usePreset();
  const [composition, setComposition] = useState<Composition>(starter);
  const [kind, setKind] = useState<AddKind>("primitive");
  const [primitive, setPrimitive] = useState<PrimitiveId>("platonic-dodecahedron");
  const [material, setMaterial] = useState<MaterialId>("ceramic");
  const [object, setObject] = useState<PlaceableObject>("dress-watch");
  const host = useRef<HTMLDivElement>(null);
  const positions = arrange(composition.placements.length);
  const full = composition.placements.length >= MAX_PLACEMENTS;
  const effects = useMemo((): readonly ScreenEffectConfig[] => composition.effects.map((id) => (id === "scan" ? { id, params: { period: 4 } } : { id })), [composition.effects]);
  const monochrome: Hex | undefined = composition.ink === "look" ? undefined : preset.scene[composition.ink];
  const takesMaterial = kind === "primitive" || (kind === "object" && (object === "crystal-cluster" || object === "instanced-lattice"));

  const item = ((): Item => {
    switch (kind) {
      case "primitive":
        return { kind, primitive, material };
      case "framed":
        return { kind, primitive, faces: "glass", edges: "metal" };
      case "object":
        return { kind, object, material };
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
                if (isAddKind(event.target.value)) setKind(event.target.value);
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
                  if (isPlaceableObject(event.target.value)) setObject(event.target.value);
                }}
              >
                {placeableObjects.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
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
              <label htmlFor="playground-material">Material</label>
              <select
                id="playground-material"
                className={field}
                value={material}
                onChange={(event) => {
                  if (isMaterialId(event.target.value)) setMaterial(event.target.value);
                }}
              >
                {materialIds.map((id) => (
                  <option key={id} value={id}>
                    {materialPreset(id).name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">{kind === "framed" ? "Glass faces, metal edges in the look's accent." : "Built from its spec, in the look's colors."}</p>
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
              const label = describePlacement(placement);
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
              <label key={id} className="flex items-center gap-2 text-sm">
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
          <div
            ref={host}
            role="img"
            aria-label={`The composed scene: ${String(composition.placements.length)} things${composition.effects.length === 0 ? "" : `, under ${composition.effects.map((id) => screenEffectInfo[id].name).join(", ")}`}. Drag to rotate, scroll to zoom.`}
            className="h-96 overflow-hidden rounded-xl border border-line bg-surface-raised"
            data-testid="playground-viewport"
          >
            {/* Screen effects animate, so the scene renders every frame while any are on. */}
            <Canvas frameloop={composition.effects.length === 0 ? "demand" : "always"} dpr={[1, 2]} camera={{ position: [0, 2.2, 5.5], fov: 40 }}>
              <Environment />
              <StudioLights intensity={composition.lightIntensity} />
              <Controls />
              {composition.placements.map((placement, i) => (
                <Placed key={placement.key} placement={placement} position={positions[i] ?? [0, 0, 0]} palette={preset.scene} />
              ))}
              {effects.length === 0 ? null : <ScreenEffectsPass effects={effects} palette={preset.scene} {...(monochrome === undefined ? {} : { monochrome })} />}
              <GpuCounts target={host} />
            </Canvas>
          </div>
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
