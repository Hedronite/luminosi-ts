import { EffectClockProvider } from "@hedronite/lts-adapters/effectClock";
import { Scene } from "@hedronite/lts-adapters/scene";
import { WebGPUCanvas } from "@hedronite/lts-adapters/webgpu";
import type { Scene as SceneDocument } from "@hedronite/lts-scene";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { useEffect, useThree, type MutableRefObject, type RefObject } from "react";
import type { Object3D } from "three";
import type { EffectClock } from "@hedronite/lts-shaders/three";
import { noteEffectTargets } from "./builds";
import { stageFrameloop, WakeOnShow } from "./onscreen";
import { Controls, GpuCounts, StageClock, StageHold, type Motion } from "./scene";

function RedrawOnLook({ lookId }: { readonly lookId: string }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [lookId, invalidate]);
  return null;
}

export interface PlaygroundStageProps {
  readonly shown: SceneDocument;
  readonly palette: ScenePalette;
  readonly lookId: string;
  readonly motion: Motion;
  readonly animated: boolean;
  readonly onscreen: boolean;
  readonly host: RefObject<HTMLDivElement | null>;
  readonly built: MutableRefObject<Object3D | undefined>;
  readonly clockRef: MutableRefObject<number>;
  readonly shaderClock: EffectClock;
  readonly writeShaderTime: (time: number) => void;
}

/** WebGPU viewport and scene runtime; its own chunk so the finish engine is not on Playground's static graph. */
export default function PlaygroundStage({
  shown,
  palette,
  lookId,
  motion,
  animated,
  onscreen,
  host,
  built,
  clockRef,
  shaderClock,
  writeShaderTime,
}: PlaygroundStageProps) {
  return (
    <WebGPUCanvas frameloop={stageFrameloop(onscreen, !animated || motion.still)} dpr={[1, 2]} camera={{ position: [0, 2.2, 5.5], fov: 40 }}>
      <WakeOnShow shown={onscreen} />
      <RedrawOnLook lookId={lookId} />
      <Controls keys={host} />
      <StageHold holdRef={motion.holdRef} />
      <StageClock clockRef={clockRef} running={animated && !motion.still} writeShaderTime={writeShaderTime} />
      <EffectClockProvider clock={shaderClock}>
        <Scene
          doc={shown}
          palette={palette}
          paused={motion.paused}
          onRoot={(root) => {
            built.current = root;
          }}
          onEffectTargets={(ids) => {
            noteEffectTargets(host.current, ids);
          }}
        />
      </EffectClockProvider>
      <GpuCounts target={host} clockRef={clockRef} shaderClock={shaderClock} watch={built} screenEffects holdRef={motion.holdRef} />
    </WebGPUCanvas>
  );
}