// The element's lazy half: it loads when the element is about to be seen, and holds everything that needs three, the scene builder or zod.
import { createEffectClock } from "@hedronite/lts-shaders/three";
import { presets, type Hex, type ScenePalette } from "@hedronite/lts-tokens";
import { WebGPURenderer } from "three/webgpu";
import { migrate } from "../migrate.js";
import { rendererReadout, whenDrawn } from "../renderer.js";
import type { Scene } from "../schema.js";
import { createScene } from "../three.js";
import { memoryOf, noteBuilds } from "./counts.js";
import type { DocumentSource, ElementFailure, ElementIssue, Leftovers, MountOptions, MountResult } from "./types.js";

/** The longest step one frame may take after a pause, in seconds: a hidden tab or a scroll back into view is one short step, not a jump. */
const LONGEST_STEP = 0.1;
/** The most device pixels a canvas pixel stands for: past 2 the picture is no sharper and costs four times as much. */
const MOST_PIXEL_RATIO = 2;
/** How often the counters are written, in milliseconds. */
const COUNTER_INTERVAL = 150;

/** What each host has ever attached, by `uuid`. It lives outside the mount, so an element that is connected again keeps counting where it was and the count never goes down. */
const builds = new WeakMap<HTMLElement, Set<string>>();

const fail = (code: string, message: string, path: readonly (string | number)[] = []): ElementFailure => ({ ok: false, issues: [{ path, code, message }] });

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The palette of a look id, or undefined when there is no such look. */
const presetOf = (id: string): ScenePalette | undefined => presets.find((preset) => preset.id === id)?.scene;

/** The palette of a document's own look: a look id, or an inline palette. */
const isHex = (value: string): value is Hex => /^#[0-9a-f]{6}$/.test(value);
const paletteOfDocument = (look: Scene["look"]): ScenePalette => {
  if (typeof look !== "string") {
    const { base, accent, metal, glass, emissive } = look;
    if (!isHex(base) || !isHex(accent) || !isHex(metal) || !isHex(glass) || !isHex(emissive)) throw new RangeError("the scene's look has a color that is not #rrggbb");
    return { base, accent, metal, glass, emissive };
  }
  const found = presetOf(look);
  if (found === undefined) throw new RangeError(`the scene's look "${look}" is not a look`);
  return found;
};

async function textOf(source: DocumentSource, signal: AbortSignal): Promise<string | ElementFailure> {
  if (source.kind === "text") return source.text;
  try {
    const response = await fetch(source.url, { signal });
    if (!response.ok) return fail("fetch-failed", `could not load ${source.url}: HTTP ${String(response.status)}`, ["src"]);
    return await response.text();
  } catch (error) {
    return fail("fetch-failed", `could not load ${source.url}: ${messageOf(error)}`, ["src"]);
  }
}

const issuesOf = (issues: readonly ElementIssue[]): ElementFailure => ({ ok: false, issues });

/**
 * Reads and validates the document, builds it on a `WebGPURenderer` and draws its first frame, then returns what keeps it drawn. The canvas goes
 * into `stage` hidden; `reveal` shows it. Resolves with a failure, never throws: a bad URL, an invalid document, a look that is not one, a scene
 * that did not build or a renderer that did not start each come back as the `issues` of an `error` event.
 */
export async function mount(options: MountOptions): Promise<MountResult> {
  const { host, stage, source, signal } = options;
  /** The signal is read again after each wait: it may have been aborted meanwhile. */
  const aborted = (): boolean => signal.aborted;
  const text = await textOf(source, signal);
  if (typeof text !== "string") return text;
  const parsed = migrate(text);
  if (!parsed.ok) return issuesOf(parsed.issues);
  const doc = parsed.scene;
  let palette: ScenePalette | undefined;
  if (options.look !== null) {
    palette = presetOf(options.look);
    if (palette === undefined) return fail("unknown-look", `"${options.look}" is not a look`, ["look"]);
  }
  if (aborted()) return fail("aborted", "the element was disconnected or reloaded");

  const canvas = globalThis.document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;visibility:hidden";
  stage.append(canvas);
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true });
  const size = (): void => {
    const box = host.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, MOST_PIXEL_RATIO));
    renderer.setSize(Math.max(1, Math.round(box.width)), Math.max(1, Math.round(box.height)), false);
  };
  size();
  try {
    await renderer.init();
  } catch (error) {
    canvas.remove();
    return fail("renderer-failed", `the renderer could not start: ${messageOf(error)}`);
  }
  rendererReadout(renderer);

  // The shaders read this clock, which moves while the scene runs and stays at 0 for the rest pose.
  const clock = createEffectClock(0);
  const handle = createScene(doc, { renderer, clock, reducedMotion: options.reduced, motion: { reducedMotion: options.reduced }, ...(palette === undefined ? {} : { palette }) });
  const seen = builds.get(host) ?? new Set<string>();
  builds.set(host, seen);

  let frames = 0;
  let raf = 0;
  let last = 0;
  let visible = options.visible;
  let reduced = options.reduced;
  let disposed: boolean = false;
  const hasEffects = doc.effects.length > 0;

  const publish = (): void => {
    noteBuilds(handle.root, seen);
    const memory = memoryOf(renderer);
    host.dataset["frames"] = String(frames);
    host.dataset["builds"] = String(seen.size);
    host.dataset["geometries"] = String(memory.geometries);
    host.dataset["textures"] = String(memory.textures);
    host.dataset["targets"] = String(memory.targets);
    host.dataset["programs"] = String(memory.programs);
  };
  const draw = (delta: number): void => {
    // The motion is stepped by this loop own clock, never the wall clock, and never under reduced motion: the rest pose is the first frame.
    if (!reduced) handle.advance?.(delta, { inView: visible });
    handle.render?.(delta);
    frames += 1;
  };
  const free = (): Leftovers => {
    disposed = true;
    cancelAnimationFrame(raf);
    raf = 0;
    clearInterval(timer);
    globalThis.document.removeEventListener("visibilitychange", sync);
    handle.dispose();
    const left = memoryOf(renderer);
    void renderer.dispose();
    canvas.remove();
    return { geometries: left.geometries, textures: left.textures, targets: left.targets };
  };
  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const step = Math.min((now - last) / 1000, LONGEST_STEP);
    last = now;
    clock.value += step;
    draw(step);
  };
  /** Runs the loop while the element is in view, the tab is shown and motion is allowed; stops it otherwise. */
  function sync(): void {
    const running = visible && !reduced && !globalThis.document.hidden && !disposed;
    if (running && raf === 0) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!running && raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  /** One frame now, when the loop is not the one to draw it (paused, reduced, out of view). */
  const drawNow = (): void => {
    if (raf === 0 && !disposed) {
      draw(0);
      publish();
    }
  };
  const timer = setInterval(publish, COUNTER_INTERVAL);

  try {
    await handle.ready;
    if (aborted()) throw new Error("the element was disconnected or reloaded");
    // The rest pose: the clock at 0, the first frame before anything moves.
    draw(0);
    await whenDrawn(renderer);
    if (aborted()) throw new Error("the element was disconnected or reloaded");
  } catch (error) {
    free();
    return aborted() ? fail("aborted", "the element was disconnected or reloaded") : fail("build-failed", `the scene could not be built: ${messageOf(error)}`);
  }
  publish();
  globalThis.document.addEventListener("visibilitychange", sync);
  sync();

  return {
    ok: true,
    mounted: {
      rebuildOnMotionChange: hasEffects,
      reveal: () => {
        canvas.style.visibility = "visible";
      },
      setLook: (id) => {
        let next: ScenePalette | undefined;
        if (id === null) next = paletteOfDocument(doc.look);
        else {
          next = presetOf(id);
          if (next === undefined) return fail("unknown-look", `"${id}" is not a look`, ["look"]);
        }
        handle.setLook(next);
        drawNow();
        return undefined;
      },
      setVisible: (next) => {
        visible = next;
        sync();
      },
      setReduced: (next) => {
        reduced = next;
        if (reduced) clock.value = 0;
        sync();
        drawNow();
      },
      resize: () => {
        size();
        drawNow();
      },
      dispose: free,
    },
  };
}
