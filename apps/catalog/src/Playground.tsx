import { EffectClockProvider, Scene } from "@hedronite/lts-adapters";
import { WebGPUCanvas } from "@hedronite/lts-adapters/webgpu";
import { Close } from "@hedronite/lts-icons/react";
import { isMaterialId, materialIds, materialPreset, type MaterialId } from "@hedronite/lts-materials";
import { isScreenEffectId, screenEffectIds, screenEffectInfo } from "@hedronite/lts-postfx";
import { isPrimitiveId, primitiveIds, primitiveInfo, type PrimitiveId } from "@hedronite/lts-primitives";
import { addNode, canRedo, canUndo, createHistory, encodeScene, endGesture, push, redo, removeNode, ringLayout, setEffects, setEnvironment, setInk, setLights, setStage, setTransform, SHARE_LIMITS, undo, type InkMode, type Scene as SceneDocument, type SceneHistory, type SceneIssue, type SceneNode, type SceneResult } from "@hedronite/lts-scene";
import { toCanonicalJson, toTsx, toVanilla } from "@hedronite/lts-scene/emit";
import { effectIds, effectInfo, isEffectId, type EffectId } from "@hedronite/lts-shaders";
import { presets } from "@hedronite/lts-tokens";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Object3D } from "three";
import { noteEffectTargets } from "./builds";
import { CopyButton } from "./CopyButton";
import { usePreset } from "./look";
import { MaterialLineup } from "./MaterialLineup";
import { stageFrameloop, useStageShown, WakeOnShow } from "./onscreen";
import { usePlaceable, type Placeable } from "./placeable";
import { Controls, GpuCounts, StageClock, StageFrame, StageHold, useMotion } from "./scene";
import { describeIssue, fileNameFor, linkFor, openFile, openLink, sceneParam, stemOf, type Opened } from "./sceneFile";
import { useShaderClock } from "./shaderClock";
import { StageControls } from "./StageControls";
import { TrackPanel } from "./tracks/TrackPanel";
import { TransformPanel } from "./TransformPanel";
import { useCredits } from "./useCredits";

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
/** An id no node has: `node-` and the next number, skipping any that a document which was opened already uses. */
const newId = (taken: readonly SceneNode[] = []): string => {
  const used = new Set(taken.map((node) => node.id));
  do {
    lastNode += 1;
  } while (used.has(`node-${String(lastNode)}`));
  return `node-${String(lastNode)}`;
};

/**
 * The node for an item. It starts at the origin, turned the way the playground has always turned its scene (the tilt a version 0
 * composition is given on migrating), and `arranged` puts the starter's on the ring and `slotFor` puts a node added later on the next place.
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

/** The nodes on the ring, each at its place on it: the starter scene's. A node added later takes the next place, and none is moved after (a node is placed by hand once it can be). */
function arranged(nodes: readonly SceneNode[]): SceneNode[] {
  const ring = ringLayout(nodes.length);
  return nodes.map((node, index): SceneNode => {
    const [x, y, z] = ring[index] ?? [0, 0, 0];
    return { ...node, position: [x, y, z] };
  });
}

const starter: SceneDocument = {
  format: "lts-scene",
  version: 2,
  tracks: [],
  clips: [],
  rest: {},
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

/** What the playground says about the last thing a person did to the document: it was opened, or it could not be (and the document is as it was). */
type Note = { readonly kind: "ok"; readonly text: string } | { readonly kind: "problem"; readonly title: string; readonly issues: readonly SceneIssue[] };

/** The most issues listed at once; the rest are counted. */
const MAX_LISTED = 8;

/** Beside the controls, on a window wide and tall enough for both, the stage and its buttons stay in view while the controls scroll: a stage out of view draws nothing, and the controls are longer than the window. */
const stays = "[@media(min-width:64rem)_and_(min-height:40rem)]:sticky [@media(min-width:64rem)_and_(min-height:40rem)]:top-4";

const barButton = "rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";

/** The ids of the looks a scene may name. */
const lookIds = presets.map((preset) => preset.id);

/** The place on the ring for the node that makes `count` things: the slot after the ones the others hold, which nothing already there moves for. */
const slotFor = (count: number): [number, number, number] => {
  const [x, y, z] = ringLayout(count + 1)[count] ?? [0, 0, 0];
  return [x, y, z];
};

/** Whether the target of a key press is somewhere a person types text: there the browser's own undo is the one that applies. */
function typesText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && ["text", "search", "number", "email", "url", "tel", "password", ""].includes(target.type);
}

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
  // The document and what can be undone and redone of it. The viewer's look, the add form and the orbit are not in it.
  const [history, setHistory] = useState<SceneHistory>(() => createHistory(starter));
  const doc = history.present;
  const [note, setNote] = useState<Note | undefined>(undefined);
  // The node whose transform is being edited: by id, so it follows the document through an undo, and is none once the document has no such node.
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const selectedNode = doc.nodes.find((node) => node.id === selected) ?? null;
  // The name a saved file takes: the one that was opened, or "scene".
  const [name, setName] = useState("scene");
  // A link in the address opens its document in place of the starter, once.
  const [link] = useState(() => sceneParam(window.location.search));
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
  const json = useMemo(() => toCanonicalJson(shown), [shown]);
  // The code carries the credits of the work it uses (the same list `lumin scene credits` gives). They load in a chunk of their own when this view opens, and
  // the React and vanilla code is not shown before they are here: code shown without them would leave out what it owes, and so would a copy of it.
  const credits = useCredits();
  const exports = useMemo<readonly { readonly label: string; readonly code: string | undefined }[]>(() => {
    const options = credits.status === "ready" ? { credits: credits.creditsOf(shown) } : undefined;
    return [
      { label: "JSON export", code: json },
      { label: "React export", code: options === undefined ? undefined : toTsx(shown, options) },
      { label: "Vanilla export", code: options === undefined ? undefined : toVanilla(shown, options) },
    ];
  }, [json, shown, credits]);
  // The link for what the exports show, made for exactly that text (a link made for an earlier edit is never offered); null when it would be too long for a link.
  const [shared, setShared] = useState<{ readonly json: string; readonly link: string | null } | undefined>(undefined);
  const shareLink = shared?.json === json ? shared.link : undefined;
  useEffect(() => {
    let current = true;
    encodeScene(shown).then(
      (text) => {
        if (current) setShared({ json, link: text.length > SHARE_LIMITS.link ? null : linkFor(window.location, text) });
      },
      () => {
        if (current) setShared({ json, link: null });
      },
    );
    return () => {
      current = false;
    };
  }, [json, shown]);

  /** Makes `result` the document, as one step to undo (a step in the gesture `key` when it has one), or says why it cannot be. */
  const commit = (result: SceneResult, key?: string): void => {
    if (result.ok) {
      setHistory((h) => push(h, result.scene, key));
      setNote(undefined);
    } else {
      setNote({ kind: "problem", title: "That change could not be made", issues: result.issues });
    }
  };

  const take = (opened: Opened, source: string, replace: boolean): void => {
    if (opened.ok) {
      setHistory((h) => (replace ? createHistory(opened.scene) : push(h, opened.scene)));
      setNote({ kind: "ok", text: `Opened ${source}: ${String(opened.scene.nodes.length)} things.` });
    } else {
      setNote({ kind: "problem", title: `${opened.title} (${source})`, issues: opened.issues });
    }
  };

  // Undo and redo from the keyboard, anywhere but in a field that takes text.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || typesText(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) setHistory(undo);
      else if ((key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.metaKey)) setHistory(redo);
      else return;
      event.preventDefault();
      setNote(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // The link the page was opened on becomes the document, as the one to start from (nothing to undo to).
  useEffect(() => {
    if (link === undefined) return undefined;
    let current = true;
    openLink(link, lookIds, MAX_NODES).then((opened) => {
      if (current) take(opened, "the link", true);
    }, () => undefined);
    return () => {
      current = false;
    };
  }, [link]);
  const save = (): void => {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileNameFor(name);
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  };
  // The graph the scene draws on the WebGPU renderer is its own, so the counters are given it.
  const built = useRef<Object3D | undefined>(undefined);
  const takesShader = kind === "primitive" || kind === "framed";
  // Of the objects, the ones whose descriptor has a material take one; the rest bring their own.
  const objectTakesMaterial = objects.find((option) => option.id === object)?.takesMaterial === true;
  const takesMaterial = takesShader || objectTakesMaterial;
  const withShader = takesShader && shader !== undefined ? { shader } : {};
  // Tracks are motion as data: a document that carries them animates, like one with an animated effect or shader surface.
  const animated = doc.effects.length > 0 || doc.tracks.length > 0 || doc.nodes.some(({ surface }) => surface !== undefined && "shader" in surface && isEffectId(surface.shader) && effectInfo[surface.shader].animated === true);
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
          <div role="group" aria-label="Scene file and history" className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canUndo(history)}
              aria-keyshortcuts="Control+Z Meta+Z"
              onClick={() => {
                setHistory(undo);
                setNote(undefined);
              }}
              className={barButton}
            >
              Undo
            </button>
            <button
              type="button"
              disabled={!canRedo(history)}
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
              onClick={() => {
                setHistory(redo);
                setNote(undefined);
              }}
              className={barButton}
            >
              Redo
            </button>
            <label className={`${barButton} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent`}>
              Open scene
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  // Cleared, so the same file can be opened again after it changes on disk.
                  input.value = "";
                  if (file === undefined) return;
                  openFile(file, lookIds, MAX_NODES).then((opened) => {
                    if (opened.ok) setName(stemOf(file.name));
                    take(opened, file.name, false);
                  }, () => undefined);
                }}
              />
            </label>
            <button type="button" onClick={save} className={barButton}>
              Save
            </button>
            {shareLink === undefined ? null : shareLink === null ? (
              <span className="text-sm text-fg-muted">Too large to share as a link</span>
            ) : (
              <CopyButton text={shareLink} what="share link" />
            )}
          </div>
          {note === undefined ? null : note.kind === "ok" ? (
            <p role="status" className="text-sm text-fg-muted">
              {note.text}
            </p>
          ) : (
            <div role="alert" className="rounded-lg border border-line p-3 text-sm">
              <p className="font-medium">{note.title}</p>
              <ul className="mt-1 list-disc pl-5 text-fg-muted">
                {note.issues.slice(0, MAX_LISTED).map((issue, index) => (
                  <li key={`${describeIssue(issue)}:${String(index)}`}>{describeIssue(issue)}</li>
                ))}
              </ul>
              {note.issues.length > MAX_LISTED ? <p className="mt-1 text-fg-muted">and {String(note.issues.length - MAX_LISTED)} more</p> : null}
            </div>
          )}
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
              commit(addNode(doc, { ...nodeFor(item, newId(doc.nodes)), position: slotFor(doc.nodes.length) }));
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
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Edit transform of ${label}`}
                      aria-pressed={selected === node.id}
                      onClick={() => {
                        setSelected(node.id);
                      }}
                      className="min-h-6 rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-surface-raised aria-pressed:font-medium"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      onClick={() => {
                        commit(removeNode(doc, node.id));
                      }}
                      className="min-h-6 min-w-6 rounded p-1 hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <Close size={16} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>

          <TransformPanel
            key={selectedNode?.id ?? ""}
            node={selectedNode}
            {...(selectedNode === null ? {} : { label: describeNode(selectedNode, objects) })}
            onChange={(change, gesture) => {
              if (selectedNode !== null) commit(setTransform(doc, selectedNode.id, change), gesture);
            }}
            onGestureEnd={() => {
              setHistory(endGesture);
            }}
          />

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
                    commit(setEffects(doc, on ? [...doc.effects, { id }] : doc.effects.filter((effect) => effect.id !== id)));
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
                  if (isInkMode(next)) commit(setInk(doc, next));
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
                // One drag of the slider is one step to undo, however many values it passes through.
                commit(setLights(doc, { intensity: Number(event.target.value) }), "lights.intensity");
              }}
              onPointerUp={() => {
                setHistory(endGesture);
              }}
              onBlur={() => {
                setHistory(endGesture);
              }}
            />
          </label>

          <StageControls
            environment={doc.environment}
            stage={doc.stage}
            palette={preset.scene}
            distance={Math.hypot(...doc.camera.position.map((at, axis) => at - (doc.camera.target[axis] ?? 0)))}
            onEnvironment={(environment) => {
              commit(setEnvironment(doc, environment));
            }}
            onStage={(stage, gesture) => {
              commit(setStage(doc, stage), gesture);
            }}
            onGestureEnd={() => {
              setHistory(endGesture);
            }}
          />

          <TrackPanel doc={doc} commit={commit} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className={stays}>
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
                <StageHold holdRef={motion.holdRef} />
                <StageClock clockRef={clock} running={animated && !motion.still} writeShaderTime={writeShaderTime} />
                <EffectClockProvider clock={shaderClock}>
                  <Scene
                    doc={shown}
                    palette={preset.scene}
                    paused={motion.paused}
                    onRoot={(root) => {
                      built.current = root;
                    }}
                    onEffectTargets={(ids) => {
                      noteEffectTargets(host.current, ids);
                    }}
                  />
                </EffectClockProvider>
                <GpuCounts target={host} clockRef={clock} shaderClock={shaderClock} watch={built} screenEffects running={animated && !motion.still} />
              </WebGPUCanvas>
            </StageFrame>
          </div>
          {exports.map((snippet) => (
            <section key={snippet.label} aria-label={snippet.label}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{snippet.label}</h3>
                {snippet.code === undefined ? null : <CopyButton text={snippet.code} what={snippet.label} />}
              </div>
              {snippet.code === undefined ? (
                <p className="mt-2 rounded-lg bg-surface-raised p-3 text-xs text-fg-muted" role={credits.status === "failed" ? "alert" : "status"}>
                  {credits.status === "failed" ? "The credits that go with this code could not be loaded, so it is not shown: code that uses the work of others should say so. Reload to try again." : "Loading the credits that go with this code…"}
                </p>
              ) : (
                <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-surface-raised p-3 text-xs">
                  <code>{snippet.code}</code>
                </pre>
              )}
            </section>
          ))}
        </div>
      </section>
      <MaterialLineup />
    </>
  );
}
