import { applyToneMapping } from "@hedronite/lts-postfx/three";
import type { SceneStage } from "@hedronite/lts-scene";
import { neutral, sceneLighting, type ScenePalette } from "@hedronite/lts-tokens";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { DirectionalLight, Mesh, PCFShadowMap, PlaneGeometry, ShadowMaterial, type ShadowMapType, type ToneMapping as ThreeToneMapping } from "three";
import { findStudioLight } from "@hedronite/lts-primitives/three";
import { WebGPURenderer } from "three/webgpu";

export interface WebGPUStageProps {
  /** Stage quality settings: shadows, shadow catcher, bloom/dof (run in ScreenEffectsPass), tone mapping, exposure, full/lite tier. */
  readonly stage?: SceneStage | undefined;
  /** Look palette supplying default toneMapping and exposure tokens when stage overrides are omitted. */
  readonly palette?: ScenePalette | undefined;
}

/**
 * Configures stage lighting shadows, optional shadow-catcher ground plane, and look-token / override tone mapping and exposure
 * inside `<WebGPUCanvas>`. Respects `quality: "lite"` by cleanly disabling shadows and freeing shadow resources.
 */
const hasShadowMap = (r: object): boolean => {
  const sm: unknown = Reflect.get(r, "shadowMap");
  return typeof sm === "object" && sm !== null;
};

export function WebGPUStage({ stage, palette = neutral.scene }: WebGPUStageProps) {
  const gl: unknown = useThree((state) => state.gl);
  const get = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  if (!(gl instanceof WebGPURenderer)) throw new Error("WebGPUStage runs on the WebGPU renderer: put it inside <WebGPUCanvas>");

  const baseline = useRef<{ toneMapping: ThreeToneMapping; exposure: number; shadowEnabled: boolean; shadowType: ShadowMapType } | undefined>(undefined);

  const full = stage !== undefined && stage.quality !== "lite";
  const shadowsOn = full && stage.shadows?.enabled === true;
  const catcherOn = shadowsOn && stage.shadows?.catcher === true;

  const catcher = useMemo(() => {
    if (!catcherOn) return undefined;
    const geometry = new PlaneGeometry(24, 24);
    geometry.rotateX(-Math.PI / 2);
    const material = new ShadowMaterial({ opacity: 0.35, transparent: true });
    return { geometry, material };
  }, [catcherOn]);

  useEffect(
    () => () => {
      catcher?.geometry.dispose();
      catcher?.material.dispose();
    },
    [catcher],
  );

  useEffect(() => {
    const state = get();
    const renderer = state.gl;
    if (!(renderer instanceof WebGPURenderer)) return;
    baseline.current ??= {
      toneMapping: renderer.toneMapping,
      exposure: renderer.toneMappingExposure,
      shadowEnabled: renderer.shadowMap.enabled,
      shadowType: renderer.shadowMap.type,
    };

    const base = baseline.current;
    if (stage === undefined) {
      renderer.toneMapping = base.toneMapping;
      renderer.toneMappingExposure = base.exposure;
      if (hasShadowMap(renderer)) {
        renderer.shadowMap.enabled = base.shadowEnabled;
        renderer.shadowMap.type = base.shadowType;
      }
    } else {
      const lighting = sceneLighting(palette);
      applyToneMapping(renderer, stage.toneMapping ?? lighting.toneMapping, stage.exposure ?? lighting.exposure);
      if (hasShadowMap(renderer)) {
        renderer.shadowMap.enabled = shadowsOn;
        if (shadowsOn) renderer.shadowMap.type = PCFShadowMap;
      }
    }

    const targetScene = state.scene;
    const key = findStudioLight(targetScene, "key");
    if (key instanceof DirectionalLight) {
      const wasOn = key.castShadow;
      key.castShadow = shadowsOn;
      if (shadowsOn) {
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.near = 0.5;
        key.shadow.camera.far = 25;
        key.shadow.camera.left = -6;
        key.shadow.camera.right = 6;
        key.shadow.camera.top = 6;
        key.shadow.camera.bottom = -6;
        key.shadow.bias = -0.0005;
        key.shadow.normalBias = 0.02;
        key.shadow.radius = 3;
      } else if (wasOn) {
        key.dispose();
      }
    }

    targetScene.traverse((child) => {
      if (child instanceof Mesh && child.name !== "shadow-catcher") {
        child.castShadow = shadowsOn;
        child.receiveShadow = shadowsOn;
      }
    });

    invalidate();
  }, [get, stage, palette, shadowsOn, invalidate]);

  useEffect(
    () => () => {
      const state = get();
      const renderer = state.gl;
      const base = baseline.current;
      if (base !== undefined && renderer instanceof WebGPURenderer) {
        renderer.toneMapping = base.toneMapping;
        renderer.toneMappingExposure = base.exposure;
        if (hasShadowMap(renderer)) {
          renderer.shadowMap.enabled = base.shadowEnabled;
          renderer.shadowMap.type = base.shadowType;
        }
      }
      const key = findStudioLight(state.scene, "key");
      if (key instanceof DirectionalLight) key.dispose();
    },
    [get],
  );

  return catcher === undefined ? null : <mesh name="shadow-catcher" geometry={catcher.geometry} material={catcher.material} position={[0, -1.2, 0]} receiveShadow dispose={null} />;
}
