import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { PMREMGenerator } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** A procedural studio environment for reflections; nothing is fetched. Attached to the scene, freed on unmount. */
export function Environment() {
  const gl = useThree((state) => state.gl);
  const target = useMemo(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
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

