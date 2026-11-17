import type { AssetMeta } from "@hedronite/lts-core";
import { StudioLights } from "@hedronite/lts-adapters";
import { effectInfo, isEffectId } from "@hedronite/lts-shaders";
import { createEffectMaterial } from "@hedronite/lts-shaders/three";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, Color, MeshBasicMaterial, SphereGeometry, WebGPURenderer } from "three/webgpu";
import { useReducedMotion } from "./motion";
import { Controls, GpuCounts } from "./scene";

// A smooth sphere: effects that read the surface's turn (toon bands, refraction, rims) need smooth normals.
function EffectSphere({ id, palette }: { readonly id: string; readonly palette: ScenePalette }) {
  const resources = useMemo(
    () => (isEffectId(id) ? { geometry: new SphereGeometry(0.95, 64, 32), material: createEffectMaterial(id, palette) } : undefined),
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

/** Stripes behind the sphere, for effects that show what's behind them (refraction, hologram). */
function Backdrop({ palette }: { readonly palette: ScenePalette }) {
  const resources = useMemo(
    () => ({ geometry: new BoxGeometry(0.22, 4, 0.02), light: new MeshBasicMaterial({ color: new Color(palette.accent) }), dark: new MeshBasicMaterial({ color: new Color(palette.base) }) }),
    [palette],
  );
  useEffect(
    () => () => {
      resources.geometry.dispose();
      resources.light.dispose();
      resources.dark.dispose();
    },
    [resources],
  );
  return (
    <group position={[0, 0, -1.4]} rotation={[0, 0, 0.35]}>
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={i} geometry={resources.geometry} material={i % 2 === 0 ? resources.light : resources.dark} position={[(i - 5) * 0.44, 0, 0]} dispose={null} />
      ))}
    </group>
  );
}

/**
 * A 3D view for TSL shaders. TSL needs three's WebGPURenderer, which falls back to WebGL 2 where WebGPU
 * is missing. Renders every frame, since effects can animate; under reduced motion only on change.
 */
export function ShaderViewport({ meta, palette, paletteId }: { readonly meta: AssetMeta; readonly palette: ScenePalette; readonly paletteId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  return (
    <div ref={host} role="img" aria-label={`${meta.name}, a shader on a sphere. Drag to rotate, scroll to zoom.`} className="h-72 w-full" data-testid="viewport">
      <Canvas
        frameloop={still ? "demand" : "always"}
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
        {isEffectId(meta.id) && effectInfo[meta.id].seeThrough === true ? <Backdrop key={paletteId} palette={palette} /> : null}
        <EffectSphere key={`${meta.id}:${paletteId}`} id={meta.id} palette={palette} />
        <GpuCounts target={host} />
      </Canvas>
    </div>
  );
}
