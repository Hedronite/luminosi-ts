import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** The studio environment comes from the adapters, so the catalog uses what consumers use. */
export { StudioEnvironment as Environment } from "@hedronite/lts-adapters";

export function Controls() {
  const { camera, gl, invalidate } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enablePan = false;
    controls.minDistance = 1.8;
    controls.maxDistance = 7;
    const onChange = (): void => {
      invalidate();
    };
    controls.addEventListener("change", onChange);
    return () => {
      controls.removeEventListener("change", onChange);
      controls.dispose();
    };
  }, [camera, gl, invalidate]);
  return null;
}

/** Writes the scene's rendered frame count and live GPU resource counts onto `target`, for tests. */
export function GpuCounts({ target }: { readonly target: RefObject<HTMLDivElement | null> }) {
  const gl = useThree((state) => state.gl);
  // useFrame runs once per scene render, so environment baking does not count.
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
  });
  useEffect(() => {
    const timer = setInterval(() => {
      const element = target.current;
      if (element === null) return;
      element.dataset["frames"] = String(frames.current);
      element.dataset["gpuGeometries"] = String(gl.info.memory.geometries);
      element.dataset["gpuTextures"] = String(gl.info.memory.textures);
    }, 150);
    return () => {
      clearInterval(timer);
    };
  }, [gl, target]);
  return null;
}

