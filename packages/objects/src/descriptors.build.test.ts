import { applyPalette } from "@hedronite/lts-materials/three";
import { hedronite, neutral } from "@hedronite/lts-tokens";
import { Mesh, MeshPhysicalMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { descriptors } from "./descriptors.js";
import { showcase } from "./showcase.js";

const find = (id: string) => {
  const descriptor = descriptors.find((candidate) => candidate.meta.id === id);
  if (descriptor === undefined) throw new Error(`no descriptor for ${id}`);
  return descriptor;
};

const meshes = (object: Object3D): number => {
  let count = 0;
  object.traverse((node) => {
    if (node instanceof Mesh) count += 1;
  });
  return count;
};

describe("object descriptors, built", () => {
  // The draw calls the catalog shows each object in, as budgeted in assets/budgets.json.
  const drawCalls: Readonly<Record<string, number>> = { "crystal-cluster": showcase.cluster.count, "framed-solid": 3, "instanced-lattice": 1, "dress-watch": 185, "your-desk-lamp": 8 };

  it("build the catalog's showcase objects by default", async () => {
    const built = await Promise.all(Object.keys(drawCalls).map(async (id) => [id, meshes(await find(id).build({}, hedronite.scene))] as const));
    expect(Object.fromEntries(built)).toEqual(drawCalls);
  });

  it("take their defaults from the showcase settings", () => {
    // The cluster and the lattice also take a material, in satin and metal.
    expect(find("crystal-cluster").defaults).toEqual({ ...showcase.cluster, material: "satin" });
    expect(find("instanced-lattice").defaults).toEqual({ ...showcase.lattice, material: "metal" });
    expect(find("dress-watch").defaults).toEqual(showcase.watch);
    expect(find("framed-solid").defaults).toEqual(showcase.framedSolid);
  });

  it("build with the parameters given", async () => {
    expect(meshes(await find("crystal-cluster").build({ count: 5 }))).toBe(5);
    expect(meshes(await find("framed-solid").build({ solid: "cube", radius: 1 }))).toBe(3);
    const lattice = await find("instanced-lattice").build({ size: 2 });
    expect(lattice).toMatchObject({ count: 8 });
  });

  it("refuse parameters outside the schema", async () => {
    await expect(find("crystal-cluster").build({ count: 0 })).rejects.toThrow(z.ZodError);
    await expect(find("dress-watch").build({ hours: 24 })).rejects.toThrow(z.ZodError);
    await expect(find("framed-solid").build({ solid: "cone" })).rejects.toThrow(z.ZodError);
  });

  it("describe the parameters for a panel", () => {
    expect(find("dress-watch").fields.map(({ key, label, group }) => ({ key, label, group }))).toEqual([
      { key: "hours", label: "Hours", group: "Time" },
      { key: "minutes", label: "Minutes", group: "Time" },
      { key: "seconds", label: "Seconds", group: "Time" },
    ]);
    expect(find("framed-solid").fields.find((field) => field.key === "solid")).toMatchObject({ type: "choice", options: ["tetrahedron", "cube", "octahedron", "dodecahedron", "icosahedron"] });
    expect(find("your-desk-lamp").fields).toEqual([]);
  });

  it("write snippets that follow the parameters", () => {
    expect(find("crystal-cluster").snippets()[0]?.code).toContain(`crystalCluster({ count: ${String(showcase.cluster.count)}, spread: ${String(showcase.cluster.spread)}, seed: ${String(showcase.cluster.seed)} })`);
    expect(find("crystal-cluster").snippets({ count: 5 })[0]?.code).toContain("count: 5,");
    expect(find("instanced-lattice").snippets({ size: 4 })[0]?.code).toContain("// 64 octahedra, one draw call.");
    expect(find("your-desk-lamp").snippets()[0]?.code).toContain('objectSpecById("your-desk-lamp")');
  });
});

/** The color of every material under an object, in traversal order, as hex digits. */
const colorsUnder = (object: Object3D): string[] => {
  const found: string[] = [];
  object.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    for (const material of [node.material].flat()) if (material instanceof MeshPhysicalMaterial) found.push(material.color.getHexString());
  });
  return found;
};

describe("object descriptors, recolored", () => {
  it.each(["dress-watch", "your-desk-lamp", "framed-solid", "crystal-cluster", "instanced-lattice"])("%s: recolored to another look, it has the colors of one built in that look", async (id) => {
    const object = await find(id).build({}, neutral.scene);
    applyPalette(object, hedronite.scene);
    expect(colorsUnder(object)).toEqual(colorsUnder(await find(id).build({}, hedronite.scene)));
  });
});
