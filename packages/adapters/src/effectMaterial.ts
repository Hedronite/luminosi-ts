import type { EffectId } from "@hedronite/lts-shaders";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
import type { Material } from "three";

interface Built {
  readonly shader: EffectId;
  readonly palette: ScenePalette;
  readonly material: Material;
}

/**
 * The surface shader's material, built when it is needed and freed when it changes or the component
 * unmounts. The shader code loads on demand (a dynamic import), so a page that never asks for one
 * never downloads three's WebGPU build. Undefined until it is ready, and whenever `shader` is
 * undefined.
 */
export function useEffectMaterial(shader: EffectId | undefined, palette: ScenePalette): Material | undefined {
  const invalidate = useThree((state) => state.invalidate);
  const [built, setBuilt] = useState<Built | undefined>(undefined);
  useEffect(() => {
    if (shader === undefined) return undefined;
    let cancelled = false;
    let made: Material | undefined;
    import("@hedronite/lts-shaders/three").then(
      ({ createEffectMaterial }) => {
        if (cancelled) return;
        made = createEffectMaterial(shader, palette);
        setBuilt({ shader, palette, material: made });
        invalidate();
      },
      (error: unknown) => {
        if (!cancelled) console.error(`could not load the ${shader} shader`, error);
      },
    );
    return () => {
      cancelled = true;
      made?.dispose();
    };
  }, [shader, palette, invalidate]);
  // A material built for an earlier shader or palette is never shown for the current one.
  return built !== undefined && built.shader === shader && built.palette === palette ? built.material : undefined;
}
