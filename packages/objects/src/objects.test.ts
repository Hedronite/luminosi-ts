import { Document, WebIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { disposeObject } from "@hedronite/lts-primitives";
import fc from "fast-check";
import { MeshoptEncoder } from "meshoptimizer";
import { InstancedMesh, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { crystalCluster, latticePoints } from "./cluster.js";
import { createCrystalCluster, createLattice, loadGltf } from "./three.js";

describe("crystalCluster", () => {
  it("is the same for the same seed and differs for another", () => {
    expect(crystalCluster({ seed: 3 })).toEqual(crystalCluster({ seed: 3 }));
    expect(crystalCluster({ seed: 3 })).not.toEqual(crystalCluster({ seed: 4 }));
  });

  it("keeps every crystal upright within 50°, rooted on the floor, and inside a unit sphere", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.integer(), (count, spread, seed) => {
        const crystals = crystalCluster({ count, spread, seed });
        expect(crystals).toHaveLength(count);
        for (const c of crystals) {
          expect(Math.hypot(...c.axis)).toBeCloseTo(1, 9);
          expect(c.axis[1]).toBeGreaterThanOrEqual(Math.cos((50 * Math.PI) / 180) - 1e-9);
          const base = c.position.map((p, i) => p - ((c.axis[i] ?? 0) * c.height) / 2);
          expect(base[1]).toBeCloseTo(-0.6, 9);
          const tip = c.position.map((p, i) => p + ((c.axis[i] ?? 0) * c.height) / 2);
          expect(Math.hypot(...tip)).toBeLessThan(1);
          expect([5, 6, 8]).toContain(c.sides);
        }
      }),
      { numRuns: 50 },
    );
  });

  it("rejects counts and spreads out of range", () => {
    expect(() => crystalCluster({ count: 0 })).toThrow(RangeError);
    expect(() => crystalCluster({ spread: 2 })).toThrow(RangeError);
  });
});

describe("latticePoints", () => {
  it("has size³ points centred on the origin", () => {
    const points = latticePoints({ size: 4, spacing: 0.5 });
    expect(points).toHaveLength(64);
    const centre = [0, 1, 2].map((axis) => points.reduce((sum, p) => sum + (p[axis] ?? 0), 0) / points.length);
    for (const c of centre) expect(c).toBeCloseTo(0, 9);
  });
});

describe("createCrystalCluster", () => {
  it("makes one mesh per crystal, sharing one geometry per side count", () => {
    const crystals = crystalCluster({ count: 20, seed: 9 });
    const group = createCrystalCluster(crystals, new MeshStandardMaterial());
    const meshes = group.children.filter((c): c is Mesh => c instanceof Mesh);
    expect(meshes).toHaveLength(20);
    expect(new Set(meshes.map((m) => m.geometry)).size).toBe(new Set(crystals.map((c) => c.sides)).size);
    disposeObject(group);
  });
});

describe("createLattice", () => {
  it("draws every point with one instanced mesh", () => {
    const mesh = createLattice(latticePoints({ size: 6 }), new MeshStandardMaterial());
    expect(mesh).toBeInstanceOf(InstancedMesh);
    expect(mesh.count).toBe(216);
    disposeObject(mesh);
  });
});

describe("loadGltf", () => {
  async function triangleGlb(compress: boolean): Promise<ArrayBuffer> {
    const document = new Document();
    const buffer = document.createBuffer();
    const position = document.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
    const mesh = document.createMesh("triangle").addPrimitive(document.createPrimitive().setAttribute("POSITION", position));
    document.createScene().addChild(document.createNode("triangle").setMesh(mesh));
    if (compress) {
      await MeshoptEncoder.ready;
      document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    }
    const io = new WebIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
    const bytes = await io.writeBinary(document);
    return bytes.slice().buffer;
  }

  it.each([false, true])("loads a glTF binary (meshopt-compressed: %s) into a scene", async (compress) => {
    const scene = await loadGltf(await triangleGlb(compress));
    const meshes: Mesh[] = [];
    const isMesh = (o: Object3D): o is Mesh => o instanceof Mesh;
    scene.traverse((o) => {
      if (isMesh(o)) meshes.push(o);
    });
    expect(meshes).toHaveLength(1);
    expect(meshes[0]?.geometry.getAttribute("position").count).toBe(3);
  });

  it("stops when aborted", async () => {
    const glb = await triangleGlb(false);
    await expect(loadGltf(glb, { signal: AbortSignal.abort(new Error("gone")) })).rejects.toThrow("gone");
  });
});
