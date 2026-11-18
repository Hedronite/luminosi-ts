import type { AssetMeta } from "@hedronite/lts-core";
import { EffectClockProvider, StudioLights, useEffectMaterial } from "@hedronite/lts-adapters";
import { effectInfo, isEffectId } from "@hedronite/lts-shaders";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, MeshBasicMaterial, SphereGeometry, WebGPURenderer } from "three/webgpu";
import { stageFrameloop, useStageShown, WakeOnShow } from "./onscreen";
import { Controls, GpuCounts, StageClock, StageFrame, useMotion } from "./scene";
import { useShaderClock } from "./shaderClock";
import { shaderParams, useParamsQuery } from "./shaderParams";

// A smooth sphere: effects that read the surface's turn (toon bands, refraction, rims) need smooth normals.
function EffectSphere({ id, palette, params }: { readonly id: string; readonly palette: ScenePalette; readonly params: Readonly<Record<string, unknown>> | undefined }) {
  const geometry = useMemo(() => new SphereGeometry(0.95, 64, 32), []);
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  // The parameters move the shader live: a change writes its uniforms, and builds nothing.
  const material = useEffectMaterial(isEffectId(id) ? id : undefined, palette, params);
  return material === undefined ? null : <mesh geometry={geometry} material={material} dispose={null} />;
}

/** Stripes behind the sphere, for effects that show what's behind them (refraction, hologram). */
function Backdrop({ palette }: { readonly palette: ScenePalette }) {
  const invalidate = useThree((state) => state.invalidate);
  const resources = useMemo(() => ({ geometry: new BoxGeometry(0.22, 4, 0.02), light: new MeshBasicMaterial(), dark: new MeshBasicMaterial() }), []);
  // The stripes take the look's colors, written in place when the look changes.
  useEffect(() => {
    resources.light.color.set(palette.accent);
    resources.dark.color.set(palette.base);
    invalidate();
  }, [resources, palette, invalidate]);
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
 * is missing. Renders every frame, since effects can animate; paused, or under reduced motion, only on change;
 * off screen, or in a hidden tab, not at all.
 */
export function ShaderViewport({ meta, palette }: { readonly meta: AssetMeta; readonly palette: ScenePalette }) {
  const group = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const { clock: shaderClock, write: writeShaderTime } = useShaderClock();
  // The page's `params` value (`?params=density=80,speed=3`, or a JSON object) moves the shader's parameters live.
  const query = useParamsQuery();
  const params = useMemo(() => (isEffectId(meta.id) ? shaderParams(query) : undefined), [meta.id, query]);
  const motion = useMotion(isEffectId(meta.id) && effectInfo[meta.id].animated === true);
  const shown = useStageShown(group);
  return (
    <StageFrame group={group} motion={motion} label={`${meta.name}, a shader on a sphere.`} className="h-72 w-full" testId="viewport">
      <Canvas
        frameloop={stageFrameloop(shown, motion.still)}
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
        <WakeOnShow shown={shown} />
        <StudioLights />
        <Controls keys={group} />
        <StageClock clockRef={clock} running={!motion.still} writeShaderTime={writeShaderTime} />
        {isEffectId(meta.id) && effectInfo[meta.id].seeThrough === true ? <Backdrop palette={palette} /> : null}
        <EffectClockProvider clock={shaderClock}>
          <EffectSphere key={meta.id} id={meta.id} palette={palette} params={params} />
        </EffectClockProvider>
        <GpuCounts target={group} clockRef={clock} shaderClock={shaderClock} />
      </Canvas>
    </StageFrame>
  );
}
