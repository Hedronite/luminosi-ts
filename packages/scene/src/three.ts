import type { AssetDescriptor, DescriptorRegistry } from "@hedronite/lts-core";
import { isMaterialId, materialPreset, type MaterialId } from "@hedronite/lts-materials";
import { applyPalette as paintMaterials, createMaterial } from "@hedronite/lts-materials/three";
import { createFramedSolid } from "@hedronite/lts-objects/three";
import { screenEffectSchemas, type ScreenEffectConfig } from "@hedronite/lts-postfx";
import type * as Postfx from "@hedronite/lts-postfx/three";
import { isPrimitiveId, primitive } from "@hedronite/lts-primitives";
import { applyStudioLightsPalette, createStudioLights, disposeObject } from "@hedronite/lts-primitives/three";
import { loadDescriptors } from "@hedronite/lts-registry";
import { isEffectId } from "@hedronite/lts-shaders";
import type { EffectClock, EffectHandle } from "@hedronite/lts-shaders/three";
import { BLACK, duskLightTints, hedronite, mixHex, neutral, presets, sceneLighting, WHITE, type Hex, type ScenePalette, type ToneMapping } from "@hedronite/lts-tokens";
import { ACESFilmicToneMapping, AgXToneMapping, BackSide, BoxGeometry, BufferGeometry, DataTexture, DirectionalLight, EquirectangularReflectionMapping, Group, Mesh, MeshLambertMaterial, MeshStandardMaterial, NeutralToneMapping, NoToneMapping, Object3D, PCFShadowMap, PerspectiveCamera, PlaneGeometry, PointLight, Scene, ShadowMaterial, Vector2, type Material, type ShadowMapType, type Texture, type ToneMapping as ThreeToneMapping } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { WebGPURenderer } from "three/webgpu";
import { z } from "zod";
import type { EnvironmentKind, Scene as SceneDocument, SceneEnvironment, SceneNode, SceneStage, SceneSurface } from "./index.js";
import { createMotion, propertyOf, type MotionInput, type TrackValue } from "./motion/index.js";
import { ROOM_BLUR, ROOM_SPECS, STUDIO_BLUR, type RoomColorExpr, type RoomColorToken } from "./rooms.js";

export { ROOM_BLUR, STUDIO_BLUR };

export interface RoomTarget {
  readonly texture: Texture;
  dispose(): void;
}

export interface RoomGenerator {
  fromScene(scene: Scene, sigma: number): RoomTarget;
  fromEquirectangular?(texture: Texture): RoomTarget;
  dispose(): void;
}

export type HdriLoader = (url: string, options?: { readonly signal?: AbortSignal }) => Promise<Texture>;

export interface RoomScene {
  readonly scene: Scene & { dispose(): void };
  readonly blur: number;
}

const TOKEN_HEX: Readonly<Record<RoomColorToken, Hex>> = {
  WHITE,
  BLACK,
  "neutral.ground": neutral.scene.ground,
  "neutral.base": neutral.scene.base,
  "hedronite.sky": hedronite.scene.sky,
  "hedronite.fill": hedronite.scene.fill,
  "dusk.key": duskLightTints.key,
  "dusk.rim": duskLightTints.rim,
  "dusk.ambient": duskLightTints.ambient,
};

const resolveRoomColor = (expr: RoomColorExpr): Hex => (typeof expr === "string" ? TOKEN_HEX[expr] : mixHex(TOKEN_HEX[expr[1]], TOKEN_HEX[expr[2]], expr[3]));

/** Creates the named procedural environment room (`studio`, `gallery`, `dusk`, or `noir`) and its PMREM blur sigma. */
export function createRoom(kind: EnvironmentKind): RoomScene {
  if (kind === "studio") return { scene: new RoomEnvironment(), blur: STUDIO_BLUR };
  const spec = ROOM_SPECS[kind];
  const scene = new Scene();
  scene.name = `room-${kind}`;
  scene.position.y = -3.5;

  const geometry = new BoxGeometry();
  geometry.deleteAttribute("uv");
  const wallMat = new MeshStandardMaterial({ color: resolveRoomColor(spec.wall), roughness: spec.roughness, side: BackSide });
  const contactMat = new MeshStandardMaterial({ color: resolveRoomColor(spec.contact), roughness: 1 });
  const materials: (MeshStandardMaterial | MeshLambertMaterial)[] = [wallMat, contactMat];

  const enclosure = new Mesh(geometry, wallMat);
  enclosure.name = "enclosure";
  enclosure.position.set(0, 12, 0);
  enclosure.scale.set(31, 27, 29);
  scene.add(enclosure);

  const contact = new Mesh(geometry, contactMat);
  contact.name = "contact-floor";
  contact.position.set(0, -1.2, 0);
  contact.scale.set(22, 0.4, 22);
  scene.add(contact);

  const light = new PointLight(resolveRoomColor(spec.point), spec.pointIntensity, 32, 2);
  light.position.set(0.4, 16, 0.3);
  scene.add(light);

  for (const [index, [colorExpr, intensity, x, y, z, sx, sy, sz]] of spec.cards.entries()) {
    const material = new MeshLambertMaterial({ color: BLACK, emissive: resolveRoomColor(colorExpr), emissiveIntensity: intensity });
    materials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.name = `card-${String(index)}`;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    scene.add(mesh);
  }

  return {
    scene: Object.assign(scene, {
      dispose(): void {
        geometry.dispose();
        for (const material of materials) material.dispose();
      },
    }),
    blur: spec.blur,
  };
}

/** Bakes a procedural room into a PMREM target and frees both the room geometry/materials and generator. */
export function bakeRoom(generator: RoomGenerator, kind: EnvironmentKind = "studio"): RoomTarget {
  const { scene, blur } = createRoom(kind);
  try {
    return generator.fromScene(scene, blur);
  } finally {
    scene.dispose();
    generator.dispose();
  }
}

async function defaultHdriLoader(url: string, options?: { readonly signal?: AbortSignal }): Promise<Texture> {
  const response = await fetch(url, options?.signal === undefined ? {} : { signal: options.signal });
  if (!response.ok) throw new Error(`HDRI load failed (${String(response.status)})`);
  const buffer = await response.arrayBuffer();
  const { HDRLoader } = await import("three/examples/jsm/loaders/HDRLoader.js");
  const texture = new HDRLoader().createDataTexture(buffer);
  if (texture instanceof DataTexture) {
    texture.mapping = EquirectangularReflectionMapping;
    texture.needsUpdate = true;
  }
  return texture;
}

export interface BakeEnvironmentOptions {
  readonly hdriLoader?: HdriLoader;
  readonly signal?: AbortSignal;
}

export interface BakedEnvironment {
  readonly target: RoomTarget;
  readonly source: "procedural" | "hdri";
  readonly fallbackError?: unknown;
}

/**
 * Resolves a scene environment descriptor into a PMREM target. When `environment.hdri` is given, loads and prefilters it,
 * falling back gracefully to the procedural room on fetch, decode, or generator failure with zero leaked textures.
 */
export async function bakeEnvironmentTarget(generator: RoomGenerator, environment: Pick<SceneEnvironment, "kind" | "hdri">, options: BakeEnvironmentOptions = {}): Promise<BakedEnvironment> {
  if (environment.hdri !== undefined && generator.fromEquirectangular !== undefined) {
    const loader = options.hdriLoader ?? defaultHdriLoader;
    let equirectangular: Texture | undefined;
    try {
      equirectangular = await loader(environment.hdri.url, options.signal === undefined ? {} : { signal: options.signal });
      // The catch below frees the texture and the generator.
      if (options.signal?.aborted) throw new Error("environment load aborted");
      const target = generator.fromEquirectangular(equirectangular);
      equirectangular.dispose();
      generator.dispose();
      return { target, source: "hdri" };
    } catch (error) {
      equirectangular?.dispose();
      if (options.signal?.aborted) {
        generator.dispose();
        throw error;
      }
      return { target: bakeRoom(generator, environment.kind), source: "procedural", fallbackError: error };
    }
  }
  return { target: bakeRoom(generator, environment.kind), source: "procedural" };
}

export type { SceneDocument };

/** Parameters by name, as a document holds them. */
export type NodeParams = NonNullable<SceneNode["asset"]["params"]>;

/** What `advance` takes besides the seconds: the scroll the conductor measured, the pointer and whether the stage is seen or hovered. */
export interface MotionReading {
  readonly scroll?: NonNullable<MotionInput["scroll"]>;
  readonly pointer?: NonNullable<MotionInput["pointer"]>;
  readonly hovered?: boolean;
  readonly inView?: boolean;
}

/** How a scene plays its tracks: `replay` names the tracks or clips whose `in-view` trigger may fire more than once. */
export interface MotionPlayOptions {
  readonly reducedMotion?: boolean;
  readonly replay?: readonly string[];
}

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
  /**
   * Play the document's tracks. The clock is the caller's: `advance` is given the seconds that passed, and nothing reads the wall clock.
   * Under `reducedMotion` nothing moves: every animated property holds its rest value and no track starts.
   */
  readonly motion?: MotionPlayOptions;
  /** Optional loader for `environment.hdri.url` (useful for offline or synthetic HDRI testing). */
  readonly hdriLoader?: HdriLoader;
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
   * resolves false once the new one is in place. A key both have goes to the shader, never the asset (dissolve has a `scale`, and so
   * does a primitive): to change the asset's, give `update` a document with it.
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
  /**
   * Present with a renderer: the `uuid` of every render-target texture the screen-effect pipelines this scene has built have held, in the
   * order they were built, and never fewer than before (a pipeline that was freed is still listed). A stack whose structure changed builds
   * another pipeline and adds its own; a parameter, a look, an ink, the pointer and a node's transform add none. Empty while there have been
   * no effects. Read-only, for a counter that keeps what it reads: it reads the objects' own uuids and no names.
   */
  readonly effectTargets?: () => readonly string[];
  /**
   * One step of the document's motion, given the seconds since the last step and what the drivers read. It writes the transforms and the
   * camera; a parameter track is G6's. Returns whether anything moved — false when the document has no tracks, and false under reduced
   * motion — so a stage drawing on demand knows whether it needs a frame.
   */
  readonly advance: (seconds: number, reading?: MotionReading) => boolean;
  /** The values as they stand, by property path (the rest pose before the first step); empty when the document has no tracks. */
  readonly motionValues: () => ReadonlyMap<string, TrackValue>;
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
  readonly baselineToneMapping: ThreeToneMapping;
  readonly baselineExposure: number;
  readonly baselineShadowEnabled: boolean;
  readonly baselineShadowType: ShadowMapType;
  environment: RoomTarget | undefined;
  environmentKey: string;
  effects: Postfx.ScreenEffects | undefined;
  /** What the running stack was built from (`stackStructure`). */
  structure: string;
  pointer: ScenePointer;
}

const STAGE_TONE_MAPPINGS: Readonly<Record<ToneMapping, ThreeToneMapping>> = {
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
};

const stagePostfxActive = (stage: SceneStage | undefined): boolean =>
  stage !== undefined && stage.quality !== "lite" && (stage.bloom?.enabled === true || stage.dof?.enabled === true);

const readNumberProp = (obj: object, key: string, fallback: number): number => {
  const val: unknown = Reflect.get(obj, key);
  return typeof val === "number" ? val : fallback;
};

const hasShadowMap = (r: object): boolean => {
  const sm: unknown = Reflect.get(r, "shadowMap");
  return typeof sm === "object" && sm !== null;
};

const readBoolProp = (obj: object, key: string, fallback: boolean): boolean => {
  const val: unknown = Reflect.get(obj, key);
  return typeof val === "boolean" ? val : fallback;
};

const setMeshShadows = (root: Object3D, enabled: boolean): void => {
  root.traverse((child) => {
    if (child instanceof Mesh && child.name !== "shadow-catcher") {
      child.castShadow = enabled;
      child.receiveShadow = enabled;
    }
  });
};

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

/**
 * Creates the scene a document describes. See `SceneHandle`.
 *
 * The document's `seed` is reserved: nothing here draws at random, and an object that takes a `seed` parameter takes it from
 * its own `params` (or its default), so a migrated document (seed 0) draws what the playground drew.
 */
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
  let catcher: Mesh<PlaneGeometry, ShadowMaterial> | undefined;
  let shadowsActive = false;

  // --- the stage: what needs a renderer ---
  const stage: Stage | undefined =
    renderer === undefined
      ? undefined
      : {
          scene: new Scene(),
          baselineToneMapping: typeof Reflect.get(renderer, "toneMapping") === "number" ? renderer.toneMapping : NoToneMapping,
          baselineExposure: readNumberProp(renderer, "toneMappingExposure", 1),
          baselineShadowEnabled: hasShadowMap(renderer) ? readBoolProp(renderer.shadowMap, "enabled", false) : false,
          baselineShadowType: hasShadowMap(renderer) && typeof Reflect.get(renderer.shadowMap, "type") === "number" ? renderer.shadowMap.type : PCFShadowMap,
          environment: undefined,
          environmentKey: "",
          effects: undefined,
          structure: "",
          pointer: null,
        };
  stage?.scene.add(root);
  /** Loaded with the first effect stack; every later use of it is after that. */
  let postfx: typeof Postfx | undefined;
  /** The render-target textures every pipeline this scene built held, by `uuid`: kept when a pipeline is freed (see `effectTargets`). */
  const effectTargets = new Set<string>();

  const stackOf = (d: SceneDocument): readonly ScreenEffectConfig[] => stackEntries.parse(d.effects);
  const monochrome = (d: SceneDocument, palette: ScenePalette) => (d.ink === "look" ? undefined : palette[d.ink]);

  let envGeneration = 0;
  let envInFlightKey: string | undefined;
  let envController: AbortController | undefined;
  const environmentSourceKey = (environment: SceneEnvironment): string => `${environment.kind}|${environment.hdri?.url ?? ""}`;

  async function applyEnvironment(environment: SceneEnvironment): Promise<void> {
    if (renderer === undefined || stage === undefined) return;
    stage.scene.environmentIntensity = environment.intensity ?? 1;
    stage.scene.environmentRotation.set(0, environment.rotation ?? 0, 0);
    const sourceKey = environmentSourceKey(environment);
    if (sourceKey === stage.environmentKey && stage.environment !== undefined) {
      // What is on show is what is asked for. A bake under way for another source would replace it when it landed: give it up.
      if (envInFlightKey !== undefined) {
        envController?.abort();
        envGeneration += 1;
        envInFlightKey = undefined;
      }
      return;
    }
    if (sourceKey === envInFlightKey) return;

    envController?.abort();
    const controller = new AbortController();
    envController = controller;
    const generation = ++envGeneration;
    envInFlightKey = sourceKey;
    const stale = (): boolean => disposed || controller.signal.aborted || generation !== envGeneration;

    try {
      const { PMREMGenerator } = await import("three/webgpu");
      if (stale()) return;
      const { target } = await bakeEnvironmentTarget(new PMREMGenerator(renderer), environment, {
        signal: controller.signal,
        ...(options.hdriLoader === undefined ? {} : { hdriLoader: options.hdriLoader }),
      });
      if (stale()) {
        target.dispose();
        return;
      }
      const previous = stage.environment;
      stage.environment = target;
      stage.environmentKey = sourceKey;
      stage.scene.environment = target.texture;
      previous?.dispose();
    } catch (error) {
      // A load that was only overtaken (another source was asked for, or the scene was disposed) has failed nobody.
      if (!stale()) throw error;
    } finally {
      // A newer bake owns the key by now; this one clears it only while it is still the latest.
      if (generation === envGeneration) envInFlightKey = undefined;
    }
  }

  function disposeCatcher(): void {
    if (catcher === undefined) return;
    catcher.removeFromParent();
    catcher.geometry.dispose();
    catcher.material.dispose();
    catcher = undefined;
  }

  function syncStage(): void {
    const cfg = doc.stage;
    const full = cfg !== undefined && cfg.quality !== "lite";
    const shadowsOn = full && cfg.shadows?.enabled === true;
    const catcherOn = shadowsOn && cfg.shadows?.catcher === true;
    shadowsActive = shadowsOn;

    const key = lights?.getObjectByName("key");
    if (key instanceof DirectionalLight) {
      key.castShadow = shadowsOn;
      if (shadowsOn) {
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.near = 0.5;
        key.shadow.camera.far = 25;
        key.shadow.camera.left = -6;
        key.shadow.camera.right = 6;
        key.shadow.camera.top = 6;
        key.shadow.camera.bottom = -6;
        key.shadow.bias = -0.0005;
        key.shadow.normalBias = 0.02;
        key.shadow.radius = 3;
      } else {
        key.shadow.dispose();
      }
    }

    for (const slot of slots.values()) {
      if (slot.built !== undefined) setMeshShadows(slot.built.object, shadowsOn);
    }

    if (catcherOn && catcher === undefined) {
      const geometry = new PlaneGeometry(24, 24);
      geometry.rotateX(-Math.PI / 2);
      const material = new ShadowMaterial({ opacity: 0.35, transparent: true });
      const plane = new Mesh(geometry, material);
      plane.name = "shadow-catcher";
      plane.position.set(0, -1.2, 0);
      plane.receiveShadow = true;
      plane.castShadow = false;
      root.add(plane);
      catcher = plane;
    } else if (!catcherOn) {
      disposeCatcher();
    }

    if (renderer !== undefined && stage !== undefined) {
      if (hasShadowMap(renderer)) {
        if (cfg === undefined) {
          renderer.shadowMap.enabled = stage.baselineShadowEnabled;
          renderer.shadowMap.type = stage.baselineShadowType;
        } else {
          renderer.shadowMap.enabled = shadowsOn;
          if (shadowsOn) renderer.shadowMap.type = PCFShadowMap;
        }
      }
      if (cfg === undefined) {
        renderer.toneMapping = stage.baselineToneMapping;
        renderer.toneMappingExposure = stage.baselineExposure;
      } else {
        const lighting = sceneLighting(look);
        renderer.toneMapping = STAGE_TONE_MAPPINGS[cfg.toneMapping ?? lighting.toneMapping];
        renderer.toneMappingExposure = cfg.exposure ?? lighting.exposure;
      }
    }
  }

  async function applyEffects(): Promise<void> {
    if (renderer === undefined || stage === undefined) return;
    const stack = stackOf(doc);
    const stageActive = stagePostfxActive(doc.stage);
    if (stack.length === 0 && !stageActive && stage.effects === undefined) return;
    const three = (postfx ??= await import("@hedronite/lts-postfx/three"));
    if (disposed) return;
    const structure = three.stackStructure(stack, reducedMotion, doc.stage);
    if (stage.effects !== undefined && ((stack.length === 0 && !stageActive) || structure !== stage.structure)) {
      stage.effects.dispose();
      stage.effects = undefined;
    }
    if (stack.length === 0 && !stageActive) return;
    const ink = monochrome(doc, look);
    if (stage.effects === undefined) {
      stage.effects = new three.ScreenEffects(renderer, stage.scene, camera, stack, {
        palette: look,
        reducedMotion,
        ...(ink === undefined ? {} : { monochrome: ink }),
        ...(doc.stage === undefined ? {} : { stage: doc.stage }),
      });
      stage.structure = structure;
      for (const id of stage.effects.targetIds) effectTargets.add(id);
      stage.effects.setPointer(stage.pointer);
    }
    stage.effects.setParams(three.stackValues(stack));
    if (typeof stage.effects.setStage === "function") stage.effects.setStage(doc.stage);
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
      setMeshShadows(built.object, shadowsActive);
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
      lights = createStudioLights({ intensity: next.lights.intensity, palette: look });
      lightIntensity = next.lights.intensity;
      root.add(lights);
    }
    camera.fov = next.camera.fov;
    camera.position.set(...next.camera.position);
    camera.lookAt(...next.camera.target);
    camera.updateProjectionMatrix();
    syncStage();
    work.push(applyEnvironment(next.environment));
    work.push(applyEffects());
    return work;
  }

  const settle = async (work: readonly Promise<unknown>[]): Promise<void> => {
    const results = await Promise.allSettled(work);
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length > 0) throw new AggregateError(failed.map((result): unknown => result.reason), `${String(failed.length)} part(s) of the scene could not be built`);
  };

  const first = apply(initial);
  const ready = settle(first);
  // A caller that never awaits `ready` must not raise an unhandled rejection; one that does still sees it.
  ready.catch(() => undefined);

  const size = new Vector2();
  /** Writes a look into everything built (materials, lights, and effects' inks) in place. */
  const recolor = (palette: ScenePalette): void => {
    look = palette;
    if (lights !== undefined) applyStudioLightsPalette(lights, palette);
    syncStage();
    for (const slot of slots.values()) slot.built?.recolor(palette);
    if (stage?.effects !== undefined && postfx !== undefined) {
      const ink = monochrome(doc, palette);
      postfx.applyPalette(stage.effects, palette, ink === undefined ? {} : { monochrome: ink });
    }
  };
  // --- motion: the document's tracks, stepped by the caller's clock ---
  /** The runtime of the document's tracks, or none when it has no tracks. Rebuilt when `update` brings tracks, or changes them. */
  let motion = modeOf(doc);
  /** The values of a document with no tracks: nothing to write. */
  const NO_VALUES: ReadonlyMap<string, TrackValue> = new Map();
  function modeOf(document: SceneDocument): ReturnType<typeof createMotion> | undefined {
    if (document.tracks.length === 0) return undefined;
    return createMotion(document, { reducedMotion: options.motion?.reducedMotion ?? reducedMotion, ...(options.motion?.replay === undefined ? {} : { replay: options.motion.replay }) });
  }
  /** A vec3 as the tracks hold one: three numbers, which is what the schema writes there. */
  const isVec3 = (value: TrackValue): value is readonly [number, number, number] =>
    Array.isArray(value) && value.length >= 3 && value.every((one) => typeof one === "number");
  /** Writes the runtime's values onto the scene: a node's transform, the camera's position, target and field of view. */
  const writeMotion = (): void => {
    if (motion === undefined) return;
    for (const [target, value] of motion.values) {
      const property = propertyOf(target);
      if (property === undefined) continue;
      if (property.node !== undefined) {
        const slot = slots.get(property.node);
        if (slot === undefined || !isVec3(value)) continue;
        const [x, y, z] = value;
        if (target.endsWith(".position")) slot.group.position.set(x, y, z);
        else if (target.endsWith(".rotation")) slot.group.rotation.set(x, y, z);
        else if (target.endsWith(".scale")) slot.group.scale.set(x, y, z);
        continue;
      }
      if (target === "camera.position" && isVec3(value)) camera.position.set(value[0], value[1], value[2]);
      else if (target === "camera.target" && isVec3(value)) camera.lookAt(value[0], value[1], value[2]);
      else if (target === "camera.fov" && typeof value === "number") {
        camera.fov = value;
        camera.updateProjectionMatrix();
      }
    }
  };
  // The rest pose, written before the first step: what a fresh scene shows, and all a reduced-motion stage ever shows.
  writeMotion();

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
    advance: (seconds: number, reading: MotionReading = {}) => {
      if (motion === undefined) return false;
      const frame = motion.step(seconds, reading);
      writeMotion();
      return frame.changed;
    },
    motionValues: () => motion?.values ?? NO_VALUES,
    update(next) {
      if (disposed) return Promise.reject(new Error("the scene is disposed"));
      const own = explicitLook ? undefined : lookOf(next.look);
      const changedLook = own !== undefined && own !== look ? own : undefined;
      if (changedLook !== undefined) look = changedLook;
      const work = apply(next);
      // The document's motion follows it: a document that brings tracks, or changes them, plays them from the next step.
      motion = modeOf(next);
      writeMotion();
      if (changedLook !== undefined) recolor(changedLook);
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
          effectTargets: () => [...effectTargets],
        }),
    dispose() {
      if (disposed) return;
      disposed = true;
      envController?.abort();
      envController = undefined;
      for (const slot of slots.values()) release(slot);
      slots.clear();
      disposeCatcher();
      const key = lights?.getObjectByName("key");
      if (key instanceof DirectionalLight) key.shadow.dispose();
      if (stage !== undefined) {
        if (renderer !== undefined) {
          if (hasShadowMap(renderer)) {
            renderer.shadowMap.enabled = stage.baselineShadowEnabled;
            renderer.shadowMap.type = stage.baselineShadowType;
          }
          renderer.toneMapping = stage.baselineToneMapping;
          renderer.toneMappingExposure = stage.baselineExposure;
        }
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
