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
   * Told the root of what the scene built (and told `undefined` when it is freed). With a WebGPU renderer the scene draws its own
   * graph, which is no part of the canvas's, so this is how a caller reads it (to count what it built, say).
   */
  readonly onRoot?: (root: Group | undefined) => void;
}

/** A property check, not an instanceof: this entry must not import three's WebGPU build. */
const isWebGPURenderer = (gl: unknown): gl is WebGPURenderer => typeof gl === "object" && gl !== null && "isWebGPURenderer" in gl;

/**
 * Draws a scene document: its nodes, lights, camera, studio environment and screen effects. Mount it inside `WebGPUCanvas`
 * (`@hedronite/lts-adapters/webgpu`); there it takes over rendering from React Three Fiber, like `ScreenEffectsPass`, and
 * makes the document's camera the canvas's. On another renderer it adds the nodes and lights to the canvas's scene and
 * leaves the environment, the effects and any surface shader (which need WebGPU) out. Frees everything it built on unmount.
 */
export function Scene({ doc, palette, reducedMotion, onRoot }: SceneProps) {
  const gl: unknown = useThree((state) => state.gl);
  const renderer = isWebGPURenderer(gl) ? gl : undefined;
  const invalidate = useThree((state) => state.invalidate);
  const set = useThree((state) => state.set);
  const get = useThree((state) => state.get);
  const clock = useContext(EffectClockContext);
  const preferred = useReducedMotion();
  const still = reducedMotion ?? preferred;

  // The state says "there is a scene now" (and draws it); the ref is the live one, which the effects below read, so that none
  // of them reaches a scene a rebuild just freed.
  const [handle, setHandle] = useState<SceneHandle | undefined>(undefined);
  const live = useRef<SceneHandle | undefined>(undefined);
  const latest = useRef({ doc, palette, onRoot });
  useEffect(() => {
    latest.current = { doc, palette, onRoot };
  });

  useEffect(() => {
    const { doc: first, palette: look } = latest.current;
    const made = createScene(first, { ...(look === undefined ? {} : { palette: look }), ...(renderer === undefined ? {} : { renderer }), ...(clock === undefined ? {} : { clock }), reducedMotion: still });
    live.current = made;
    latest.current.onRoot?.(made.root);
    setHandle(made);
    made.ready.then(
      () => {
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
    live.current?.update(doc).then(
      () => {
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
      live.current?.setPointer?.({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
      invalidate();
    };
    const leave = (): void => {
      live.current?.setPointer?.(null);
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
    live.current?.render?.(Math.min(delta, 0.1));
  }, renderer === undefined ? 0 : 1);

  return handle === undefined || renderer !== undefined ? null : <primitive object={handle.root} dispose={null} />;
}
