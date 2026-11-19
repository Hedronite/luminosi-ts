import { createRegistry, registerManifest } from "@hedronite/lts-core";
import { disposeObject } from "@hedronite/lts-primitives/three";
import { hedronite, neutral } from "@hedronite/lts-tokens";
import { Color, DirectionalLight, HemisphereLight, Light, Mesh, MeshPhysicalMaterial, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { sceneKit, sceneKitIds } from "./kits.js";
import { manifest } from "./manifest.js";
import { applyPalette, createSceneKit } from "./three.js";

const isMesh = (o: Object3D): o is Mesh => o instanceof Mesh;

describe("scene kits", () => {
  it.each(sceneKitIds)("%s fits within radius 1.2 and its shapes do not overlap", (id) => {
    const { placements } = sceneKit(id);
    for (const p of placements) expect(Math.hypot(...p.position) + p.scale).toBeLessThanOrEqual(1.2 + 1e-9);
    placements.forEach((a, i) => {
      placements.slice(i + 1).forEach((b) => {
        const gap = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
        // Shapes are about one unit across, so radius ≈ scale.
        expect(gap).toBeGreaterThan((a.scale + b.scale) * 0.85);
      });
    });
  });

  it.each(sceneKitIds)("%s builds its lights and meshes, and frees every mesh", (id) => {
    const group = createSceneKit(id);
    const kit = sceneKit(id);
    expect(group.children.filter((c) => c instanceof Light)).toHaveLength(kit.lights.length);
    const meshes = group.children.filter(isMesh);
    expect(meshes).toHaveLength(kit.placements.length);
    const freed = vi.fn();
    for (const mesh of meshes) mesh.geometry.addEventListener("dispose", freed);
    disposeObject(group);
    expect(freed).toHaveBeenCalledTimes(meshes.length);
  });

  it("registers one scene asset per kit, prefixed scene-", () => {
    const registry = createRegistry();
    registerManifest(registry, manifest);
    expect(registry.list({ kind: "scene" }).map((a) => a.id)).toEqual(sceneKitIds.map((id) => `scene-${id}`));
  });
});

describe("applyPalette", () => {
  /** Every color a kit shows: each light's colors, each mesh material's colors. */
  const colorsOf = (group: Object3D): string[] => {
    const colors: string[] = [];
    group.traverse((child) => {
      if (child instanceof HemisphereLight) colors.push(child.color.getHexString(), child.groundColor.getHexString());
      else if (child instanceof Light) colors.push(child.color.getHexString());
      else if (child instanceof Mesh && child.material instanceof MeshPhysicalMaterial) colors.push(child.material.color.getHexString(), child.material.emissive.getHexString());
    });
    return colors;
  };

  it.each(sceneKitIds)("%s: recolored from one look to another, it equals a kit made in the second look", (id) => {
    const kit = createSceneKit(id, neutral.scene);
    applyPalette(kit, hedronite.scene);
    expect(colorsOf(kit)).toEqual(colorsOf(createSceneKit(id, hedronite.scene)));
    expect(colorsOf(kit)).not.toEqual(colorsOf(createSceneKit(id, neutral.scene)));
  });

  it.each(sceneKitIds)("%s: recoloring adds and removes nothing", (id) => {
    const kit = createSceneKit(id);
    const parts = kit.children.slice();
    const materials = kit.children.filter((child): child is Mesh => child instanceof Mesh).map((mesh) => mesh.material);
    applyPalette(kit, hedronite.scene);
    expect(kit.children).toEqual(parts);
    expect(kit.children.filter((child): child is Mesh => child instanceof Mesh).map((mesh) => mesh.material)).toEqual(materials);
  });

  it("writes a kit's lights from its data, whatever they were changed to, and leaves a light it did not build alone", () => {
    const kit = createSceneKit("dusk");
    const [warm] = kit.children.filter((child): child is DirectionalLight => child instanceof DirectionalLight);
    expect(warm).toBeDefined();
    warm?.color.set("#123456");
    const stranger = new DirectionalLight(new Color("#654321"), 1);
    kit.add(stranger);
    applyPalette(kit, hedronite.scene);
    expect(warm?.color.getHexString()).toBe("ffb36b");
    expect(stranger.color.getHexString()).toBe("654321");
  });

  it("recolors a kit's hemisphere light's sky and ground", () => {
    const kit = createSceneKit("gallery");
    const light = kit.children.find((child): child is HemisphereLight => child instanceof HemisphereLight);
    light?.color.set("#000000");
    light?.groundColor.set("#000000");
    applyPalette(kit, hedronite.scene);
    expect(light?.color.getHexString()).toBe("ffffff");
    expect(light?.groundColor.getHexString()).toBe("d8d4cc");
  });
});
