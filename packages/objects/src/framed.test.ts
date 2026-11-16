import { archimedean, disposeObject, edges, platonic } from "@hedronite/lts-primitives";
import { InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createFramedSolid } from "./framed.js";

const glass = new MeshStandardMaterial({ name: "glass" });
const metal = new MeshStandardMaterial({ name: "metal" });

describe("createFramedSolid", () => {
  it("draws faces, one tube per edge and one bead per vertex, in three draw calls", () => {
    const solid = archimedean("truncated-icosahedron");
    const group = createFramedSolid(solid, { faces: glass, edges: metal });
    const [faces, tubes, beads] = group.children;
    expect(faces).toBeInstanceOf(Mesh);
    expect(tubes).toBeInstanceOf(InstancedMesh);
    expect(beads).toBeInstanceOf(InstancedMesh);
    if (!(tubes instanceof InstancedMesh) || !(beads instanceof InstancedMesh)) throw new Error("expected instanced edges and beads");
    expect(tubes.count).toBe(edges(solid).length);
    expect(beads.count).toBe(solid.vertices.length);
    expect(tubes.material).toBe(metal);
    expect(beads.material).toBe(glass);
    disposeObject(group);
  });

  it("lays each tube along its edge, as long as the edge", () => {
    const cube = platonic("cube");
    const group = createFramedSolid(cube, { faces: glass, edges: metal, vertexRadius: 0 });
    const tubes = group.getObjectByName("edges");
    if (!(tubes instanceof InstancedMesh)) throw new Error("expected instanced edges");
    const [i = 0, j = 0] = edges(cube)[0] ?? [];
    const a = new Vector3(...(cube.vertices[i] ?? [0, 0, 0]));
    const b = new Vector3(...(cube.vertices[j] ?? [0, 0, 0]));
    const m = new Matrix4();
    tubes.getMatrixAt(0, m);
    const p = new Vector3(0, -0.5, 0).applyMatrix4(m);
    const q = new Vector3(0, 0.5, 0).applyMatrix4(m);
    // Instance matrices are stored as 32-bit floats.
    const near = (x: Vector3, y: Vector3): boolean => x.distanceTo(y) < 1e-5;
    const matches = (near(p, a) && near(q, b)) || (near(p, b) && near(q, a));
    expect(matches).toBe(true);
    expect(group.getObjectByName("vertices")).toBeUndefined();
  });

  it("takes a separate bead material and refuses negative sizes", () => {
    const bead = new MeshStandardMaterial({ name: "bead" });
    const group = createFramedSolid(platonic("tetrahedron"), { faces: glass, edges: metal, vertices: bead });
    const beads = group.getObjectByName("vertices");
    expect(beads instanceof InstancedMesh ? beads.material : undefined).toBe(bead);
    expect(() => createFramedSolid(platonic("cube"), { faces: glass, edges: metal, edgeRadius: -1 })).toThrow(RangeError);
  });
});
