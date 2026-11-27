import { StudioLights } from "@hedronite/lts-adapters";
import { ScreenEffectsPass, WebGPUCanvas, WebGPUStudioEnvironment } from "@hedronite/lts-adapters/webgpu";
import type { ScreenEffectConfig } from "@hedronite/lts-postfx";
import type { EffectClock } from "@hedronite/lts-shaders/three";
import { disposeObject } from "@hedronite/lts-primitives/three";
import type { Hex, ScenePalette } from "@hedronite/lts-tokens";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Group, Object3D } from "three";
import { noteEffectTargets } from "./builds";
import { Controls, GpuCounts, StageClock, StageFrame, StageHold, useMotion } from "./scene";
import { stageFrameloop, useStageShown, WakeOnShow } from "./onscreen";
import { buildStage, repaintStage, type StageSubject, type StageSurface } from "./stage";
import { useShaderClock } from "./shaderClock";

/** The subject in its surface, drifting slowly as on hedronite.com so the prints keep moving; still under reduced motion or when paused. */
function Subject({ subject, surface, palette, still, clock, shaderClock }: { readonly subject: StageSubject; readonly surface: StageSurface; readonly palette: ScenePalette; readonly still: boolean; readonly clock: RefObject<number>; readonly shaderClock: EffectClock }) {
  const spin = useRef<Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  // The descriptors build it, so it arrives after a moment; the last one stays on show until the next is ready.
  const [object, setObject] = useState<Object3D | undefined>(undefined);
  // The look a build starts from is the latest one.
  const look = useRef(palette);
  useEffect(() => {
    look.current = palette;
  });
  useEffect(() => {
    let current = true;
    buildStage(subject, surface, look.current, shaderClock).then(
      (built) => {
        if (!current) {
          disposeObject(built);
          return;
        }
        setObject(built);
        invalidate();
      },
      (error: unknown) => {
        if (current) console.error("could not build the stage", error);
      },
    );
    return () => {
      current = false;
    };
  }, [subject, surface, shaderClock, invalidate]);
  useEffect(
    () => () => {
      if (object !== undefined) disposeObject(object);
    },
    [object],
  );
  // A change of look recolors what is built, in place: the geometry and the programs stay.
  useEffect(() => {
    if (object === undefined) return;
    repaintStage(object, palette);
    invalidate();
  }, [object, palette, invalidate]);
  useFrame((_, delta) => {
    const group = spin.current;
    if (group === null || still) return;
    // A long gap (a stage that was paused) must not show as a jump.
    group.rotation.y += Math.min(delta, 0.1) * 0.25;
    group.rotation.x = Math.sin(clock.current * 0.15) * 0.12 + 0.3;
  });
  return (
    <group ref={spin} rotation={[0.3, 0.6, 0]}>
      {object === undefined ? null : <primitive object={object} scale={subject.kind === "solid" ? 1.15 : 1} dispose={null} />}
    </group>
  );
}

const framedDodecahedron: StageSubject = { kind: "solid", id: "platonic-dodecahedron" };
const framed: StageSurface = { kind: "framed" };

export interface EffectStageProps {
  readonly effects: readonly ScreenEffectConfig[];
  readonly palette: ScenePalette;
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
 * effects meet in one scene. Renders every frame, since effects and shaders animate, with a pause
 * button; paused, or under reduced motion, it holds a still frame and renders only on change, key or
 * pointer movement. Off screen, or in a hidden tab, it renders nothing.
 */
export function EffectStage({ effects, palette, subject = framedDodecahedron, surface = framed, monochrome, label, className = "h-72 w-full", host }: EffectStageProps) {
  const own = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const { clock: shaderClock, write: writeShaderTime } = useShaderClock();
  const motion = useMotion(true);
  const shown = useStageShown(own);
  // The counts go to the page's own host when it gave one; the keys always belong to the group.
  const target = host ?? own;
  // Every pipeline the pass builds hands over its render-target textures; the set keeps them all, so only a build raises the count.
  const noteTargets = (ids: readonly string[]): void => {
    noteEffectTargets(target.current, ids);
  };
  return (
    <StageFrame group={own} motion={motion} label={label} className={className} testId={host === undefined ? "viewport" : undefined}>
      <WebGPUCanvas frameloop={stageFrameloop(shown, motion.still)} dpr={[1, 2]} camera={{ position: [0, 0, 3.6], fov: 35 }}>
        <WakeOnShow shown={shown} />
        <WebGPUStudioEnvironment />
        <StudioLights />
        <Controls keys={own} />
        <StageHold holdRef={motion.holdRef} />
        <StageClock clockRef={clock} running={!motion.still} writeShaderTime={writeShaderTime} />
        <Subject subject={subject} surface={surface} palette={palette} still={motion.still} clock={clock} shaderClock={shaderClock} />
        {effects.length === 0 ? null : <ScreenEffectsPass effects={effects} palette={palette} onPipeline={noteTargets} {...(monochrome === undefined ? {} : { monochrome })} />}
        <GpuCounts target={target} clockRef={clock} shaderClock={shaderClock} screenEffects running={!motion.still} />
      </WebGPUCanvas>
    </StageFrame>
  );
}
