import { createStudioLights } from "@hedronite/lts-primitives/three";
import { useEffect, useMemo } from "react";
import { Light } from "three";

/** The library's three-point studio rig, without any material or finish wiring. */
export function StudioLights({ intensity = 1 }: { readonly intensity?: number }) {
  const rig = useMemo(() => createStudioLights({ intensity }), [intensity]);
  useEffect(
    () => () => {
      rig.traverse((child) => {
        if (child instanceof Light) child.dispose();
      });
    },
    [rig],
  );
  return <primitive object={rig} />;
}