import { ScreenEffectsPass, StudioEnvironment, StudioLights, WebGPUCanvas } from "@hedronite/lts-adapters";
import type { ScreenEffectConfig } from "@hedronite/lts-postfx";
import { disposeObject } from "@hedronite/lts-primitives";
import type { Hex, ScenePalette } from "@hedronite/lts-tokens";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { Group } from "three";
import { useReducedMotion } from "./motion";
import { GpuCounts } from "./scene";
import { buildStage, type StageSubject, type StageSurface } from "./stage";

/** The subject in its surface, drifting slowly as on hedronite.com so the prints keep moving; still under reduced motion. */
function Subject({ subject, surface, palette, still }: { readonly subject: StageSubject; readonly surface: StageSurface; readonly palette: ScenePalette; readonly still: boolean }) {
  const spin = useRef<Group>(null);
  const object = useMemo(() => buildStage(subject, surface, palette), [subject, surface, palette]);
  useEffect(
    () => () => {
      disposeObject(object);
    },
    [object],
  );
  useFrame((state, delta) => {
    const group = spin.current;
    if (group === null || still) return;
    group.rotation.y += delta * 0.25;
    group.rotation.x = Math.sin(state.clock.elapsedTime * 0.15) * 0.12 + 0.3;
  });
  return (
    <group ref={spin} rotation={[0.3, 0.6, 0]}>
      <primitive object={object} scale={subject.kind === "solid" ? 1.15 : 1} />
    </group>
  );
}

const framedDodecahedron: StageSubject = { kind: "solid", id: "platonic-dodecahedron" };
const framed: StageSurface = { kind: "framed" };

export interface EffectStageProps {
  readonly effects: readonly ScreenEffectConfig[];
  readonly palette: ScenePalette;
  readonly paletteId: string;
  readonly subject?: StageSubject;
  readonly surface?: StageSurface;
  readonly monochrome?: Hex | undefined;
  readonly label: string;
  readonly className?: string;
  /** Where to report frame and GPU counts, for tests. */
  readonly host?: RefObject<HTMLDivElement | null>;
}

/**
 * A subject under a stack of screen effects, on the WebGPU renderer, so surface shaders and screen
 * effects meet in one scene. Renders every frame, since effects and shaders animate; under reduced
 * motion it holds a still frame and renders only on change or pointer movement.
 */
export function EffectStage({ effects, palette, paletteId, subject = framedDodecahedron, surface = framed, monochrome, label, className = "h-72 w-full", host }: EffectStageProps) {
  const own = useRef<HTMLDivElement>(null);
  const target = host ?? own;
  const still = useReducedMotion();
  return (
    <div ref={host === undefined ? own : undefined} role="img" aria-label={label} className={className} data-testid={host === undefined ? "viewport" : undefined}>
      <WebGPUCanvas frameloop={still ? "demand" : "always"} dpr={[1, 2]} camera={{ position: [0, 0, 3.6], fov: 35 }}>
        <StudioEnvironment />
        <StudioLights />
        <Subject key={paletteId} subject={subject} surface={surface} palette={palette} still={still} />
        {effects.length === 0 ? null : <ScreenEffectsPass effects={effects} palette={palette} reducedMotion={still} {...(monochrome === undefined ? {} : { monochrome })} />}
        <GpuCounts target={target} />
      </WebGPUCanvas>
    </div>
  );
}
