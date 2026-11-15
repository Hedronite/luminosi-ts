import type { AssetMeta } from "@hedronite/lts-core";
import { StudioLights } from "@hedronite/lts-adapters";
import { createPolyhedronGeometry, geodesicSphere } from "@hedronite/lts-primitives";
import { createEffectMaterial, isEffectId } from "@hedronite/lts-shaders";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { WebGPURenderer } from "three/webgpu";
import { Controls, GpuCounts } from "./scene";

function EffectSphere({ id, palette }: { readonly id: string; readonly palette: ScenePalette }) {
  const resources = useMemo(
    () => (isEffectId(id) ? { geometry: createPolyhedronGeometry(geodesicSphere(6, 0.95), "sphere"), material: createEffectMaterial(id, palette) } : undefined),
    [id, palette],
  );
  useEffect(
    () => () => {
      resources?.geometry.dispose();
      resources?.material.dispose();
    },
    [resources],
  );
  return resources === undefined ? null : <mesh geometry={resources.geometry} material={resources.material} dispose={null} />;
}

/**
 * A 3D view for TSL shaders. TSL needs three's WebGPURenderer, which falls back to WebGL 2 where WebGPU
 * is missing. Renders every frame, since effects can animate.
 */
export function ShaderViewport({ meta, palette, paletteId }: { readonly meta: AssetMeta; readonly palette: ScenePalette; readonly paletteId: string }) {
  const host = useRef<HTMLDivElement>(null);
  return (
    <div ref={host} role="img" aria-label={`${meta.name}, a shader on a sphere. Drag to rotate, scroll to zoom.`} className="h-72 w-full" data-testid="viewport">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 3.4], fov: 35 }}
        gl={async ({ canvas }) => {
          // R3F hands over a DOM canvas in the browser; its OffscreenCanvas type differs from three's.
          if (!(canvas instanceof HTMLCanvasElement)) throw new Error("the shader viewport needs a DOM canvas");
          const renderer = new WebGPURenderer({ canvas, antialias: true });
          await renderer.init();
          return renderer;
        }}
      >
        <StudioLights />
        <Controls />
        <EffectSphere key={`${meta.id}:${paletteId}`} id={meta.id} palette={palette} />
        <GpuCounts target={host} />
      </Canvas>
    </div>
  );
}
