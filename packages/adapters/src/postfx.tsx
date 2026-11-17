import { ScreenEffects, type ScreenEffectConfig } from "@hedronite/lts-postfx";
import { neutral, type Hex, type ScenePalette } from "@hedronite/lts-tokens";
import { Canvas, useFrame, useThree, type CanvasProps } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { WebGPURenderer } from "three/webgpu";

/**
 * A React Three Fiber canvas on three's WebGPURenderer: WebGPU where the browser has it, WebGL 2 where
 * it doesn't. TSL surface shaders (`@hedronite/lts-shaders`) and screen effects need it; material
 * presets and every other adapter work on it too.
 */
export function WebGPUCanvas(props: Omit<CanvasProps, "gl">) {
  return (
    <Canvas
      {...props}
      gl={async ({ canvas }) => {
        // In the browser R3F hands over a DOM canvas; its OffscreenCanvas type differs from three's.
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("WebGPUCanvas needs a DOM canvas");
        const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true });
        await renderer.init();
        return renderer;
      }}
    />
  );
}

export interface ScreenEffectsPassProps {
  /** The stack, in any order (it runs smoke behind, prints, then grain). Memoize it: a new array rebuilds the passes. */
  readonly effects: readonly ScreenEffectConfig[];
  /** Scene colors the inks come from. Default: the neutral token preset. */
  readonly palette?: ScenePalette;
  /** Print in one ink only. */
  readonly monochrome?: Hex;
  /** Skip the intro and the sweep, and open and close the lens at once. Pair it with frameloop="demand" for a still stage. */
  readonly reducedMotion?: boolean;
}

/**
 * Renders the canvas through screen effects (`@hedronite/lts-postfx`). Use it inside `WebGPUCanvas`:
 * the effects are TSL passes on the WebGPU renderer. It takes over rendering from React Three Fiber, follows the pointer for the lens (a tap opens it for a moment on touch), and frees
 * its passes when the stack changes or it unmounts.
 */
export function ScreenEffectsPass({ effects, palette = neutral.scene, monochrome, reducedMotion = false }: ScreenEffectsPassProps) {
  const gl: unknown = useThree((state) => state.gl);
  if (!(gl instanceof WebGPURenderer)) throw new Error("ScreenEffectsPass runs on the WebGPU renderer: put it inside <WebGPUCanvas>");
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  // Under frameloop="demand" (a still stage for reduced motion) the pointer asks for each lens frame.
  const invalidate = useThree((state) => state.invalidate);
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
    runner.setSize();
  }, [runner, size]);

  useEffect(() => {
    const element = gl.domElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const move = (event: PointerEvent): void => {
      const rect = element.getBoundingClientRect();
      runner.setPointer({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
      invalidate();
    };
    const leave = (): void => {
      runner.setPointer(null);
      invalidate();
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
  }, [gl, runner, invalidate]);

  // A positive priority takes over rendering from React Three Fiber.
  useFrame((_, delta) => {
    runner.render(delta);
  }, 1);
  return null;
}
