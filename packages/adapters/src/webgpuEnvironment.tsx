import type { EnvironmentKind, SceneEnvironmentHdri } from "@hedronite/lts-scene";
import { bakeEnvironmentTarget, bakeRoom, type HdriLoader, type RoomTarget } from "./studioRoom.js";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { PMREMGenerator, WebGPURenderer } from "three/webgpu";

export interface WebGPUEnvironmentProps {
  /** Procedural room mood. Default: `"studio"`. */
  readonly kind?: EnvironmentKind;
  /** Scene environment IBL intensity multiplier. Default: leaves Three's default `1`. */
  readonly intensity?: number;
  /** Y-axis environment map rotation in radians. */
  readonly rotation?: number;
  /** Optional credited CC0 HDRI source; falls back gracefully to the procedural room on failure. */
  readonly hdri?: SceneEnvironmentHdri;
  /** Optional loader override for offline or synthetic HDRI testing. */
  readonly hdriLoader?: HdriLoader;
}

/**
 * Procedural WebGPU/PMREM environment room with optional credited CC0 HDRI loading and graceful procedural fallback.
 * Must be mounted inside `<WebGPUCanvas>`. Frees PMREM targets on room switch and unmount.
 */
export function WebGPUEnvironment({ kind = "studio", intensity, rotation, hdri, hdriLoader }: WebGPUEnvironmentProps) {
  const gl: unknown = useThree((state) => state.gl);
  const get = useThree((state) => state.get);
  if (!(gl instanceof WebGPURenderer)) throw new Error("WebGPUEnvironment runs on the WebGPU renderer: put it inside <WebGPUCanvas>");

  const proceduralTarget = useMemo(() => bakeRoom(new PMREMGenerator(gl), kind), [gl, kind]);
  const hdriKey = hdri === undefined ? "" : `${kind}|${hdri.url}|${hdri.credit}`;
  const [hdriState, setHdriState] = useState<{ readonly key: string; readonly target: RoomTarget } | undefined>(undefined);

  useEffect(
    () => () => {
      proceduralTarget.dispose();
    },
    [proceduralTarget],
  );

  useEffect(
    () => () => {
      hdriState?.target.dispose();
    },
    [hdriState],
  );

  useEffect(() => {
    if (hdri === undefined) return undefined;
    const controller = new AbortController();
    let active = true;
    void bakeEnvironmentTarget(
      new PMREMGenerator(gl),
      { kind, hdri },
      { signal: controller.signal, ...(hdriLoader === undefined ? {} : { hdriLoader }) },
    ).then(
      (result) => {
        if (!active || controller.signal.aborted) {
          result.target.dispose();
          return;
        }
        if (result.source === "hdri") setHdriState({ key: hdriKey, target: result.target });
        else {
          result.target.dispose();
          setHdriState(undefined);
        }
      },
      () => {
        if (active) setHdriState(undefined);
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [gl, kind, hdri, hdriKey, hdriLoader]);

  useEffect(() => {
    const targetScene = get().scene;
    if (intensity !== undefined) targetScene.environmentIntensity = intensity;
    if (rotation !== undefined) targetScene.environmentRotation.set(0, rotation, 0);
    return () => {
      if (intensity !== undefined) targetScene.environmentIntensity = 1;
      if (rotation !== undefined) targetScene.environmentRotation.set(0, 0, 0);
    };
  }, [get, intensity, rotation]);

  const activeTarget = hdriState?.key === hdriKey ? hdriState.target : proceduralTarget;
  return <primitive object={activeTarget.texture} attach="environment" />;
}

/**
 * A procedural studio room as the scene's environment, prefiltered by the WebGPU renderer's own
 * generator. Use it inside `WebGPUCanvas`. Preserves legacy `<WebGPUStudioEnvironment />` callers.
 */
export function WebGPUStudioEnvironment() {
  return <WebGPUEnvironment kind="studio" />;
}
