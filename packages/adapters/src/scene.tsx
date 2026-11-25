import type { Scene as SceneDocument } from "@hedronite/lts-scene";
import { createScene, type SceneHandle } from "@hedronite/lts-scene/three";
import { type ScenePalette } from "@hedronite/lts-tokens";
import { useFrame, useThree } from "@react-three/fiber";
import { useContext, useEffect, useRef, useState } from "react";
import type { Group } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { EffectClockContext } from "./effectClock.js";
import { useReducedMotion } from "./motion.js";

export interface SceneProps {
  /** The scene document. A new object with equal content builds nothing; a changed node builds again and no other does. */
  readonly doc: SceneDocument;
  /** Scene colors. Default: the document's own `look`. A palette given here outranks it, and a change of it recolors in place. */
  readonly palette?: ScenePalette;
  /**
   * Skip the screen effects' intro and sweep, and open the lens at once.
   * Default: the viewer's reduced-motion setting (`useReducedMotion`). Changing it builds the scene again.
   */
  readonly reducedMotion?: boolean;
  /**
   * Paused by the stage's own controls: draw on demand, and step the document's tracks not at all (R9). Default: false. A change
   * of this does not build the scene again — it only stops the tracks where they are, and a redraw for a pointer or an orbit
   * draws the pose they hold.
   */
  readonly paused?: boolean;
  /**
   * Told the root of what the scene built (and told `undefined` when it is freed). With a WebGPU renderer the scene draws its own
   * graph, which is no part of the canvas's, so this is how a caller reads it (to count what it built, say).
   */
  readonly onRoot?: (root: Group | undefined) => void;
  /**
   * Told the `uuid` of every render-target texture the scene's screen-effect pipelines have held (`SceneHandle.effectTargets`), each time the
   * scene has built or updated: the list only grows, and a stack of another structure adds its own. Only with a WebGPU renderer, which is what
   * runs the effects; a caller that counts pipelines keeps what it is told (a scene built again lists its own, from the start).
   */
  readonly onEffectTargets?: (ids: readonly string[]) => void;
}

/** Where the pointer is for the document's tracks: -1 to 1 on each axis, and whether it is over the stage. The lens keeps a 0-to-1 copy of its own. */
interface MotionPointer {
  pointer?: { readonly x: number; readonly y: number };
  hovered: boolean;
}

/** A property check, not an instanceof: this entry must not import three's WebGPU build. */
const isWebGPURenderer = (gl: unknown): gl is WebGPURenderer => typeof gl === "object" && gl !== null && "isWebGPURenderer" in gl;

/**
 * Draws a scene document: its nodes, lights, camera, studio environment and screen effects. Mount it inside `WebGPUCanvas`
 * (`@hedronite/lts-adapters/webgpu`); there it takes over rendering from React Three Fiber, like `ScreenEffectsPass`, and
 * makes the document's camera the canvas's. On another renderer it adds the nodes and lights to the canvas's scene and
 * leaves the environment, the effects and any surface shader (which need WebGPU) out. Frees everything it built on unmount.
 */
export function Scene({ doc, palette, reducedMotion, paused = false, onRoot, onEffectTargets }: SceneProps) {
  const gl: unknown = useThree((state) => state.gl);
  const renderer = isWebGPURenderer(gl) ? gl : undefined;
  const invalidate = useThree((state) => state.invalidate);
  const set = useThree((state) => state.set);
  const get = useThree((state) => state.get);
  const clock = useContext(EffectClockContext);
  const preferred = useReducedMotion();
  const still = reducedMotion ?? preferred;
  /** Held: the picture stands. A paused stage draws on demand and steps nothing, so a redraw shows the pose the tracks hold. */
  const held = still || paused;
  const motionPointer = useRef<MotionPointer>({ hovered: false });

  // The state says "there is a scene now" (and draws it); the ref is the live one, which the effects below read, so that none
  // of them reaches a scene a rebuild just freed.
  const [handle, setHandle] = useState<SceneHandle | undefined>(undefined);
  const live = useRef<SceneHandle | undefined>(undefined);
  const latest = useRef({ doc, palette, onRoot, onEffectTargets });
  useEffect(() => {
    latest.current = { doc, palette, onRoot, onEffectTargets };
  });
  /** Tells what the scene's pipelines have held, unless the scene was freed or built again meanwhile. */
  const reportTargets = (from: SceneHandle): void => {
    if (live.current !== from) return;
    const ids = from.effectTargets?.();
    if (ids !== undefined) latest.current.onEffectTargets?.(ids);
  };

  useEffect(() => {
    const { doc: first, palette: look } = latest.current;
    const made = createScene(first, { ...(look === undefined ? {} : { palette: look }), ...(renderer === undefined ? {} : { renderer }), ...(clock === undefined ? {} : { clock }), reducedMotion: still, motion: { reducedMotion: still } });
    live.current = made;
    latest.current.onRoot?.(made.root);
    setHandle(made);
    made.ready.then(
      () => {
        reportTargets(made);
        invalidate();
      },
      (error: unknown) => {
        console.error("could not build the scene", error);
        invalidate();
      },
    );
    return () => {
      live.current = undefined;
      latest.current.onRoot?.(undefined);
      made.dispose();
    };
  }, [renderer, clock, still, invalidate]);

  useEffect(() => {
    const current = live.current;
    current?.update(doc).then(
      () => {
        reportTargets(current);
        invalidate();
      },
      (error: unknown) => {
        console.error("could not update the scene", error);
        invalidate();
      },
    );
  }, [handle, doc, invalidate]);

  useEffect(() => {
    if (palette === undefined) return;
    live.current?.setLook(palette);
    invalidate();
  }, [handle, palette, invalidate]);

  // The document's camera is the canvas's, so controls and resizing act on it.
  useEffect(() => {
    if (handle === undefined || renderer === undefined) return undefined;
    const previous = get().camera;
    set({ camera: handle.camera });
    return () => {
      set({ camera: previous });
    };
  }, [handle, renderer, set, get]);

  // The lens follows the pointer; a tap opens it for a moment on touch.
  useEffect(() => {
    if (renderer === undefined) return undefined;
    const element = renderer.domElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const move = (event: PointerEvent): void => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      live.current?.setPointer?.({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
      // The tracks read the same pointer the other way round: -1 to 1 from the stage's centre, with the stage seen and hovered.
      motionPointer.current = { pointer: { x: ((event.clientX - rect.left) / rect.width) * 2 - 1, y: ((event.clientY - rect.top) / rect.height) * 2 - 1 }, hovered: true };
      invalidate();
    };
    const leave = (): void => {
      live.current?.setPointer?.(null);
      motionPointer.current = { hovered: false };
      invalidate();
    };
    const up = (event: PointerEvent): void => {
      if (event.pointerType === "mouse") return;
      clearTimeout(timer);
      timer = setTimeout(leave, 1600);
    };
    element.addEventListener("pointermove", move, { passive: true });
    element.addEventListener("pointerdown", move, { passive: true });
    element.addEventListener("pointerup", up, { passive: true });
    element.addEventListener("pointerleave", leave);
    return () => {
      clearTimeout(timer);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerdown", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointerleave", leave);
    };
  }, [renderer, invalidate]);

  // A positive priority takes over rendering from React Three Fiber, so only a scene that draws itself asks for it.
  useFrame((_, delta) => {
    // A long gap (a hidden tab, a paused stage) is one short step, not a jump through the intro and the sweep.
    const step = Math.min(delta, 0.1);
    // The document own tracks, stepped by the render loop clock rather than the wall clock; held for a stage that asked for reduced
    // motion and for one paused by its own controls, so a redraw drawn on demand steps nothing.
    // The pointer and the hover come from the same listeners that feed the lens, in the tracks' own -1-to-1 reading.
    if (!held) {
      const where = motionPointer.current;
      live.current?.advance(step, { inView: true, ...(where.pointer === undefined ? {} : { pointer: where.pointer }), hovered: where.hovered });
    }
    live.current?.render?.(step);
  }, renderer === undefined ? 0 : 1);

  return handle === undefined || renderer !== undefined ? null : <primitive object={handle.root} dispose={null} />;
}
