import { ScreenEffects, type ScreenEffectConfig } from "@hedronite/lts-postfx";
import { neutral, type Hex, type ScenePalette } from "@hedronite/lts-tokens";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";

export interface ScreenEffectsPassProps {
  /** The stack, in any order (it runs smoke behind, prints, then grain). Memoize it: a new array rebuilds the passes. */
  readonly effects: readonly ScreenEffectConfig[];
  /** Scene colors the inks come from. Default: the neutral token preset. */
  readonly palette?: ScenePalette;
  /** Print in one ink only. */
  readonly monochrome?: Hex;
  /** Skip the intro and the sweep, and open the lens at once. */
  readonly reducedMotion?: boolean;
}

/**
 * Renders the canvas through screen effects (`@hedronite/lts-postfx`). It takes over rendering from
 * React Three Fiber, follows the pointer for the lens (a tap opens it for a moment on touch), and frees
 * its passes when the stack changes or it unmounts.
 */
export function ScreenEffectsPass({ effects, palette = neutral.scene, monochrome, reducedMotion = false }: ScreenEffectsPassProps) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const runner = useMemo(
    () => new ScreenEffects(gl, scene, camera, effects, { palette, reducedMotion, ...(monochrome === undefined ? {} : { monochrome }) }),
    [gl, scene, camera, effects, palette, monochrome, reducedMotion],
  );
  useEffect(
    () => () => {
      runner.dispose();
    },
    [runner],
  );
  useEffect(() => {
    runner.setSize(size.width, size.height);
  }, [runner, size]);

  useEffect(() => {
    const element = gl.domElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const move = (event: PointerEvent): void => {
      const rect = element.getBoundingClientRect();
      runner.setPointer({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
    };
    const leave = (): void => {
      runner.setPointer(null);
    };
    // Touch has no hover: a tap opens the lens where it lands, then it closes.
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
  }, [gl, runner]);

  // A positive priority takes over rendering from React Three Fiber.
  useFrame((_, delta) => {
    runner.render(delta);
  }, 1);
  return null;
}
