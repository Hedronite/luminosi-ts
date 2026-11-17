import { createRegistry, registerManifest } from "@hedronite/lts-core";
import { disposeObject } from "@hedronite/lts-primitives/three";
import { Light, Mesh, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { sceneKit, sceneKitIds } from "./kits.js";
import { manifest } from "./manifest.js";
import { createSceneKit } from "./three.js";

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
