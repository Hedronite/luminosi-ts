import type { AssetMeta } from "@hedronite/lts-core";
import { applyPalette } from "@hedronite/lts-materials/three";
import { createStudioLights, disposeObject } from "@hedronite/lts-primitives/three";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Object3D } from "three";
import { Controls, Environment, GpuCounts, StageFrame, useMotion } from "./scene";
import { buildSubject } from "./subjects";

function Lights() {
  const rig = useMemo(() => createStudioLights(), []);
  return <primitive object={rig} />;
}

/**
 * The asset's object, built on mount and freed on unmount, and built again when its parameters change (the old one stays on
 * show until the new one is ready, then is freed). Recolored in place when the look changes: a kit's lights and materials too.
 */
function Subject({ meta, palette, params }: { readonly meta: AssetMeta; readonly palette: ScenePalette; readonly params: Readonly<Record<string, unknown>> }) {
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

/** An interactive 3D view of a primitive, material, object or kit, built with `params` (every parameter in force). Renders only when something changes. */
export function Viewport({ meta, palette, params }: { readonly meta: AssetMeta; readonly palette: ScenePalette; readonly params: Readonly<Record<string, unknown>> }) {
  // Renders only on change, so nothing here moves on its own.
  const group = useRef<HTMLDivElement>(null);
  const motion = useMotion(false);
  return (
    <StageFrame group={group} motion={motion} label={`${meta.name}, rendered in 3D.`} className="h-72 w-full" testId="viewport">
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 0, 3.4], fov: 35 }}>
        <Environment />
        {meta.kind === "scene" ? null : <Lights />}
        <Controls keys={group} />
        <Subject key={meta.id} meta={meta} palette={palette} params={params} />
        <GpuCounts target={group} />
      </Canvas>
    </StageFrame>
  );
}
