import { hedronite, neutral, presets } from "@hedronite/lts-tokens";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree } from "@react-three/fiber";
import { BufferGeometry, DirectionalLight, Mesh, type Scene } from "three";
import { describe, expect, it, vi } from "vitest";
import { StudioLights } from "./components.js";

vi.mock("./motion.js", () => ({
  useReducedMotion: () => false,
}));

vi.mock("three/webgpu", () => ({
  ACESFilmicToneMapping: 4,
  AgXToneMapping: 6,
  NeutralToneMapping: 7,
  NoToneMapping: 0,
  WebGPURenderer: { [Symbol.hasInstance]: () => true },
}));

vi.mock("@hedronite/lts-postfx/three", () => ({
  applyToneMapping: (renderer: { toneMapping: number; toneMappingExposure: number }, mode: string, exposure: number) => {
    renderer.toneMapping = mode === "agx" ? 6 : mode === "neutral" ? 7 : mode === "aces" ? 4 : 0;
    renderer.toneMappingExposure = exposure;
  },
  applyPalette: () => undefined,
  stackStructure: () => "[]",
  stackValues: () => ({}),
  ScreenEffects: class {
    readonly targetIds = ["t1"];
    setParams(): void {}
    setStage(): void {}
    setInks(): void {}
    setPointer(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  },
}));

import { WebGPUStage } from "./webgpuStage.js";

interface Captured {
  scene: Scene;
  gl: unknown;
}

function Probe({ onReady }: { readonly onReady: (c: Captured) => void }) {
  const scene = useThree((state) => state.scene);
  const gl: unknown = useThree((state) => state.gl);
  onReady({ scene, gl });
  return null;
}

describe("WebGPUStage", () => {
  it("applies soft shadows, shadow catcher, tone mapping/exposure, lite toggle, and restores baseline on unmount", async () => {
    let captured: Captured | undefined;
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Probe onReady={(c) => { captured = c; }} />
        <StudioLights />
        <mesh name="subject">
          <boxGeometry />
          <meshStandardMaterial />
        </mesh>
        <WebGPUStage
          stage={{
            quality: "full",
            shadows: { enabled: true, catcher: true },
            toneMapping: "agx",
            exposure: 1.4,
          }}
          palette={hedronite.scene}
        />
      </>,
    );

    if (captured === undefined) throw new Error("Probe did not run");
    expect([Reflect.get(Object(captured.gl), "toneMapping"), Reflect.get(Object(captured.gl), "toneMappingExposure")]).toEqual([6, 1.4]);
    expect(Reflect.get(Object(Reflect.get(Object(captured.gl), "shadowMap")), "enabled")).toBe(true);
    const key = captured.scene.getObjectByName("key");
    expect(key instanceof DirectionalLight && key.castShadow).toBe(true);
    const subject = captured.scene.getObjectByName("subject");
    expect(subject instanceof Mesh && subject.castShadow && subject.receiveShadow).toBe(true);
    const catcher = captured.scene.getObjectByName("shadow-catcher");
    expect(catcher).toBeInstanceOf(Mesh);

    let catcherDisposed = false;
    if (catcher instanceof Mesh && catcher.geometry instanceof BufferGeometry) {
      catcher.geometry.addEventListener("dispose", () => {
        catcherDisposed = true;
      });
    }

    const lightPreset = presets.find((p) => p.scene.toneMapping === "neutral") ?? neutral;
    await renderer.update(
      <>
        <Probe onReady={(c) => { captured = c; }} />
        <StudioLights />
        <mesh name="subject">
          <boxGeometry />
          <meshStandardMaterial />
        </mesh>
        <WebGPUStage
          stage={{
            quality: "lite",
            shadows: { enabled: true, catcher: true },
          }}
          palette={lightPreset.scene}
        />
      </>,
    );

    expect(Reflect.get(Object(captured.gl), "toneMapping")).toBe(lightPreset.scene.toneMapping === "neutral" ? 7 : 4);
    expect(Reflect.get(Object(captured.gl), "toneMappingExposure")).toBe(lightPreset.scene.exposure);
    expect(Reflect.get(Object(Reflect.get(Object(captured.gl), "shadowMap")), "enabled")).toBe(false);
    expect(key instanceof DirectionalLight && key.castShadow).toBe(false);
    expect(subject instanceof Mesh && !subject.castShadow && !subject.receiveShadow).toBe(true);
    expect(captured.scene.getObjectByName("shadow-catcher")).toBeUndefined();
    expect(catcherDisposed).toBe(true);

    await renderer.unmount();
  });
});
