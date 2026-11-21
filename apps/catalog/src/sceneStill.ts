import { createRandom } from "@hedronite/lts-core";
import { decodeScene, migrate, parseScene, type Scene, type SceneResult } from "@hedronite/lts-scene";
import { createScene } from "@hedronite/lts-scene/three";
import { createEffectClock, type EffectClock } from "@hedronite/lts-shaders/three";
import { neutral } from "@hedronite/lts-tokens";
import { PerspectiveCamera, Scene as ThreeScene, WebGPURenderer } from "three/webgpu";
import { FRAMES, SEED, SIZE, STEP } from "./Still";

/**
 * The still-frame rig's scene mode: `still.html?scene=<fixture>&via=doc|code` draws one scene document, through
 * `createScene` (`via=doc`) or through the vanilla module emitted for it (`via=code`, `e2e/scenes/generated/`), on the same
 * kind of stage as an asset's still: a fixed square canvas at device pixel ratio 1, the neutral look's stage color behind it,
 * frames stepped by hand, a fixed step each, so no wall-clock time reaches the picture. `via=code&plant=<name>` loads a planted
 * module from `e2e/scenes/plants/` (made by `bun run scenes:plants`, never committed) instead of the committed one.
 *
 * `window.stillScene` is what the specs read afterwards: `memory()` (the renderer's counts now), `dispose()` (frees the scene,
 * draws an empty frame and returns the counts) and `cycle()` (builds the scene again, draws it, frees it, and returns the counts).
 */

/**
 * What both ways of making a scene are given, so nothing but the scene differs between them: the same paused clock (surface shaders read
 * it at time zero; it is never written), the same reduced-motion setting, and the same pixel ratio, which is set before either build
 * because `ScreenEffects` reads it when it is built.
 */
const REDUCED_MOTION = false;
const PIXEL_RATIO = 1;

/** What a generated module offers: a scene built on a renderer, the way `createScene` builds one, in plain three.js. */
interface Emitted {
  readonly camera: PerspectiveCamera;
  /** Settles when every object has built. */
  readonly ready: Promise<void>;
  readonly render: (delta: number) => void;
  readonly dispose: () => void;
}

interface Options {
  readonly clock: EffectClock;
  readonly reducedMotion: boolean;
}

/** What both ways of making a scene give the rig: one frame at a time, and an end. */
interface Drawn {
  readonly render: (delta: number) => void;
  readonly dispose: () => void;
}

/** The counts of what the renderer holds, from `renderer.info.memory`. */
export type Memory = Readonly<Record<string, number>>;

const documents = import.meta.glob<string>("../../../packages/scene/fixtures/*.json", { query: "?raw", import: "default", eager: true });
const modules = import.meta.glob<{ readonly build: (renderer: WebGPURenderer, options: Options) => Emitted }>("../../../e2e/scenes/{generated,plants}/*.ts");

const fixtureText = (name: string): string | undefined => documents[`../../../packages/scene/fixtures/${name}.json`];

function fixtureScene(name: string): Scene {
  const text = fixtureText(name);
  if (text === undefined) throw new RangeError(`${name} is not a scene fixture`);
  const parsed = parseScene(text);
  if (!parsed.ok) throw new RangeError(`${name} does not read: ${JSON.stringify(parsed.issues)}`);
  return parsed.scene;
}

const nextAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/** `renderer.info.memory` as plain numbers. */
function readMemory(renderer: WebGPURenderer): Memory {
  return Object.fromEntries(Object.entries(renderer.info.memory).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}

/** What the page offers in fixture mode. */
interface FixtureStill {
  readonly baseline: Memory;
  readonly memory: () => Memory;
  readonly dispose: () => Promise<Memory>;
  readonly cycle: () => Promise<Memory>;
}

declare global {
  interface Window {
    stillScene?: FixtureStill | DocumentStill;
  }
}

async function run(stage: HTMLElement, name: string, via: string, plant: string | null): Promise<void> {
  const random = createRandom(SEED);
  Math.random = () => random.next();

  const canvas = document.createElement("canvas");
  stage.append(canvas);
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(PIXEL_RATIO);
  renderer.setSize(SIZE, SIZE);
  await renderer.init();

  // The reading of a renderer that has drawn an empty scene and nothing else: what every later reading is held against.
  const empty = new ThreeScene();
  const emptyCamera = new PerspectiveCamera();
  const drawEmpty = async (): Promise<void> => {
    renderer.render(empty, emptyCamera);
    await nextAnimationFrame();
  };
  await drawEmpty();
  const baseline = readMemory(renderer);

  const clock = createEffectClock(0);
  const options: Options = { clock, reducedMotion: REDUCED_MOTION };

  async function make(): Promise<Drawn> {
    if (via === "doc") {
      const handle = createScene(fixtureScene(name), { renderer, clock, reducedMotion: REDUCED_MOTION });
      await handle.ready;
      const { render } = handle;
      if (render === undefined) throw new Error("createScene with a renderer gave no render");
      return { render, dispose: () => { handle.dispose(); } };
    }
    const path = plant === null ? `../../../e2e/scenes/generated/${name}.ts` : `../../../e2e/scenes/plants/${name}.${plant}.ts`;
    const load = modules[path];
    if (load === undefined) throw new RangeError(`there is no module at ${path}`);
    const built = (await load()).build(renderer, options);
    await built.ready;
    return { render: built.render, dispose: built.dispose };
  }

  const drawn = await make();
  for (let frame = 1; frame <= FRAMES; frame += 1) {
    drawn.render(STEP);
    // eslint-disable-next-line no-await-in-loop -- the frames are stepped in order, each given a browser frame to reach the screen
    await nextAnimationFrame();
  }

  let live: Drawn | undefined = drawn;
  const free = async (): Promise<Memory> => {
    live?.dispose();
    live = undefined;
    await drawEmpty();
    return readMemory(renderer);
  };
  window.stillScene = {
    baseline,
    memory: () => readMemory(renderer),
    dispose: free,
    cycle: async () => {
      const again = await make();
      for (let frame = 1; frame <= 3; frame += 1) {
        again.render(STEP);
        // eslint-disable-next-line no-await-in-loop -- one browser frame between each, as the stepped frames above have
        await nextAnimationFrame();
      }
      again.dispose();
      await drawEmpty();
      return readMemory(renderer);
    },
  };
}

/** Mounts the rig for one scene fixture in place of the catalog. */
export function mountSceneStill(root: HTMLElement, name: string, via: string, plant: string | null): void {
  const stage = document.createElement("div");
  stage.dataset["testid"] = "still";
  stage.dataset["scene"] = name;
  stage.dataset["via"] = via;
  stage.dataset["still"] = "loading";
  stage.dataset["frames"] = "0";
  Object.assign(stage.style, { position: "fixed", left: "0", top: "0", width: `${String(SIZE)}px`, height: `${String(SIZE)}px`, overflow: "hidden", background: neutral.light.surfaceRaised });
  root.append(stage);
  if (via !== "doc" && via !== "code") {
    stage.dataset["still"] = "error";
    stage.dataset["error"] = `via is doc or code, not "${via}"`;
    return;
  }
  run(stage, name, via, plant).then(
    () => {
      stage.dataset["frames"] = String(FRAMES);
      stage.dataset["time"] = (FRAMES * STEP).toFixed(2);
      stage.dataset["still"] = "ready";
    },
    (error: unknown) => {
      stage.dataset["error"] = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
      stage.dataset["still"] = "error";
    },
  );
}

/**
 * Document mode: `still.html?doc=<s1. link>[&width=W&height=H]` draws any scene document the same way, through `createScene`, on the same
 * kind of stage (a fixed canvas at device pixel ratio 1, the neutral look's stage color behind it, frames stepped by hand). A document too
 * large for a link goes to `window.stillScene.load(json)`; `still.html?doc` with no link waits for it. The page counts the frames in
 * `data-frames` as it steps them and sets `data-still` to `ready` (or `error`, with `data-error`) when the last is drawn, so a caller
 * waits on the page's own state and never on a timer. The sides are at most `MAX_SIDE`; the default is the fixture rig's `SIZE`.
 */

/** The longest side a document may be drawn at, in pixels. */
export const MAX_SIDE = 2048;

export interface StillSize {
  readonly width: number;
  readonly height: number;
}

/** A size as the address or a caller gives it: either side may be left out, and a side left out is the default. */
export type AskedSize = Partial<Record<keyof StillSize, number | undefined>>;

/** What `load` resolves to: the size drawn, the frames stepped, and which renderer drew them. */
export interface Rendered extends StillSize {
  readonly frames: number;
  readonly renderer: string;
}

/** A side of the stage: a whole number of pixels from 1 to `MAX_SIDE`. */
function side(name: string, value: number | undefined): number {
  const wanted = value ?? SIZE;
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > MAX_SIDE) throw new RangeError(`${name} is a whole number of pixels from 1 to ${String(MAX_SIDE)}, not ${String(wanted)}`);
  return wanted;
}

/** A property of an object of unknown shape, getters on its prototype included (a WebGPU adapter's `info` is one), or undefined. */
const read = (value: unknown, key: string): unknown => (typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined);

/**
 * Which renderer drew the frames, as text: the adapter's own description for the WebGPU backend, and for the WebGL 2 fallback the driver's
 * (`ANGLE (… SwiftShader …)` is the software path). It is read from the backend the renderer chose, never assumed from a flag.
 */
function rendererName(renderer: WebGPURenderer): string {
  const backend = read(renderer, "backend");
  const gl = read(backend, "gl");
  if (gl instanceof WebGL2RenderingContext) {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name: unknown = info === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    return `webgl2: ${typeof name === "string" ? name : "unknown"}`;
  }
  const info = read(read(backend, "adapter"), "info");
  const described = ["vendor", "architecture", "device", "description"].flatMap((key) => {
    const part = read(info, key);
    return typeof part === "string" && part !== "" ? [part] : [];
  });
  return `webgpu: ${described.length === 0 ? "unknown" : described.join(" ")}`;
}

/** What the page offers a caller in document mode. */
export interface DocumentStill {
  /** Draws a document (JSON text, of any version `migrate` reads) and resolves once its last frame is on the page; rejects, and sets `data-still` to `error`, when it cannot. */
  readonly load: (json: string, size?: AskedSize) => Promise<Rendered>;
  readonly memory: () => Memory;
}

interface Doc {
  readonly scene: Scene;
  readonly size: StillSize;
}

/** Mounts document mode in place of the catalog. `link` is the `doc` parameter's text, or null when the page waits for `load`. */
export function mountDocumentStill(root: HTMLElement, link: string | null, size: AskedSize): void {
  /** The size the next document is drawn at: the page's address gave the first, and a `load` may give another, which holds after it. */
  let asked = size;
  const stage = document.createElement("div");
  stage.dataset["testid"] = "still";
  stage.dataset["doc"] = link === null ? "load" : "link";
  stage.dataset["still"] = link === null ? "waiting" : "loading";
  stage.dataset["frames"] = "0";
  Object.assign(stage.style, { position: "fixed", left: "0", top: "0", width: `${String(SIZE)}px`, height: `${String(SIZE)}px`, overflow: "hidden", background: neutral.light.surfaceRaised });
  root.append(stage);
  const random = createRandom(SEED);
  Math.random = () => random.next();

  let renderer: WebGPURenderer | undefined;
  let free: (() => void) | undefined;
  // One document at a time: a second `load` waits for the first, so the page never holds two scenes.
  let turn: Promise<unknown> = Promise.resolve();

  async function draw({ scene, size: wanted }: Doc): Promise<Rendered> {
    stage.dataset["still"] = "loading";
    stage.dataset["frames"] = "0";
    delete stage.dataset["error"];
    free?.();
    free = undefined;
    if (renderer === undefined) {
      const canvas = document.createElement("canvas");
      stage.append(canvas);
      renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(PIXEL_RATIO);
    }
    renderer.setSize(wanted.width, wanted.height);
    Object.assign(stage.style, { width: `${String(wanted.width)}px`, height: `${String(wanted.height)}px` });
    await renderer.init();
    const handle = createScene(scene, { renderer, clock: createEffectClock(0), reducedMotion: REDUCED_MOTION });
    free = () => { handle.dispose(); };
    await handle.ready;
    if (handle.render === undefined) throw new Error("createScene with a renderer gave no render");
    for (let frame = 1; frame <= FRAMES; frame += 1) {
      handle.render(STEP);
      // eslint-disable-next-line no-await-in-loop -- the frames are stepped in order, each given a browser frame to reach the screen
      await nextAnimationFrame();
      stage.dataset["frames"] = String(frame);
    }
    const name = rendererName(renderer);
    stage.dataset["renderer"] = name;
    stage.dataset["time"] = (FRAMES * STEP).toFixed(2);
    stage.dataset["still"] = "ready";
    return { ...wanted, frames: FRAMES, renderer: name };
  }

  function drawing(read: () => Promise<SceneResult>): Promise<Rendered> {
    const next = turn.then(
      async () => {
        try {
          const wanted = { width: side("width", asked.width), height: side("height", asked.height) };
          const result = await read();
          if (!result.ok) throw new RangeError(`not a scene document: ${JSON.stringify(result.issues)}`);
          return await draw({ scene: result.scene, size: wanted });
        } catch (error: unknown) {
          stage.dataset["error"] = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
          stage.dataset["still"] = "error";
          throw error;
        }
      },
    );
    turn = next.catch(() => undefined);
    return next;
  }

  const load = (json: string, requested: AskedSize = {}): Promise<Rendered> => {
    asked = { ...asked, ...requested };
    return drawing(() => Promise.resolve(migrate(json)));
  };
  window.stillScene = { load, memory: () => (renderer === undefined ? {} : readMemory(renderer)) };
  if (link !== null) drawing(() => decodeScene(link)).catch(() => undefined);
}
