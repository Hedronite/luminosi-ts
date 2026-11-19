import { createRandom } from "@hedronite/lts-core";
import { parseScene, type Scene } from "@hedronite/lts-scene";
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
const modules = import.meta.glob<{ readonly build: (renderer: WebGPURenderer, options: Options) => Promise<Emitted> }>("../../../e2e/scenes/{generated,plants}/*.ts");

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

declare global {
  interface Window {
    stillScene?: {
      readonly baseline: Memory;
      readonly memory: () => Memory;
      readonly dispose: () => Promise<Memory>;
      readonly cycle: () => Promise<Memory>;
    };
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
    const built = await (await load()).build(renderer, options);
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
      stage.dataset["error"] = error instanceof Error ? error.message : String(error);
      stage.dataset["still"] = "error";
    },
  );
}
