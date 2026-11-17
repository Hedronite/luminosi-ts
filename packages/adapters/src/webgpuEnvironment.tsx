import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { PMREMGenerator, WebGPURenderer } from "three/webgpu";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * A procedural studio room as the scene's environment, prefiltered by the WebGPU renderer's own
 * generator. Use it inside `WebGPUCanvas`; the root `StudioEnvironment` is the WebGL one. Nothing is
 * fetched. Freed on unmount.
 */
export function WebGPUStudioEnvironment() {
  const gl: unknown = useThree((state) => state.gl);
  if (!(gl instanceof WebGPURenderer)) throw new Error("WebGPUStudioEnvironment runs on the WebGPU renderer: put it inside <WebGPUCanvas>");
  const target = useMemo(() => {
    const room = new RoomEnvironment();
    const pmrem = new PMREMGenerator(gl);
    const result = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    return result;
  }, [gl]);
  useEffect(
    () => () => {
      target.dispose();
    },
    [target],
  );
  return <primitive object={target.texture} attach="environment" />;
}
