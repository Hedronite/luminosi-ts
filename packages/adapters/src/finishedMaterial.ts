import type { MaterialId } from "@hedronite/lts-materials";
import type { FinishId } from "@hedronite/lts-materials/finishes/ids";
import type { FinishParams } from "@hedronite/lts-materials/finishes/info";
import type { FinishHandle } from "@hedronite/lts-materials/finished";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { Material } from "three";

interface Built {
  readonly preset: MaterialId;
  readonly finish: FinishId;
  readonly handle: FinishHandle;
  readonly recolor: (handle: FinishHandle, palette: ScenePalette) => void;
}

/**
 * A preset wearing a finish, built when `finish` is set. The finished module loads on demand: nothing downloads until a finish is asked for.
 */
export function useFinishedMaterial(
  preset: MaterialId,
  palette: ScenePalette,
  finish: FinishId | undefined,
  params?: FinishParams<FinishId>,
): Material | undefined {
  const invalidate = useThree((state) => state.invalidate);
  const [built, setBuilt] = useState<Built | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const key = JSON.stringify(params ?? {});
  const latest = useRef({ params, palette });
  useEffect(() => {
    latest.current = { params, palette };
  });
  useEffect(() => {
    if (finish === undefined) return undefined;
    let cancelled = false;
    let made: Built["handle"] | undefined;
    import("@hedronite/lts-materials/finished").then(
      ({ createFinishedMaterial, applyFinishPalette }) => {
        if (cancelled) return;
        made = createFinishedMaterial(preset, finish, latest.current.params ?? {}, latest.current.palette);
        setBuilt({ preset, finish, handle: made, recolor: (handle, look) => { applyFinishPalette(handle, look); } });
        invalidate();
      },
      (error: unknown) => {
        if (!cancelled) console.error(`could not load finish "${finish}"`, error);
      },
    );
    return () => {
      cancelled = true;
      made?.dispose();
    };
  }, [preset, finish, generation, invalidate]);
  const current =
    built !== undefined && built.preset === preset && built.finish === finish ? built : undefined;
  useEffect(() => {
    if (current === undefined) return;
    try {
      if (current.handle.set(latest.current.params ?? {})) invalidate();
      else setGeneration((previous) => previous + 1);
    } catch (error) {
      console.error(`the ${current.finish} finish refused its parameters`, error);
    }
  }, [current, key, invalidate]);
  useEffect(() => {
    if (current === undefined) return;
    current.recolor(current.handle, palette);
    invalidate();
  }, [current, palette, invalidate]);
  return finish === undefined ? undefined : current?.handle.material;
}