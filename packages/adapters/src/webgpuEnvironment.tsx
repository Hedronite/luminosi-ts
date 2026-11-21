import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { PMREMGenerator, WebGPURenderer } from "three/webgpu";
import { bakeStudioRoom } from "./studioRoom.js";

/**
 * A procedural studio room as the scene's environment, prefiltered by the WebGPU renderer's own
 * generator. Use it inside `WebGPUCanvas`. It bakes the same room as the root `StudioEnvironment` (the WebGL one),
 * with the same blur, intensity and tone mapping (see `studioRoom.ts`), so a viewport moved to the WebGPU renderer keeps its lighting. Nothing is
 * fetched. Freed on unmount.
 */
export function WebGPUStudioEnvironment() {
  const gl: unknown = useThree((state) => state.gl);
  if (!(gl instanceof WebGPURenderer)) throw new Error("WebGPUStudioEnvironment runs on the WebGPU renderer: put it inside <WebGPUCanvas>");
  const target = useMemo(() => bakeStudioRoom(new PMREMGenerator(gl)), [gl]);
  useEffect(
    () => () => {
      target.dispose();
    },
    [target],
  );
  return <primitive object={target.texture} attach="environment" />;
}
