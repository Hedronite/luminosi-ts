import { EffectClockProvider, Scene } from "@hedronite/lts-adapters";
import { WebGPUCanvas } from "@hedronite/lts-adapters/webgpu";
import { Close } from "@hedronite/lts-icons/react";
import { isMaterialId, materialIds, materialPreset, type MaterialId } from "@hedronite/lts-materials";
import { isScreenEffectId, screenEffectIds, screenEffectInfo } from "@hedronite/lts-postfx";
import { isPrimitiveId, primitiveIds, primitiveInfo, type PrimitiveId } from "@hedronite/lts-primitives";
import { ringLayout, type InkMode, type Scene as SceneDocument, type SceneNode } from "@hedronite/lts-scene";
import { toCanonicalJson, toTsx, toVanilla } from "@hedronite/lts-scene/emit";
import { effectIds, effectInfo, isEffectId, type EffectId } from "@hedronite/lts-shaders";
import { useMemo, useRef, useState } from "react";
import type { Object3D } from "three";
import { CopyButton } from "./CopyButton";
import { usePreset } from "./look";
import { MaterialLineup } from "./MaterialLineup";
import { stageFrameloop, useStageShown, WakeOnShow } from "./onscreen";
import { usePlaceable, type Placeable } from "./placeable";
import { Controls, GpuCounts, StageClock, StageFrame, useMotion } from "./scene";
import { useShaderClock } from "./shaderClock";

const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";

/** The most things the playground holds at once. */
const MAX_NODES = 8;

/** One thing to add: a primitive in a material or a surface shader, a framed solid (its faces in either), or a library object. */
type Item =
  | { readonly kind: "primitive"; readonly primitive: PrimitiveId; readonly material: MaterialId; readonly shader?: EffectId }
  | { readonly kind: "framed"; readonly primitive: PrimitiveId; readonly faces: MaterialId; readonly edges: MaterialId; readonly shader?: EffectId }
  | { readonly kind: "object"; readonly object: string; readonly material?: MaterialId };
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

/** How big each kind of thing is drawn: primitives and framed solids are about a unit across, objects are built larger. */
const SHAPE_SCALE = 0.5;
const OBJECT_SCALE = 0.6;

let lastNode = 0;
const newId = (): string => {
  lastNode += 1;
  return `node-${String(lastNode)}`;
};

/**
 * The node for an item. It starts at the origin, turned the way the playground has always turned its scene (the tilt a version 0
 * composition is given on migrating), and `arranged` puts it on the ring.
 */
function nodeFor(item: Item, id: string): SceneNode {
  const at = (scale: number): Pick<SceneNode, "id" | "parent" | "position" | "rotation" | "scale"> => ({ id, parent: null, position: [0, 0, 0], rotation: [0.3, 0.5, 0], scale: [scale, scale, scale] });
  switch (item.kind) {
    case "primitive":
      return { ...at(SHAPE_SCALE), asset: { kind: "primitive", id: item.primitive }, surface: item.shader === undefined ? { material: item.material } : { shader: item.shader } };
    case "framed":
      return { ...at(SHAPE_SCALE), asset: { kind: "framed", id: item.primitive, edges: { material: item.edges } }, surface: item.shader === undefined ? { material: item.faces } : { shader: item.shader } };
    case "object":
      return { ...at(OBJECT_SCALE), asset: { kind: "object", id: item.object, ...(item.material === undefined ? {} : { params: { material: item.material } }) } };
  }
}

/** The nodes on the ring, each at its place on it: a node added or removed puts every one at its place for the new count. */
function arranged(nodes: readonly SceneNode[]): SceneNode[] {
  const ring = ringLayout(nodes.length);
  return nodes.map((node, index): SceneNode => {
    const [x, y, z] = ring[index] ?? [0, 0, 0];
    return { ...node, position: [x, y, z] };
  });
}

const starter: SceneDocument = {
  format: "lts-scene",
  version: 1,
  look: "neutral",
  seed: 0,
  nodes: arranged([
    nodeFor({ kind: "primitive", primitive: "platonic-cube", material: "satin" }, newId()),
    nodeFor({ kind: "framed", primitive: "archimedean-truncated-icosahedron", faces: "glass", edges: "metal" }, newId()),
    nodeFor({ kind: "primitive", primitive: "platonic-octahedron", material: "metal" }, newId()),
  ]),
  lights: { rig: "studio", intensity: 1 },
  environment: { kind: "studio" },
  camera: { position: [0, 2.2, 5.5], target: [0, 0, 0], fov: 40 },
  effects: [],
  ink: "look",
};

const objectName = (id: string, objects: readonly Placeable[]): string => objects.find((object) => object.id === id)?.name ?? id;

const shaderName = (id: string): string => (isEffectId(id) ? effectInfo[id].name : id);
const materialName = (id: string): string => (isMaterialId(id) ? materialPreset(id).name : id);
const primitiveName = (id: string): string => (isPrimitiveId(id) ? primitiveInfo(id).name : id);

/** How a node reads in the scene list and in its remove button's name. */
function describeNode({ asset, surface }: SceneNode, objects: readonly Placeable[]): string {
  const surfaceName = surface === undefined ? undefined : "shader" in surface ? shaderName(surface.shader) : materialName(surface.material);
  switch (asset.kind) {
    case "primitive":
      return `${primitiveName(asset.id)}, ${surfaceName ?? materialName("satin")}`;
    case "framed":
      return `Framed ${primitiveName(asset.id).toLowerCase()}${surface !== undefined && "shader" in surface ? `, ${shaderName(surface.shader)}` : ""}`;
    case "object": {
      const material = asset.params?.["material"];
      return typeof material === "string" ? `${objectName(asset.id, objects)}, ${materialName(material)}` : objectName(asset.id, objects);
    }
  }
}

/** Compose primitives, framed solids and objects in any material, under screen effects. The scene is a document: it is drawn from it, and exported from it as JSON, React and three.js. */
export function Playground() {
  const preset = usePreset();
  const [doc, setDoc] = useState<SceneDocument>(starter);
  const [kind, setKind] = useState<AddKind>("primitive");
  const [primitive, setPrimitive] = useState<PrimitiveId>("platonic-dodecahedron");
  const [material, setMaterial] = useState<MaterialId>("ceramic");
  // A surface shader in place of the material, for primitives and framed faces.
  const [shader, setShader] = useState<EffectId | undefined>(undefined);
  const { objects, failed: objectsFailed } = usePlaceable();
  const [object, setObject] = useState<string>("dress-watch");
  const full = doc.nodes.length >= MAX_NODES;
  // What is drawn and exported: the document, in the look the viewer is in.
  const shown = useMemo<SceneDocument>(() => ({ ...doc, look: preset.id }), [doc, preset.id]);
  const exports = useMemo(() => [
    { label: "JSON export", code: toCanonicalJson(shown) },
    { label: "React export", code: toTsx(shown) },
    { label: "Vanilla export", code: toVanilla(shown) },
  ], [shown]);
  // The graph the scene draws on the WebGPU renderer is its own, so the counters are given it.
  const built = useRef<Object3D | undefined>(undefined);
  const takesShader = kind === "primitive" || kind === "framed";
  // Of the objects, the ones whose descriptor has a material take one; the rest bring their own.
  const objectTakesMaterial = objects.find((option) => option.id === object)?.takesMaterial === true;
  const takesMaterial = takesShader || objectTakesMaterial;
  const withShader = takesShader && shader !== undefined ? { shader } : {};
  const animated = doc.effects.length > 0 || doc.nodes.some(({ surface }) => surface !== undefined && "shader" in surface && isEffectId(surface.shader) && effectInfo[surface.shader].animated === true);
  const host = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const { clock: shaderClock, write: writeShaderTime } = useShaderClock();
  const motion = useMotion(animated);
  const onscreen = useStageShown(host);

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
              setDoc((d) => ({ ...d, nodes: arranged([...d.nodes, nodeFor(item, newId())]) }));
            }}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          >
            {full ? `Scene is full (${String(MAX_NODES)})` : "Add to scene"}
          </button>

          <ol aria-label="Scene" className="flex flex-col gap-1">
            {doc.nodes.map((node) => {
              const label = describeNode(node, objects);
              return (
                <li key={node.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5 text-sm">
                  {label}
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() => {
                      setDoc((d) => ({ ...d, nodes: arranged(d.nodes.filter((other) => other.id !== node.id)) }));
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
                  checked={doc.effects.some((effect) => effect.id === id)}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setDoc((d) => ({ ...d, effects: on ? [...d.effects, { id }] : d.effects.filter((effect) => effect.id !== id) }));
                  }}
                />
                {screenEffectInfo[id].name}
              </label>
            ))}
          </fieldset>
          {doc.effects.length === 0 ? null : (
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="playground-ink">Ink</label>
              <select
                id="playground-ink"
                className={field}
                value={doc.ink}
                onChange={(event) => {
                  const next = event.target.value;
                  if (isInkMode(next)) setDoc((d) => ({ ...d, ink: next }));
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
              Light <output>{doc.lights.intensity.toFixed(1)}</output>
            </span>
            <input
              type="range"
              min={0.2}
              max={2.5}
              step={0.1}
              value={doc.lights.intensity}
              onChange={(event) => {
                setDoc((d) => ({ ...d, lights: { ...d.lights, intensity: Number(event.target.value) } }));
              }}
            />
          </label>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <StageFrame
            group={host}
            motion={motion}
            label={`The composed scene: ${String(doc.nodes.length)} things${doc.effects.length === 0 ? "" : `, under ${doc.effects.map(({ id }) => (isScreenEffectId(id) ? screenEffectInfo[id].name : id)).join(", ")}`}.`}
            className="h-96 overflow-hidden rounded-xl border border-line bg-surface-raised"
            testId="playground-viewport"
          >
            {/* Screen effects and some shaders animate, so the scene renders every frame while any are on. */}
            {/* The WebGPU renderer (WebGL 2 where WebGPU is missing) runs surface shaders and screen effects together; the scene brings its own lights, environment and effects. */}
            <WebGPUCanvas frameloop={stageFrameloop(onscreen, !animated || motion.still)} dpr={[1, 2]} camera={{ position: [0, 2.2, 5.5], fov: 40 }}>
              <WakeOnShow shown={onscreen} />
              <Controls keys={host} />
              <StageClock clockRef={clock} running={animated && !motion.still} writeShaderTime={writeShaderTime} />
              <EffectClockProvider clock={shaderClock}>
                <Scene
                  doc={shown}
                  palette={preset.scene}
                  onRoot={(root) => {
                    built.current = root;
                  }}
                />
              </EffectClockProvider>
              <GpuCounts target={host} clockRef={clock} shaderClock={shaderClock} watch={built} />
            </WebGPUCanvas>
          </StageFrame>
          {exports.map((snippet) => (
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
