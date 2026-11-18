import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Mesh, type Object3D } from "three";
import { Color, Node } from "three/webgpu";
import { hedronite, neutral } from "@hedronite/lts-tokens";
import { describe, expect, it, vi } from "vitest";
import { PrimitiveMesh } from "./components.js";
import { EffectClockProvider } from "./effectClock.js";

const isMesh = (o: Object3D): o is Mesh => o instanceof Mesh;

const meshes = (root: Object3D): Mesh[] => {
  const found: Object3D[] = [];
  root.traverse((o) => {
    found.push(o);
  });
  return found.filter(isMesh);
};

const nodesUnder = (root: unknown): Node[] => {
  const found: Node[] = [];
  if (root instanceof Node) {
    root.traverse((node) => {
      found.push(node);
    });
  }
  return found;
};

/** The one material the scene draws with, once the shader has loaded. */
const drawnMaterial = async (root: Object3D) => {
  await vi.waitFor(
    () => {
      expect(meshes(root)).toHaveLength(1);
    },
    { timeout: 5000 },
  );
  const material = meshes(root)[0]?.material;
  if (material === undefined || Array.isArray(material)) throw new Error("expected one material");
  return material;
};

const holds = (material: object, wanted: number): boolean =>
  "emissiveNode" in material && nodesUnder(material.emissiveNode).some((node) => "isUniformNode" in node && "value" in node && node.value === wanted);

describe("PrimitiveMesh with a surface shader", () => {
  it("draws nothing until the shader has loaded, then draws with it, and frees it on unmount", async () => {
    const renderer = await ReactThreeTestRenderer.create(<PrimitiveMesh primitive="platonic-cube" shader="hologram" />);
    expect(meshes(renderer.scene.instance)).toHaveLength(0);
    // The import resolves on its own and React commits the result; there is nothing to await but the scene.
    await vi.waitFor(
      () => {
        expect(meshes(renderer.scene.instance)).toHaveLength(1);
      },
      { timeout: 5000 },
    );
    const material = meshes(renderer.scene.instance)[0]?.material;
    if (material === undefined || Array.isArray(material)) throw new Error("expected one material");
    expect(material.name).toBe("hologram");
    const freed = vi.fn();
    material.addEventListener("dispose", freed);
    await renderer.unmount();
    expect(freed).toHaveBeenCalled();
  });

  it("draws a preset at once when it has no shader", async () => {
    const renderer = await ReactThreeTestRenderer.create(<PrimitiveMesh primitive="platonic-cube" material="glass" />);
    expect(meshes(renderer.scene.instance)).toHaveLength(1);
    await renderer.unmount();
  });

  it("moves a parameter in place: the same material, its uniform written, nothing freed", async () => {
    const renderer = await ReactThreeTestRenderer.create(<PrimitiveMesh primitive="platonic-cube" shader="fresnel-glow" shaderParams={{ power: 3 }} />);
    const material = await drawnMaterial(renderer.scene.instance);
    expect(holds(material, 3)).toBe(true);
    const freed = vi.fn();
    material.addEventListener("dispose", freed);
    const version = material.version;
    await renderer.update(<PrimitiveMesh primitive="platonic-cube" shader="fresnel-glow" shaderParams={{ power: 6 }} />);
    expect(await drawnMaterial(renderer.scene.instance)).toBe(material);
    expect(holds(material, 6)).toBe(true);
    expect(holds(material, 3)).toBe(false);
    expect(freed).not.toHaveBeenCalled();
    expect(material.version).toBe(version);
    await renderer.unmount();
  });

  it("builds the shader again, and frees the old one, when a structural parameter changes", async () => {
    const renderer = await ReactThreeTestRenderer.create(<PrimitiveMesh primitive="platonic-cube" shader="toon" shaderParams={{ bands: 3 }} />);
    const material = await drawnMaterial(renderer.scene.instance);
    const freed = vi.fn();
    material.addEventListener("dispose", freed);
    await renderer.update(<PrimitiveMesh primitive="platonic-cube" shader="toon" shaderParams={{ bands: 4 }} />);
    await vi.waitFor(() => {
      expect(freed).toHaveBeenCalledOnce();
    });
    const next = await drawnMaterial(renderer.scene.instance);
    expect(next).not.toBe(material);
    expect(next.name).toBe("toon");
    await renderer.unmount();
  });

  it("reads time from the clock a provider gives it", async () => {
    // Imported here, not at the top: the first test in this file needs the shader code not yet loaded.
    const { createEffectClock } = await import("@hedronite/lts-shaders/three");
    const clock = createEffectClock(1);
    const renderer = await ReactThreeTestRenderer.create(
      <EffectClockProvider clock={clock}>
        <PrimitiveMesh primitive="platonic-cube" shader="pulse" />
      </EffectClockProvider>,
    );
    const material = await drawnMaterial(renderer.scene.instance);
    expect("emissiveNode" in material && nodesUnder(material.emissiveNode).includes(clock)).toBe(true);
    await renderer.unmount();
  });

  it("follows a change of look in place: the same material, its color uniform written, nothing freed or rebuilt", async () => {
    const colored = (material: object, hex: string): boolean =>
      "colorNode" in material && nodesUnder(material.colorNode).some((node) => "isUniformNode" in node && "value" in node && node.value instanceof Color && node.value.getHexString() === new Color(hex).getHexString());
    const renderer = await ReactThreeTestRenderer.create(<PrimitiveMesh primitive="platonic-cube" shader="fresnel-glow" palette={neutral.scene} />);
    const material = await drawnMaterial(renderer.scene.instance);
    expect(colored(material, neutral.scene.base)).toBe(true);
    const freed = vi.fn();
    material.addEventListener("dispose", freed);
    const version = material.version;
    await renderer.update(<PrimitiveMesh primitive="platonic-cube" shader="fresnel-glow" palette={hedronite.scene} />);
    await vi.waitFor(() => {
      expect(colored(material, hedronite.scene.base)).toBe(true);
    });
    expect(await drawnMaterial(renderer.scene.instance)).toBe(material);
    expect(freed).not.toHaveBeenCalled();
    expect(material.version).toBe(version);
    await renderer.unmount();
  });
});
