import { ACESFilmicToneMapping, DataTexture, Scene, Texture } from "three";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The WebGPU studio environment, and what it must keep: the same room the root environment used to bake (see
// `studioRoom.ts`), a blur of 0.04, three's own intensity of 1 and React Three Fiber's ACES filmic tone mapping.
interface Bake {
  readonly from: string;
  readonly room: unknown;
  readonly sigma: number;
  readonly generatorDisposed: () => boolean;
  readonly targetDisposed: () => boolean;
  readonly texture: Texture;
}
const { bakes, recorder } = vi.hoisted(() => {
  const bakes: Bake[] = [];
  const recorder = (from: string) =>
  class {
    private gone = false;
    fromScene(room: unknown, sigma: number) {
      const texture = new Texture();
      let targetGone = false;
      bakes.push({ from, room, sigma, generatorDisposed: () => this.gone, targetDisposed: () => targetGone, texture });
      return {
        texture,
        dispose: () => {
          targetGone = true;
        },
      };
    }
    fromEquirectangular() {
      const texture = new Texture();
      let targetGone = false;
      bakes.push({ from, room: "hdri", sigma: 0, generatorDisposed: () => this.gone, targetDisposed: () => targetGone, texture });
      return {
        texture,
        dispose: () => {
          targetGone = true;
        },
      };
    }
    dispose() {
      this.gone = true;
    }
  };
  return { bakes, recorder };
});
vi.mock("three", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), PMREMGenerator: recorder("webgl") }));
vi.mock("three/webgpu", () => ({
  PMREMGenerator: recorder("webgpu"),
  // Every renderer is "the WebGPU renderer" here: the check it makes is the one under test elsewhere, in entry.test.ts and the lane.
  WebGPURenderer: { [Symbol.hasInstance]: () => true },
}));

const { WebGPUEnvironment, WebGPUStudioEnvironment } = await import("./webgpuEnvironment.js");
const { bakeEnvironmentTarget, STUDIO_BLUR } = await import("./studioRoom.js");
/** The look the root environment has always had, and what the WebGPU one must keep: React Three Fiber's ACES filmic, and three's own intensity of 1. */
const studioRoom = { blur: 0.04, intensity: 1, toneMapping: ACESFilmicToneMapping } as const;

beforeEach(() => {
  bakes.length = 0;
});

/** The scene and the tone mapping the renderer ended up with, as React Three Fiber configured it, read from inside the canvas. */
const mounted = async (element: React.ReactElement) => {
  let toneMapping: number | undefined;
  let scene: Scene | undefined;
  const Probe = () => {
    toneMapping = useThree((state) => state.gl.toneMapping);
    scene = useThree((state) => state.scene);
    return null;
  };
  const renderer = await ReactThreeTestRenderer.create(
    <>
      {element}
      <Probe />
    </>,
  );
  return { renderer, tone: () => toneMapping, scene: () => scene };
};

describe("the WebGPU studio environment", () => {
  it("pin the room's values: a blur of 0.04, three's own intensity of 1, and ACES filmic tone mapping", () => {
    expect(STUDIO_BLUR).toBe(studioRoom.blur);
    expect(new Scene().environmentIntensity).toBe(studioRoom.intensity);
  });

  it("bakes the room with that blur through the WebGPU renderer's generator, and frees the generator at once", async () => {
    const webgpu = await mounted(<WebGPUStudioEnvironment />);
    for (const bake of bakes) {
      expect(bake.room).toBeInstanceOf(RoomEnvironment);
      expect(bake.sigma).toBe(studioRoom.blur);
      expect(bake.generatorDisposed()).toBe(true);
    }
    expect(webgpu.scene()?.environment).toBe(bakes[0]?.texture);
    await webgpu.renderer.unmount();
    for (const bake of bakes) expect(bake.targetDisposed()).toBe(true);
  });

  it("leaves the scene's intensity alone, so the scene lights at three's default, and the renderer gets React Three Fiber's ACES filmic", async () => {
    const webgpu = await mounted(<WebGPUStudioEnvironment />);
    expect(webgpu.scene()?.environmentIntensity).toBe(studioRoom.intensity);
    expect(webgpu.tone()).toBe(studioRoom.toneMapping);
    await webgpu.renderer.unmount();
  });
});

const roomName = (room: unknown): unknown => (typeof room === "object" && room !== null ? Reflect.get(room, "name") : undefined);

describe("WebGPUEnvironment", () => {
  it("switches across procedural rooms cleanly and disposes replaced PMREM targets, while applying intensity and rotation", async () => {
    const webgpu = await mounted(<WebGPUEnvironment kind="gallery" intensity={1.7} rotation={0.5} />);
    expect(bakes).toHaveLength(1);
    expect(roomName(bakes[0]?.room)).toBe("room-gallery");
    expect(webgpu.scene()?.environment).toBe(bakes[0]?.texture);
    expect(webgpu.scene()?.environmentIntensity).toBe(1.7);
    expect(webgpu.scene()?.environmentRotation.y).toBeCloseTo(0.5);

    await webgpu.renderer.update(
      <>
        <WebGPUEnvironment kind="dusk" intensity={0.9} rotation={1.1} />
      </>,
    );
    expect(bakes).toHaveLength(2);
    expect(bakes[0]?.targetDisposed()).toBe(true);
    expect(roomName(bakes[1]?.room)).toBe("room-dusk");
    expect(webgpu.scene()?.environment).toBe(bakes[1]?.texture);
    expect(webgpu.scene()?.environmentIntensity).toBe(0.9);
    expect(webgpu.scene()?.environmentRotation.y).toBeCloseTo(1.1);

    await webgpu.renderer.unmount();
    expect(bakes[1]?.targetDisposed()).toBe(true);
  });

  it("loads a CC0 HDRI via injected loader without network and falls back cleanly on error", async () => {
    let resolved: ((tex: Texture) => void) | undefined;
    const loader = () =>
      new Promise<Texture>((resolve) => {
        resolved = resolve;
      });
    const webgpu = await mounted(
      <WebGPUEnvironment kind="noir" hdri={{ url: "https://example.com/noir.hdr", license: "CC0-1.0", credit: "Poly Haven" }} hdriLoader={loader} />,
    );
    expect(bakes[0]?.targetDisposed()).toBe(false);
    resolved?.(new DataTexture(new Uint8Array(16), 2, 2));
    await new Promise((r) => setTimeout(r, 20));
    expect(bakes).toHaveLength(2);
    expect(bakes[1]?.room).toBe("hdri");
    expect(webgpu.scene()?.environment).toBe(bakes[1]?.texture);
    await webgpu.renderer.unmount();
    expect(bakes.every((b) => b.targetDisposed())).toBe(true);

    bakes.length = 0;
    const offline = await mounted(
      <WebGPUEnvironment kind="gallery" hdri={{ url: "https://offline.invalid/a.hdr", license: "CC0-1.0", credit: "Offline" }} hdriLoader={() => Promise.reject(new Error("offline"))} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(roomName(bakes[0]?.room)).toBe("room-gallery");
    expect(bakes[0]?.targetDisposed()).toBe(false);
    expect(offline.scene()?.environment).toBe(bakes[0]?.texture);
    await offline.renderer.unmount();
    expect(bakes.every((b) => b.targetDisposed())).toBe(true);
  });
});

describe("WebGPUEnvironment when its HDRI goes away", () => {
  const hdri = { url: "https://example.com/noir.hdr", license: "CC0-1.0", credit: "Nobody" } as const;
  const equirect = (): DataTexture => new DataTexture(new Uint8Array(16), 2, 2);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("frees the HDRI's target when hdri is taken away, not only at unmount", async () => {
    const loader = () => Promise.resolve(equirect());
    const webgpu = await mounted(<WebGPUEnvironment kind="noir" hdri={hdri} hdriLoader={loader} />);
    await settle();
    const [procedural, loaded] = bakes;
    expect(loaded?.room).toBe("hdri");
    expect(webgpu.scene()?.environment).toBe(loaded?.texture);

    await webgpu.renderer.update(
      <>
        <WebGPUEnvironment kind="noir" hdriLoader={loader} />
      </>,
    );
    await settle();
    expect(webgpu.scene()?.environment).toBe(procedural?.texture);
    expect(loaded?.targetDisposed()).toBe(true);
    expect(procedural?.targetDisposed()).toBe(false);

    await webgpu.renderer.unmount();
    expect(bakes.every((b) => b.targetDisposed())).toBe(true);
  });

  it("frees an aborted load's texture and generator once each", async () => {
    const controller = new AbortController();
    const counts = { generator: 0, texture: 0 };
    const texture = equirect();
    texture.addEventListener("dispose", () => {
      counts.texture += 1;
    });
    const unwanted = () => ({ texture: new Texture(), dispose: () => undefined });
    const loading = bakeEnvironmentTarget(
      {
        fromScene: unwanted,
        fromEquirectangular: unwanted,
        dispose: () => {
          counts.generator += 1;
        },
      },
      { kind: "noir", hdri },
      {
        signal: controller.signal,
        hdriLoader: async () => {
          controller.abort();
          return Promise.resolve(texture);
        },
      },
    );
    await expect(loading).rejects.toThrow("aborted");
    expect(counts).toEqual({ generator: 1, texture: 1 });
  });

  it("does not re-fetch or re-bake when rerendered with equal inline hdri and loader (F2)", async () => {
    let calls = 0;
    const webgpu = await mounted(
      <WebGPUEnvironment
        kind="noir"
        hdri={{ url: hdri.url, license: "CC0-1.0", credit: hdri.credit }}
        hdriLoader={() => {
          calls += 1;
          return Promise.resolve(equirect());
        }}
      />,
    );
    await settle();
    expect(calls).toBe(1);
    const loadedTarget = bakes[1]?.texture;
    expect(webgpu.scene()?.environment).toBe(loadedTarget);

    // Rerender with fresh inline object and function instances that keep the same hdriKey.
    await webgpu.renderer.update(
      <WebGPUEnvironment
        kind="noir"
        hdri={{ url: hdri.url, license: "CC0-1.0", credit: hdri.credit }}
        hdriLoader={() => {
          calls += 1;
          return Promise.resolve(equirect());
        }}
      />,
    );
    await settle();
    expect(calls).toBe(1);
    expect(bakes).toHaveLength(2);
    expect(webgpu.scene()?.environment).toBe(loadedTarget);
    await webgpu.renderer.unmount();
    expect(bakes.every((b) => b.targetDisposed())).toBe(true);
  });
});
