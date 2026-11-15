import { disposeObject } from "@hedronite/lts-primitives";
import { hedronite, neutral } from "@hedronite/lts-tokens";
import fc from "fast-check";
import { Box3, Mesh, MeshPhysicalMaterial, Vector3, type BufferGeometry, type Material, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { createObjectFromSpec } from "./fromSpec.js";
import { parseObjectSpec, safeParseObjectSpec, shadeHex, type ObjectSpec } from "./spec.js";

/** The smallest valid spec, as JSON would deliver it. */
const minimal = (): Record<string, unknown> => ({
  format: "lts-object-spec",
  version: 1,
  id: "your-block",
  name: "Your block",
  materials: { body: { preset: "matte" } },
  parts: [{ id: "body", shape: { type: "box", size: [1, 2, 3] }, material: "body" }],
});

/** `minimal()` with some fields replaced. */
const withFields = (fields: Record<string, unknown>): Record<string, unknown> => ({ ...minimal(), ...fields });

const rejects = (input: unknown): boolean => !safeParseObjectSpec(input).success;

const isMesh = (object: Object3D): object is Mesh => object instanceof Mesh;

const meshes = (root: Object3D): Mesh[] => {
  const found: Mesh[] = [];
  root.traverse((object) => {
    if (isMesh(object)) found.push(object);
  });
  return found;
};

const physical = (mesh: Mesh): MeshPhysicalMaterial => {
  const { material } = mesh;
  if (!(material instanceof MeshPhysicalMaterial)) throw new Error("expected one MeshPhysicalMaterial");
  return material;
};

const named = (root: Object3D, name: string): Object3D => {
  const object = root.getObjectByName(name);
  if (object === undefined) throw new Error(`no object named ${name}`);
  return object;
};

const worldPosition = (object: Object3D): readonly number[] => object.getWorldPosition(new Vector3()).toArray();

describe("parseObjectSpec", () => {
  it("accepts the minimal spec and fills in defaults", () => {
    const spec = parseObjectSpec(minimal());
    expect(spec.sockets).toEqual([]);
    const [part] = spec.parts;
    expect(part?.position).toEqual([0, 0, 0]);
    expect(part?.rotation).toEqual([0, 0, 0]);
    expect(part?.scale).toEqual([1, 1, 1]);
    expect(part?.shapePosition).toEqual([0, 0, 0]);
    expect(part?.shapeRotation).toEqual([0, 0, 0]);
  });

  it("round-trips through JSON unchanged", () => {
    const spec = parseObjectSpec(minimal());
    expect(parseObjectSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
  });

  it("accepts every shape type", () => {
    const shapes = [
      { type: "primitive", id: "platonic-cube" },
      { type: "box", size: [1, 1, 1] },
      { type: "cylinder", radiusTop: 0.5, radiusBottom: 0.5, height: 1 },
      { type: "cylinder", radiusTop: 0, radiusBottom: 0.5, height: 1 },
      { type: "sphere", radius: 1 },
      { type: "torus", radius: 1, tube: 0.1 },
      { type: "lathe", points: [[0.5, 0], [0.4, 1]] },
      { type: "mesh", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
    ];
    for (const shape of shapes) {
      expect(safeParseObjectSpec(withFields({ parts: [{ id: "body", shape, material: "body" }] })).success).toBe(true);
    }
  });

  it("rejects the wrong format or version", () => {
    expect(rejects(withFields({ format: "something-else" }))).toBe(true);
    expect(rejects(withFields({ version: 2 }))).toBe(true);
  });

  it("rejects ids that are not slugs", () => {
    expect(rejects(withFields({ id: "Your Block" }))).toBe(true);
    expect(rejects(withFields({ materials: { Body: { preset: "matte" } }, parts: [{ id: "body", shape: { type: "box", size: [1, 1, 1] }, material: "Body" }] }))).toBe(true);
  });

  it("rejects unknown primitives, material presets and palette colors", () => {
    expect(rejects(withFields({ parts: [{ id: "body", shape: { type: "primitive", id: "teapot" }, material: "body" }] }))).toBe(true);
    expect(rejects(withFields({ materials: { body: { preset: "velvet" } } }))).toBe(true);
    expect(rejects(withFields({ materials: { body: { preset: "matte", color: "#ff0000" } } }))).toBe(true);
  });

  it("rejects non-finite, negative and out-of-range numbers", () => {
    const box = (size: readonly unknown[]): Record<string, unknown> => withFields({ parts: [{ id: "body", shape: { type: "box", size }, material: "body" }] });
    expect(rejects(box([Number.NaN, 1, 1]))).toBe(true);
    expect(rejects(box([Number.POSITIVE_INFINITY, 1, 1]))).toBe(true);
    expect(rejects(box([-1, 1, 1]))).toBe(true);
    expect(rejects(box([0, 1, 1]))).toBe(true);
    expect(rejects(withFields({ materials: { body: { preset: "matte", roughness: 1.5 } } }))).toBe(true);
    expect(rejects(withFields({ materials: { body: { preset: "matte", shade: -0.1 } } }))).toBe(true);
    expect(rejects(withFields({ parts: [{ id: "body", shape: { type: "cylinder", radiusTop: 0, radiusBottom: 0, height: 1 }, material: "body" }] }))).toBe(true);
    expect(rejects(withFields({ parts: [{ id: "body", shape: { type: "sphere", radius: 1, widthSegments: 2.5 }, material: "body" }] }))).toBe(true);
  });

  it("rejects malformed custom meshes", () => {
    const mesh = (positions: readonly number[], indices: readonly number[]): Record<string, unknown> =>
      withFields({ parts: [{ id: "body", shape: { type: "mesh", positions, indices }, material: "body" }] });
    expect(rejects(mesh([0, 0, 0, 1, 0, 0, 0, 1], [0, 1, 2]))).toBe(true);
    expect(rejects(mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1]))).toBe(true);
    expect(rejects(mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 3]))).toBe(true);
  });

  it("rejects lathe profiles with a negative radius", () => {
    expect(rejects(withFields({ parts: [{ id: "body", shape: { type: "lathe", points: [[-0.1, 0], [0.4, 1]] }, material: "body" }] }))).toBe(true);
  });

  it("rejects broken references: duplicate ids, unknown or later parents, unknown or unused materials", () => {
    const box = { type: "box", size: [1, 1, 1] };
    expect(rejects(withFields({ parts: [{ id: "body", shape: box, material: "body" }, { id: "body", shape: box, material: "body" }] }))).toBe(true);
    expect(rejects(withFields({ parts: [{ id: "body", parent: "frame", shape: box, material: "body" }] }))).toBe(true);
    expect(rejects(withFields({ parts: [{ id: "lid", parent: "body", shape: box, material: "body" }, { id: "body", shape: box, material: "body" }] }))).toBe(true);
    expect(rejects(withFields({ parts: [{ id: "body", parent: "body", shape: box, material: "body" }] }))).toBe(true);
    expect(rejects(withFields({ parts: [{ id: "body", shape: box, material: "trim" }] }))).toBe(true);
    expect(rejects(withFields({ materials: { body: { preset: "matte" }, trim: { preset: "metal" } } }))).toBe(true);
    expect(rejects(withFields({ sockets: [{ id: "top", parent: "frame" }] }))).toBe(true);
    expect(rejects(withFields({ sockets: [{ id: "body" }] }))).toBe(true);
  });
});

describe("shadeHex", () => {
  it("keeps the color at 1, reaches black at 0 and white at 2", () => {
    expect(shadeHex("#4080c0", 1)).toBe("#4080c0");
    expect(shadeHex("#4080c0", 0)).toBe("#000000");
    expect(shadeHex("#4080c0", 2)).toBe("#ffffff");
  });

  it("never brightens below 1 and never darkens above 1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffff }), fc.double({ min: 0, max: 2, noNaN: true }), (rgb, shade) => {
        const hex = `#${rgb.toString(16).padStart(6, "0")}`;
        const channels = (h: string): number[] => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
        const before = channels(hex);
        const after = channels(shadeHex(hex, shade));
        const moved = after.map((c, i) => c - (before[i] ?? 0));
        expect(moved.every((d) => (shade <= 1 ? d <= 0 : d >= 0))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe("createObjectFromSpec", () => {
  it("places a box exactly where the spec says", () => {
    const length = fc.double({ min: 0.01, max: 10, noNaN: true });
    const coordinate = fc.double({ min: -10, max: 10, noNaN: true });
    fc.assert(
      fc.property(fc.tuple(length, length, length), fc.tuple(coordinate, coordinate, coordinate), (size, position) => {
        const spec = parseObjectSpec(withFields({ parts: [{ id: "body", shape: { type: "box", size }, material: "body", position }] }));
        const root = createObjectFromSpec(spec);
        const box = new Box3().setFromObject(root);
        size.forEach((s, i) => {
          expect(box.min.getComponent(i)).toBeCloseTo((position[i] ?? 0) - s / 2, 6);
          expect(box.max.getComponent(i)).toBeCloseTo((position[i] ?? 0) + s / 2, 6);
        });
        disposeObject(root);
      }),
      { numRuns: 50 },
    );
  });

  it("builds every shape type into finite, non-empty geometry", () => {
    const spec = parseObjectSpec(
      withFields({
        parts: [
          { id: "a", shape: { type: "primitive", id: "platonic-icosahedron" }, material: "body" },
          { id: "b", shape: { type: "box", size: [1, 1, 1] }, material: "body" },
          { id: "c", shape: { type: "cylinder", radiusTop: 0.2, radiusBottom: 0.5, height: 1, segments: 6 }, material: "body" },
          { id: "d", shape: { type: "sphere", radius: 0.5 }, material: "body" },
          { id: "e", shape: { type: "torus", radius: 1, tube: 0.1, arc: Math.PI } , material: "body" },
          { id: "f", shape: { type: "lathe", points: [[0, 0], [0.5, 0.2], [0.3, 1]] }, material: "body" },
          { id: "g", shape: { type: "mesh", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }, material: "body" },
        ],
      }),
    );
    const root = createObjectFromSpec(spec);
    const built = meshes(root);
    expect(built.map((m) => m.name)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    for (const mesh of built) {
      const positions = mesh.geometry.getAttribute("position");
      expect(positions.count).toBeGreaterThanOrEqual(3);
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      expect(mesh.geometry.getAttribute("normal")).toBeDefined();
    }
    disposeObject(root);
  });

  it("names the root after the spec and nests parts and sockets under their parents", () => {
    const spec = parseObjectSpec(
      withFields({
        parts: [
          { id: "body", shape: { type: "box", size: [1, 1, 1] }, material: "body", position: [1, 0, 0] },
          { id: "lid", parent: "body", shape: { type: "box", size: [1, 0.1, 1] }, material: "body", position: [0, 1, 0] },
        ],
        sockets: [{ id: "handle", parent: "lid", position: [0, 0.5, 0] }, { id: "base" }],
      }),
    );
    const root = createObjectFromSpec(spec);
    root.updateMatrixWorld(true);
    expect(root.name).toBe("your-block");
    const lid = named(root, "lid");
    expect(lid.parent?.name).toBe("body");
    expect(worldPosition(lid)).toEqual([1, 1, 0]);
    const handle = named(root, "socket:handle");
    expect(handle.parent).toBe(lid);
    expect(worldPosition(handle)).toEqual([1, 1.5, 0]);
    expect(named(root, "socket:base").parent).toBe(root);
    disposeObject(root);
  });

  it("applies rotation in radians and scale", () => {
    const spec = parseObjectSpec(withFields({ parts: [{ id: "body", shape: { type: "box", size: [2, 1, 1] }, material: "body", rotation: [0, 0, Math.PI / 2], scale: [1, 3, 1] }] }));
    const root = createObjectFromSpec(spec);
    const box = new Box3().setFromObject(root);
    // Scaled to 2 × 3 × 1, then turned a quarter about z: 3 wide, 2 tall.
    expect(box.max.x - box.min.x).toBeCloseTo(3, 6);
    expect(box.max.y - box.min.y).toBeCloseTo(2, 6);
    disposeObject(root);
  });

  it("keeps a part's shape offset, rotation and scale off its children", () => {
    const spec = parseObjectSpec(
      withFields({
        parts: [
          { id: "body", shape: { type: "box", size: [1, 1, 1] }, material: "body", position: [0, 1, 0], shapePosition: [0, 0.5, 0], shapeRotation: [0, 0, Math.PI / 2], scale: [4, 1, 1] },
          { id: "lid", parent: "body", shape: { type: "box", size: [1, 1, 1] }, material: "body", position: [0, 1, 0] },
        ],
      }),
    );
    const root = createObjectFromSpec(spec);
    root.updateMatrixWorld(true);
    const body = new Box3().setFromObject(meshes(root)[0] ?? root);
    // Scaled to 4 × 1 × 1, turned a quarter about z (1 wide, 4 tall), then lifted 0.5 inside a pivot at y 1.
    expect(body.max.x - body.min.x).toBeCloseTo(1, 6);
    expect(body.max.y - body.min.y).toBeCloseTo(4, 6);
    expect((body.max.y + body.min.y) / 2).toBeCloseTo(1.5, 6);
    // The child follows only the pivot: unit-sized, at y 2.
    const lid = new Box3().setFromObject(meshes(root)[1] ?? root);
    expect(lid.max.x - lid.min.x).toBeCloseTo(1, 6);
    expect((lid.max.y + lid.min.y) / 2).toBeCloseTo(2, 6);
    disposeObject(root);
  });

  it("takes colors from the palette, with the slot, shade and finish the spec asks for", () => {
    const spec = parseObjectSpec(
      withFields({
        materials: {
          body: { preset: "matte" },
          dial: { preset: "satin", color: "base", shade: 0 },
          case: { preset: "metal", roughness: 0.3, metalness: 0.9 },
        },
        parts: [
          { id: "body", shape: { type: "box", size: [1, 1, 1] }, material: "body" },
          { id: "dial", shape: { type: "box", size: [1, 1, 1] }, material: "dial" },
          { id: "case", shape: { type: "box", size: [1, 1, 1] }, material: "case" },
        ],
      }),
    );
    for (const palette of [neutral.scene, hedronite.scene]) {
      const root = createObjectFromSpec(spec, { palette });
      const [body, dial, metal] = meshes(root).map(physical);
      expect(`#${body?.color.getHexString() ?? ""}`).toBe(palette.base);
      expect(dial?.color.getHex()).toBe(0x000000);
      expect(`#${metal?.color.getHexString() ?? ""}`).toBe(palette.metal);
      expect(metal?.roughness).toBe(0.3);
      expect(metal?.metalness).toBe(0.9);
      disposeObject(root);
    }
  });

  it("shares one geometry between identical shapes and one material per spec material", () => {
    const lug = { type: "box", size: [0.1, 0.1, 0.3] };
    const spec = parseObjectSpec(
      withFields({
        parts: [
          { id: "body", shape: { type: "cylinder", radiusTop: 1, radiusBottom: 1, height: 0.3 }, material: "body" },
          { id: "lug-a", shape: lug, material: "body", position: [0.8, 0, 1] },
          { id: "lug-b", shape: lug, material: "body", position: [-0.8, 0, 1] },
        ],
      }),
    );
    const root = createObjectFromSpec(spec);
    const built = meshes(root);
    expect(new Set(built.map((m) => m.geometry)).size).toBe(2);
    expect(new Set(built.map((m) => m.material)).size).toBe(1);
    disposeObject(root);
  });

  it("is fully freed by disposeObject, each resource once", () => {
    const spec = parseObjectSpec(
      withFields({
        materials: { body: { preset: "matte" }, glass: { preset: "glass" } },
        parts: [
          { id: "body", shape: { type: "box", size: [1, 1, 1] }, material: "body" },
          { id: "cover", parent: "body", shape: { type: "sphere", radius: 0.5 }, material: "glass" },
          { id: "twin", shape: { type: "box", size: [1, 1, 1] }, material: "body" },
        ],
      }),
    );
    const root = createObjectFromSpec(spec);
    const resources = new Set<BufferGeometry | Material>();
    for (const mesh of meshes(root)) {
      resources.add(mesh.geometry);
      resources.add(physical(mesh));
    }
    const freed = new Map<BufferGeometry | Material, number>();
    for (const resource of resources) {
      resource.addEventListener("dispose", () => {
        freed.set(resource, (freed.get(resource) ?? 0) + 1);
      });
    }
    disposeObject(root);
    expect(resources.size).toBe(4);
    expect([...freed.values()]).toEqual([1, 1, 1, 1]);
  });

  it("refuses a hand-built spec whose parent is missing", () => {
    const spec: ObjectSpec = {
      ...parseObjectSpec(minimal()),
      parts: [
        {
          id: "lid",
          parent: "body",
          shape: { type: "box", size: [1, 1, 1] },
          material: "body",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          shapePosition: [0, 0, 0],
          shapeRotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    };
    expect(() => createObjectFromSpec(spec)).toThrow(/lid/);
  });
});
