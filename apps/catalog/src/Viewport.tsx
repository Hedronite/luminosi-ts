import type { AssetMeta } from "@hedronite/lts-core";
import { ScreenEffectsPass, WebGPUCanvas, WebGPUEnvironment, WebGPUStage } from "@hedronite/lts-adapters/webgpu";
import { applyPalette } from "@hedronite/lts-materials/three";
import { hasStagePostfx } from "@hedronite/lts-postfx";
import { createStudioLights, disposeObject } from "@hedronite/lts-primitives/three";
import type { SceneEnvironment, SceneStage } from "@hedronite/lts-scene";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Object3D } from "three";
import { noteEffectTargets } from "./builds";
import { Controls, GpuCounts, StageFrame, useMotion } from "./scene";
import { StageControls } from "./StageControls";
import { buildSubject } from "./subjects";

function Lights() {
  const rig = useMemo(() => createStudioLights(), []);
  return <primitive object={rig} />;
}

/**
 * The asset's object, built on mount and freed on unmount, and built again when its parameters change (the old one stays on
 * show until the new one is ready, then is freed). Recolored in place when the look changes: a kit's lights and materials too.
 */
function Subject({ meta, palette, params, onObject }: { readonly meta: AssetMeta; readonly palette: ScenePalette; readonly params: Readonly<Record<string, unknown>>; readonly onObject: (object: Object3D) => void }) {
  const invalidate = useThree((state) => state.invalidate);
  const [object, setObject] = useState<Object3D | undefined>(undefined);
  // The look a build starts from is the latest one, and so are the parameters (the build below is keyed by their text).
  const look = useRef(palette);
  const latest = useRef(params);
  useEffect(() => {
    look.current = palette;
    latest.current = params;
  });
  const key = JSON.stringify(params);
  useEffect(() => {
    const controller = new AbortController();
    buildSubject(meta, look.current, controller.signal, latest.current).then(
      (result) => {
        if (result === undefined) return;
        if (controller.signal.aborted) {
          disposeObject(result);
          return;
        }
        setObject(result);
        invalidate();
      },
      (error: unknown) => {
        if (!controller.signal.aborted) console.error(`could not build ${meta.id}`, error);
      },
    );
    return () => {
      controller.abort();
    };
    // `key` stands for `params`: a new object with the same values builds nothing.
  }, [meta, key, invalidate]);
  // An object is freed once the next one has replaced it (or the view closes).
  useEffect(
    () => () => {
      if (object !== undefined) disposeObject(object);
    },
    [object],
  );
  // The stage marks what casts and takes shadows when it is told of a stage, so it is told again of every object that arrives.
  useEffect(() => {
    if (object !== undefined) onObject(object);
  }, [object, onObject]);
  const isKit = meta.kind === "scene";
  useEffect(() => {
    if (object === undefined) return undefined;
    if (!isKit) {
      applyPalette(object, palette);
      invalidate();
      return undefined;
    }
    // A kit recolors its lights as well as its materials. Its builder has loaded this module already.
    let current = true;
    void import("@hedronite/lts-scenes/three").then(({ applyPalette: applyKitPalette }) => {
      if (!current) return;
      applyKitPalette(object, palette);
      invalidate();
    });
    return () => {
      current = false;
    };
  }, [object, isKit, palette, invalidate]);
  // Scene kits are composed upright; single assets get a three-quarter turn.
  return object === undefined ? null : <primitive object={object} rotation={meta.kind === "scene" ? [0.25, 0, 0] : [0.35, 0.6, 0]} />;
}

/** The room and stage quality chosen for one asset. */
interface Chosen {
  readonly id: string;
  readonly environment: SceneEnvironment;
  readonly stage: SceneStage | undefined;
}

const studio: SceneEnvironment = { kind: "studio" };
/** How far the camera starts from the asset, which stands at the origin. */
const DISTANCE = 3.4;

/**
 * An interactive 3D view of a primitive, material, object or kit, built with `params` (every parameter in force), with the controls
 * for the room it stands in and its stage quality under it. Renders only when something changes.
 */
export function Viewport({ meta, palette, params }: { readonly meta: AssetMeta; readonly palette: ScenePalette; readonly params: Readonly<Record<string, unknown>> }) {
  // Renders only on change, so nothing here moves on its own.
  const group = useRef<HTMLDivElement>(null);
  const motion = useMotion(false);
  // Another asset starts on the plain studio, with no stage.
  const [chosen, setChosen] = useState<Chosen | undefined>(undefined);
  if (chosen !== undefined && chosen.id !== meta.id) setChosen(undefined);
  const environment = chosen?.environment ?? studio;
  const stage = chosen?.stage;
  const [arrived, setArrived] = useState<Object3D | undefined>(undefined);
  // A new object, so the stage applies itself again to what has arrived since it last did.
  const staged = useMemo(() => (stage === undefined || arrived === undefined ? stage : { ...stage }), [stage, arrived]);
  const noteTargets = useCallback((ids: readonly string[]) => {
    noteEffectTargets(group.current, ids);
  }, []);
  return (
    <div className="w-full">
      <StageFrame group={group} motion={motion} label={`${meta.name}, rendered in 3D.`} className="h-72 w-full" testId="viewport">
        <WebGPUCanvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 0, DISTANCE], fov: 35 }}>
          <WebGPUEnvironment kind={environment.kind} />
          {meta.kind === "scene" ? null : <Lights />}
          <Controls keys={group} />
          <Subject key={meta.id} meta={meta} palette={palette} params={params} onObject={setArrived} />
          <WebGPUStage stage={staged} palette={palette} />
          {stage !== undefined && hasStagePostfx(stage) ? <ScreenEffectsPass stage={stage} palette={palette} onPipeline={noteTargets} /> : null}
          <GpuCounts target={group} screenEffects />
        </WebGPUCanvas>
      </StageFrame>
      <div className="border-t border-line bg-surface p-4">
        <StageControls
          environment={environment}
          stage={stage}
          palette={palette}
          distance={DISTANCE}
          // A kit's lights are its own, none of them the key light a stage casts from.
          shadows={meta.kind !== "scene"}
          onEnvironment={(next) => {
            setChosen({ id: meta.id, environment: next, stage });
          }}
          onStage={(next) => {
            setChosen({ id: meta.id, environment, stage: next });
          }}
        />
      </div>
    </div>
  );
}
