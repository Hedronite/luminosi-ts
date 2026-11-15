import type { AssetMeta } from "@hedronite/lts-core";
import { createMaterial, isMaterialId } from "@hedronite/lts-materials";
import { createPolyhedronGeometry, createStudioLights, geodesicSphere, isPrimitiveId, primitive } from "@hedronite/lts-primitives";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { PMREMGenerator } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** A procedural studio environment for reflections; nothing is fetched. Attached to the scene, freed on unmount. */
function Environment() {
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

function Controls() {
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

function Lights() {
  const rig = useMemo(() => createStudioLights(), []);
  return <primitive object={rig} />;
}

/** The asset's mesh. Geometry and material are created here and freed when the asset or look changes. */
function Subject({ meta, palette }: { readonly meta: AssetMeta; readonly palette: ScenePalette }) {
  const invalidate = useThree((state) => state.invalidate);
  const resources = useMemo(
    () => ({
      geometry: createPolyhedronGeometry(isPrimitiveId(meta.id) ? primitive(meta.id) : geodesicSphere(6, 0.95), meta.id),
      material: createMaterial(isMaterialId(meta.id) ? meta.id : "satin", palette),
    }),
    [meta.id, palette],
  );
  useEffect(() => {
    invalidate();
    return () => {
      resources.geometry.dispose();
      resources.material.dispose();
    };
  }, [resources, invalidate]);
  return <mesh geometry={resources.geometry} material={resources.material} rotation={[0.35, 0.6, 0]} dispose={null} />;
}

/** Writes the scene's rendered frame count and live GPU resource counts onto `target`, for tests. */
function GpuCounts({ target }: { readonly target: RefObject<HTMLDivElement | null> }) {
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

/** An interactive 3D view of a primitive or material. Renders only when something changes. */
export function Viewport({ meta, palette }: { readonly meta: AssetMeta; readonly palette: ScenePalette }) {
  const host = useRef<HTMLDivElement>(null);
  return (
    <div ref={host} role="img" aria-label={`${meta.name}, rendered in 3D. Drag to rotate, scroll to zoom.`} className="h-72 w-full" data-testid="viewport">
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 0, 3.4], fov: 35 }}>
        <Environment />
        <Lights />
        <Controls />
        <Subject meta={meta} palette={palette} />
        <GpuCounts target={host} />
      </Canvas>
    </div>
  );
}
