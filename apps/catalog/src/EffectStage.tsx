import { ScreenEffectsPass, StudioEnvironment, StudioLights } from "@hedronite/lts-adapters";
import { createMaterial, type MaterialId } from "@hedronite/lts-materials";
import { createFramedSolid } from "@hedronite/lts-objects";
import type { ScreenEffectConfig } from "@hedronite/lts-postfx";
import { createPolyhedronGeometry, disposeObject, primitive, type PrimitiveId } from "@hedronite/lts-primitives";
import type { Hex, ScenePalette } from "@hedronite/lts-tokens";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Mesh, type Group, type Object3D } from "three";
import { GpuCounts } from "./scene";

export type StageStyle = "framed" | MaterialId;

/** A solid in the chosen style: framed (glass faces, accent metal edges) or one material all over. */
function Subject({ solid, style, palette }: { readonly solid: PrimitiveId; readonly style: StageStyle; readonly palette: ScenePalette }) {
  const spin = useRef<Group>(null);
  const object = useMemo((): Object3D => {
    const shape = primitive(solid);
    if (style === "framed") {
      return createFramedSolid(shape, { faces: createMaterial("glass", palette), edges: createMaterial("metal", { ...palette, metal: palette.accent }) });
    }
    return new Mesh(createPolyhedronGeometry(shape, solid), createMaterial(style, palette));
  }, [solid, style, palette]);
  useEffect(
    () => () => {
      disposeObject(object);
    },
    [object],
  );
  // A slow drift, as on hedronite.com, so the prints keep moving.
  useFrame((state, delta) => {
    const group = spin.current;
    if (group === null) return;
    group.rotation.y += delta * 0.25;
    group.rotation.x = Math.sin(state.clock.elapsedTime * 0.15) * 0.12 + 0.3;
  });
  return (
    <group ref={spin}>
      <primitive object={object} scale={1.15} />
    </group>
  );
}

export interface EffectStageProps {
  readonly effects: readonly ScreenEffectConfig[];
  readonly palette: ScenePalette;
  readonly paletteId: string;
  readonly solid?: PrimitiveId;
  readonly style?: StageStyle;
  readonly monochrome?: Hex | undefined;
  readonly label: string;
  readonly className?: string;
  /** Where to report frame and GPU counts, for tests. */
  readonly host?: RefObject<HTMLDivElement | null>;
}

/** A solid drifting under a stack of screen effects. Renders every frame, since effects animate. */
export function EffectStage({ effects, palette, paletteId, solid = "platonic-dodecahedron", style = "framed", monochrome, label, className = "h-72 w-full", host }: EffectStageProps) {
  const own = useRef<HTMLDivElement>(null);
  const target = host ?? own;
  return (
    <div ref={host === undefined ? own : undefined} role="img" aria-label={label} className={className} data-testid={host === undefined ? "viewport" : undefined}>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 3.6], fov: 35 }}>
        <StudioEnvironment />
        <StudioLights />
        <Subject key={`${solid}:${style}:${paletteId}`} solid={solid} style={style} palette={palette} />
        <ScreenEffectsPass effects={effects} palette={palette} {...(monochrome === undefined ? {} : { monochrome })} />
        <GpuCounts target={target} />
      </Canvas>
    </div>
  );
}
