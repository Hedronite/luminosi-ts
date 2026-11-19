import type { AssetDescriptor, DescriptorRegistry } from "@hedronite/lts-core";
import { isMaterialId, materialPreset, type MaterialId } from "@hedronite/lts-materials";
import { applyPalette as paintMaterials, createMaterial } from "@hedronite/lts-materials/three";
import { createFramedSolid } from "@hedronite/lts-objects/three";
import { screenEffectSchemas, type ScreenEffectConfig } from "@hedronite/lts-postfx";
import type * as Postfx from "@hedronite/lts-postfx/three";
import { isPrimitiveId, primitive } from "@hedronite/lts-primitives";
import { createStudioLights, disposeObject } from "@hedronite/lts-primitives/three";
import { loadDescriptors } from "@hedronite/lts-registry";
import { isEffectId } from "@hedronite/lts-shaders";
import type { EffectClock, EffectHandle } from "@hedronite/lts-shaders/three";
import { presets, type Hex, type ScenePalette } from "@hedronite/lts-tokens";
import { BufferGeometry, Group, Mesh, Object3D, PerspectiveCamera, Scene, Vector2, type Material, type Texture } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { z } from "zod";
import type { Scene as SceneDocument, SceneNode, SceneSurface } from "./index.js";

export type { SceneDocument };

/** Parameters by name, as a document holds them. */
export type NodeParams = NonNullable<SceneNode["asset"]["params"]>;

export interface SceneOptions {
  /** The scene colors to build in. Default: the document's own `look` (a look id, or an inline palette). */
  readonly palette?: ScenePalette;
  /**
   * The renderer the scene will be drawn on. With one, the scene also owns what needs it: the studio environment, the
   * screen-effect stack and the camera's aspect, and it can `render`. Without one it builds the nodes, the lights and the camera.
   */
  readonly renderer?: WebGPURenderer;
  /** Where surface shaders read time from. Default: three's wall clock. */
  readonly clock?: EffectClock;
  /** Skip the screen effects' intro and sweep, and open the lens at once. Fixed when the scene is made. */
  readonly reducedMotion?: boolean;
}

/** A pointer over the canvas, 0 to 1 from the top left, or null when it is away. */
export type ScenePointer = { readonly x: number; readonly y: number } | null;

export interface SceneHandle {
  /** Every node, in the document's hierarchy, and the lights. Add it to a scene; the handle owns what is in it. */
  readonly root: Group;
  /** Made from the document's camera. Its aspect follows the renderer's size at each `render`; set it yourself when drawing some other way. */
  readonly camera: PerspectiveCamera;
  /** Settles once every node (and, with a renderer, the environment and the effects) has built. Rejects if one could not. */
  readonly ready: Promise<void>;
  /**
   * Changes a node's parameters. A parameter of the node's surface shader is written into its uniform, with no new material, and
   * the promise resolves true. A parameter the shader builds in (toon's `bands`) or of the asset builds the node again, and it
   * resolves false once the new one is in place. A key both have goes to the shader.
   */
  set(nodeId: string, params: NodeParams): Promise<boolean>;
  /** Recolours what is built, in place: no node and no program is built again. Draw a new frame after it. */
  setLook(palette: ScenePalette): void;
  /**
   * Brings the scene to `doc`, by node id: a node with the same asset and surface only moves (its transform and a shader's
   * parameters are written in place), a changed node builds again and nothing else does. Added nodes build, removed ones are
   * freed, the lights and camera follow, and the effects' values are written (or the stack is built again, if its structure changed).
   * The document's `look` applies only while no palette was given. Resolves when the nodes it changed have built.
   */
  update(doc: SceneDocument): Promise<void>;
  /** Present with a renderer: draws one frame, through the effects if there are any. */
  readonly render?: (delta: number) => void;
  /** Present with a renderer: where the pointer is, for the lens effect. */
  readonly setPointer?: (pointer: ScenePointer) => void;
  /** Frees every geometry, material, texture, shader and pass the scene built, and stops builds that are under way. */
  dispose(): void;
}

/** What one node built: its object, and the parts that move without a new build. */
interface Built {
  readonly object: Object3D;
  readonly shader: EffectHandle | undefined;
  readonly recolor: (palette: ScenePalette) => void;
  readonly dispose: () => void;
}

/** What a renderer adds: the scene it draws, its environment, and the effect stack. */
interface Stage {
  readonly scene: Scene;
  environment: { dispose(): void; readonly texture: Texture } | undefined;
  effects: Postfx.ScreenEffects | undefined;
  /** What the running stack was built from (`stackStructure`). */
  structure: string;
  pointer: ScenePointer;
}

interface Slot {
  /** What is built, or being built. */
  spec: SceneNode;
  readonly group: Group;
  built: Built | undefined;
  controller: AbortController | undefined;
}

/** The document's effects as the stack takes them: each id one of the effects, its parameters checked against that effect's schema and filled with its defaults. */
const stackEntries = z.array(
  z.discriminatedUnion("id", [
    z.object({ id: z.literal("smoke"), params: screenEffectSchemas.smoke.prefault({}) }),
    z.object({ id: z.literal("crystallize"), params: screenEffectSchemas.crystallize.prefault({}) }),
    z.object({ id: z.literal("dither"), params: screenEffectSchemas.dither.prefault({}) }),
    z.object({ id: z.literal("ascii"), params: screenEffectSchemas.ascii.prefault({}) }),
    z.object({ id: z.literal("scan"), params: screenEffectSchemas.scan.prefault({}) }),
    z.object({ id: z.literal("lens"), params: screenEffectSchemas.lens.prefault({}) }),
    z.object({ id: z.literal("crt"), params: screenEffectSchemas.crt.prefault({}) }),
    z.object({ id: z.literal("grain"), params: screenEffectSchemas.grain.prefault({}) }),
  ]),
);

const isObject = (value: unknown): value is Object3D => value instanceof Object3D;

const hasShader = (surface: SceneSurface | undefined): surface is Extract<SceneSurface, { shader: string }> => surface !== undefined && "shader" in surface;

/** The parts of a node that cannot be written in place: its asset (a framed solid's edges included) and its surface, apart from a shader's parameters. */
const buildKey = ({ asset, surface }: SceneNode): string => JSON.stringify([stable(asset), surface === undefined ? null : hasShader(surface) ? ["shader", surface.shader] : stable(surface)]);

/** `value` with every object's keys in order, so two equal values give one text. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, each]) => [key, stable(each)]));
  return value;
}

const sameValues = (a: Readonly<Record<string, unknown>> | undefined, b: Readonly<Record<string, unknown>> | undefined): boolean => JSON.stringify(stable(a ?? {})) === JSON.stringify(stable(b ?? {}));

const isHex = (value: string): value is Hex => /^#[0-9a-f]{6}$/.test(value);

function lookOf(look: SceneDocument["look"]): ScenePalette {
  if (typeof look !== "string") {
    const { base, accent, metal, glass, emissive } = look;
    if (!isHex(base) || !isHex(accent) || !isHex(metal) || !isHex(glass) || !isHex(emissive)) throw new RangeError("the scene's look has a color that is not #rrggbb");
    return { base, accent, metal, glass, emissive };
  }
  const found = presets.find((preset) => preset.id === look);
  if (found === undefined) throw new RangeError(`the scene's look "${look}" is not a look`);
  return found.scene;
}

/** The scene colors with `material`'s own color slot replaced by the accent: edges and beads take the accent. */
const accented = (palette: ScenePalette, material: MaterialId): ScenePalette => ({ ...palette, [materialPreset(material).color]: palette.accent });

function descriptorOf(registry: DescriptorRegistry, id: string): AssetDescriptor {
  const found = registry.get(id);
  if (found === undefined) throw new RangeError(`no asset "${id}"`);
  return found;
}

interface Surface {
  readonly material: Material;
  readonly shader: EffectHandle | undefined;
  readonly recolor: (palette: ScenePalette) => void;
  readonly dispose: () => void;
}

/** A material preset, or a surface shader (its module loads here, on demand). */
async function makeSurface(surface: SceneSurface, palette: ScenePalette, clock: EffectClock | undefined): Promise<Surface> {
  if (hasShader(surface)) {
    if (!isEffectId(surface.shader)) throw new RangeError(`no surface shader "${surface.shader}"`);
    const { createEffect, applyPalette } = await import("@hedronite/lts-shaders/three");
    const effect = createEffect(surface.shader, surface.params ?? {}, palette, clock === undefined ? {} : { clock });
    return { material: effect.material, shader: effect, recolor: (look) => { applyPalette(effect, look); }, dispose: () => { effect.dispose(); } };
  }
  if (!isMaterialId(surface.material)) throw new RangeError(`no material "${surface.material}"`);
  const material = createMaterial(surface.material, palette);
  return { material, shader: undefined, recolor: (look) => { paintMaterials(material, look); }, dispose: () => { material.dispose(); } };
}

/** Builds one node's object. Whatever it made is freed again if a later step fails or `signal` aborts. */
async function buildNode(node: SceneNode, palette: ScenePalette, registry: DescriptorRegistry, clock: EffectClock | undefined, signal: AbortSignal): Promise<Built> {
  const { asset, surface } = node;
  const freed: (() => void)[] = [];
  const recolors: ((palette: ScenePalette) => void)[] = [];
  let shader: EffectHandle | undefined;
  try {
    let object: Object3D;
    if (asset.kind === "object") {
      const built = await descriptorOf(registry, asset.id).build(asset.params, palette, { signal });
      if (!isObject(built)) throw new TypeError(`${asset.id} does not build an object`);
      object = built;
      recolors.push((look) => { paintMaterials(built, look); });
    } else if (asset.kind === "primitive") {
      const geometry = await descriptorOf(registry, asset.id).build(asset.params, palette, { signal });
      if (!(geometry instanceof BufferGeometry)) throw new TypeError(`${asset.id} does not build a geometry`);
      freed.push(() => { geometry.dispose(); });
      const made = await makeSurface(surface ?? { material: "satin" }, palette, clock);
      freed.push(made.dispose);
      shader = made.shader;
      recolors.push(made.recolor);
      object = new Mesh(geometry, made.material);
    } else {
      if (!isPrimitiveId(asset.id)) throw new RangeError(`no primitive "${asset.id}"`);
      // The solid's own parameter is its primitive's (`scale`): it scales the whole framed solid, edges and beads with it.
      const { scale } = z.object({ scale: z.number().default(1) }).parse(descriptorOf(registry, asset.id).parameters.parse(asset.params ?? {}));
      const faces = await makeSurface(surface ?? { material: "glass" }, palette, clock);
      freed.push(faces.dispose);
      shader = faces.shader;
      const edgesId = asset.edges.material;
      if (!isMaterialId(edgesId)) throw new RangeError(`no material "${edgesId}"`);
      const edges = createMaterial(edgesId, palette, (look) => accented(look, edgesId));
      freed.push(() => { edges.dispose(); });
      const framed = createFramedSolid(primitive(asset.id), { faces: faces.material, edges });
      framed.scale.setScalar(scale);
      object = framed;
      recolors.push((look) => { paintMaterials(framed, look); }, faces.recolor);
    }
    signal.throwIfAborted();
    const built = object;
    return {
      object: built,
      shader,
      recolor: (look) => { for (const recolor of recolors) recolor(look); },
      dispose: () => {
        // The object's own geometry, materials and textures first; what was made beside it (a shader's handle) after.
        disposeObject(built);
        for (const free of freed) free();
      },
    };
  } catch (error) {
    for (const free of freed) free();
    throw error;
  }
}

/** Creates the scene a document describes. See `SceneHandle`. */
export function createScene(initial: SceneDocument, options: SceneOptions = {}): SceneHandle {
  const { renderer, clock, reducedMotion = false } = options;
  let doc = initial;
  let look = options.palette ?? lookOf(initial.look);
  // A palette that was given (to `createScene` or `setLook`) outranks the document's `look`.
  let explicitLook = options.palette !== undefined;
  let disposed = false;

  const root = new Group();
  root.name = "scene";
  const camera = new PerspectiveCamera(initial.camera.fov, 1, 0.1, 100);
  const slots = new Map<string, Slot>();
  const registry = loadDescriptors();

  let lights: Group | undefined;
  let lightIntensity: number | undefined;

  // --- the stage: what needs a renderer ---
  const stage: Stage | undefined = renderer === undefined ? undefined : { scene: new Scene(), environment: undefined, effects: undefined, structure: "", pointer: null };
  stage?.scene.add(root);
  /** Loaded with the first effect stack; every later use of it is after that. */
  let postfx: typeof Postfx | undefined;

  const stackOf = (d: SceneDocument): readonly ScreenEffectConfig[] => stackEntries.parse(d.effects);
  const monochrome = (d: SceneDocument, palette: ScenePalette) => (d.ink === "look" ? undefined : palette[d.ink]);

  async function setUpEnvironment(): Promise<void> {
    if (renderer === undefined || stage === undefined) return;
    const [{ PMREMGenerator }, { RoomEnvironment }] = await Promise.all([import("three/webgpu"), import("three/examples/jsm/environments/RoomEnvironment.js")]);
    if (disposed) return;
    const room = new RoomEnvironment();
    const pmrem = new PMREMGenerator(renderer);
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    stage.environment = target;
    stage.scene.environment = target.texture;
  }

  async function applyEffects(): Promise<void> {
    if (renderer === undefined || stage === undefined) return;
    const stack = stackOf(doc);
    if (stack.length === 0 && stage.effects === undefined) return;
    const three = (postfx ??= await import("@hedronite/lts-postfx/three"));
    if (disposed) return;
    const structure = three.stackStructure(stack, reducedMotion);
    if (stage.effects !== undefined && (stack.length === 0 || structure !== stage.structure)) {
      stage.effects.dispose();
      stage.effects = undefined;
    }
    if (stack.length === 0) return;
    const ink = monochrome(doc, look);
    if (stage.effects === undefined) {
      stage.effects = new three.ScreenEffects(renderer, stage.scene, camera, stack, { palette: look, reducedMotion, ...(ink === undefined ? {} : { monochrome: ink }) });
      stage.structure = structure;
      stage.effects.setPointer(stage.pointer);
    }
    stage.effects.setParams(three.stackValues(stack));
    three.applyPalette(stage.effects, look, ink === undefined ? {} : { monochrome: ink });
  }

  // --- nodes ---
  function transform(slot: Slot, node: SceneNode): void {
    slot.group.position.set(...node.position);
    slot.group.rotation.set(...node.rotation);
    slot.group.scale.set(...node.scale);
  }

  function release(slot: Slot): void {
    slot.controller?.abort();
    slot.controller = undefined;
    slot.group.removeFromParent();
    slot.built?.dispose();
    slot.built = undefined;
  }

  /** Builds the slot's node again; the old object stays on show until the new one is ready, then it is freed. */
  async function rebuild(slot: Slot): Promise<void> {
    slot.controller?.abort();
    const controller = new AbortController();
    slot.controller = controller;
    const { spec } = slot;
    try {
      const built = await buildNode(spec, look, await registry, clock, controller.signal);
      if (controller.signal.aborted || disposed) {
        built.dispose();
        return;
      }
      const previous = slot.built;
      slot.built = built;
      slot.group.add(built.object);
      if (previous !== undefined) {
        slot.group.remove(previous.object);
        previous.dispose();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      throw new Error(`could not build node "${spec.id}"`, { cause: error });
    }
  }

  /** A shader's parameters, written in place; a node it cannot reach that way builds again. */
  async function writeShader(slot: Slot, previous: SceneNode, next: SceneNode): Promise<boolean> {
    const handle = slot.built?.shader;
    if (handle === undefined || !hasShader(next.surface) || !hasShader(previous.surface)) {
      await rebuild(slot);
      return false;
    }
    const defaults = descriptorOf(await registry, next.surface.shader).defaults;
    const given = next.surface.params ?? {};
    // A parameter taken out with no default to fall back to cannot be unset in place.
    const dropped = Object.keys(previous.surface.params ?? {}).some((key) => !(key in given) && !(key in defaults));
    if (!dropped && handle.set({ ...defaults, ...given })) return true;
    await rebuild(slot);
    return false;
  }

  function link(d: SceneDocument): void {
    for (const node of d.nodes) {
      const slot = slots.get(node.id);
      if (slot === undefined) continue;
      const parent = node.parent === null ? root : (slots.get(node.parent)?.group ?? root);
      if (slot.group.parent !== parent) parent.add(slot.group);
    }
  }

  function apply(next: SceneDocument): Promise<void>[] {
    doc = next;
    const ids = new Set(next.nodes.map((node) => node.id));
    for (const [id, slot] of slots) {
      if (ids.has(id)) continue;
      release(slot);
      slots.delete(id);
    }
    const work: Promise<void>[] = [];
    for (const node of next.nodes) {
      const slot = slots.get(node.id);
      if (slot === undefined) {
        const added: Slot = { spec: node, group: new Group(), built: undefined, controller: undefined };
        added.group.name = node.id;
        transform(added, node);
        slots.set(node.id, added);
        work.push(rebuild(added));
        continue;
      }
      transform(slot, node);
      const previous = slot.spec;
      slot.spec = node;
      if (buildKey(previous) !== buildKey(node)) work.push(rebuild(slot));
      else if (hasShader(node.surface) && !sameValues(hasShader(previous.surface) ? previous.surface.params : undefined, node.surface.params)) work.push(writeShader(slot, previous, node).then(() => undefined));
    }
    link(next);

    if (lights === undefined || lightIntensity !== next.lights.intensity) {
      if (lights !== undefined) root.remove(lights);
      lights = createStudioLights({ intensity: next.lights.intensity });
      lightIntensity = next.lights.intensity;
      root.add(lights);
    }
    camera.fov = next.camera.fov;
    camera.position.set(...next.camera.position);
    camera.lookAt(...next.camera.target);
    camera.updateProjectionMatrix();
    work.push(applyEffects());
    return work;
  }

  const settle = async (work: readonly Promise<unknown>[]): Promise<void> => {
    const results = await Promise.allSettled(work);
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length > 0) throw new AggregateError(failed.map((result): unknown => result.reason), `${String(failed.length)} part(s) of the scene could not be built`);
  };

  const first = apply(initial);
  const ready = settle([...first, setUpEnvironment()]);
  // A caller that never awaits `ready` must not raise an unhandled rejection; one that does still sees it.
  ready.catch(() => undefined);

  const size = new Vector2();
  /** Writes a look into everything built, and into the effects' inks. */
  const recolor = (palette: ScenePalette): void => {
    look = palette;
    for (const slot of slots.values()) slot.built?.recolor(palette);
    if (stage?.effects !== undefined && postfx !== undefined) {
      const ink = monochrome(doc, palette);
      postfx.applyPalette(stage.effects, palette, ink === undefined ? {} : { monochrome: ink });
    }
  };
  const handle: SceneHandle = {
    root,
    camera,
    ready,
    async set(nodeId, params) {
      const slot = slots.get(nodeId);
      if (slot === undefined) throw new RangeError(`no node "${nodeId}"`);
      const surface = slot.spec.surface;
      const reg = await registry;
      const shaderKeys = new Set(hasShader(surface) ? Object.keys(descriptorOf(reg, surface.shader).parameters.shape) : []);
      const assetKeys = new Set(Object.keys(descriptorOf(reg, slot.spec.asset.id).parameters.shape));
      const forShader: NodeParams = {};
      const forAsset: NodeParams = {};
      for (const [key, value] of Object.entries(params)) {
        if (shaderKeys.has(key)) forShader[key] = value;
        else if (assetKeys.has(key)) forAsset[key] = value;
        else throw new RangeError(`node "${nodeId}" has no parameter "${key}"`);
      }
      const previous = slot.spec;
      const next: SceneNode = {
        ...previous,
        ...(Object.keys(forAsset).length === 0 ? {} : { asset: { ...previous.asset, params: { ...previous.asset.params, ...forAsset } } }),
        ...(Object.keys(forShader).length === 0 || !hasShader(surface) ? {} : { surface: { ...surface, params: { ...surface.params, ...forShader } } }),
      };
      if (Object.keys(forAsset).length > 0) {
        slot.spec = next;
        await rebuild(slot);
        return false;
      }
      if (Object.keys(forShader).length === 0) return true;
      const effect = slot.built?.shader;
      if (effect !== undefined && effect.set(forShader)) {
        slot.spec = next;
        return true;
      }
      slot.spec = next;
      await rebuild(slot);
      return false;
    },
    setLook(palette) {
      explicitLook = true;
      recolor(palette);
    },
    update(next) {
      if (disposed) return Promise.reject(new Error("the scene is disposed"));
      const own = explicitLook ? undefined : lookOf(next.look);
      const work = apply(next);
      if (own !== undefined && own !== look) recolor(own);
      return settle(work);
    },
    ...(renderer === undefined || stage === undefined
      ? {}
      : {
          render: (delta: number) => {
            renderer.getSize(size);
            if (size.y > 0 && Math.abs(camera.aspect - size.x / size.y) > 1e-6) {
              camera.aspect = size.x / size.y;
              camera.updateProjectionMatrix();
            }
            if (stage.effects === undefined) renderer.render(stage.scene, camera);
            else {
              stage.effects.setSize();
              stage.effects.render(delta);
            }
          },
          setPointer: (pointer: ScenePointer) => {
            stage.pointer = pointer;
            stage.effects?.setPointer(pointer);
          },
        }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const slot of slots.values()) release(slot);
      slots.clear();
      if (stage !== undefined) {
        stage.effects?.dispose();
        stage.effects = undefined;
        stage.environment?.dispose();
        stage.environment = undefined;
        stage.scene.environment = null;
        stage.scene.clear();
      }
      root.removeFromParent();
      root.clear();
    },
  };
  return handle;
}
