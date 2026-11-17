import { materialPreset } from "@hedronite/lts-materials";
import { createMaterial } from "@hedronite/lts-materials/three";
import { primitive } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";
import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { shadeHex, type ObjectMaterial, type ObjectShape, type ObjectSpec } from "./spec.js";

export interface ObjectFromSpecOptions {
  /** Scene colors for the materials. Default: the neutral token preset. */
  readonly palette?: ScenePalette;
  /**
   * `"material"` bakes every part's shape into one mesh per material, so the object draws in as many
   * calls as it has materials. Pivots and sockets stay as empty nodes, so they can still be found by
   * name and read for their positions, but a pivot turned afterwards no longer moves its shape.
   * Default: no merge, one mesh per part under its pivot.
   */
  readonly merge?: "material";
}

function createGeometry(shape: ObjectShape): BufferGeometry {
  switch (shape.type) {
    case "primitive":
      return createPolyhedronGeometry(primitive(shape.id), shape.id);
    case "box":
      return new BoxGeometry(...shape.size);
    case "cylinder":
      return new CylinderGeometry(shape.radiusTop, shape.radiusBottom, shape.height, shape.segments);
    case "sphere":
      return new SphereGeometry(shape.radius, shape.widthSegments, shape.heightSegments);
    case "torus":
      return new TorusGeometry(shape.radius, shape.tube, shape.radialSegments, shape.tubularSegments, shape.arc);
    case "lathe":
      return new LatheGeometry(
        shape.points.map(([r, y]) => new Vector2(r, y)),
        shape.segments,
      );
    case "mesh": {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(shape.positions, 3));
      geometry.setIndex(shape.indices);
      geometry.computeVertexNormals();
      return geometry;
    }
  }
}

/** A copy of `source` with its shape baked through `matrix`: unindexed, position and normal only. */
function bake(source: BufferGeometry, matrix: Matrix4): BufferGeometry {
  const geometry = source.index === null ? source.clone() : source.toNonIndexed();
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
  }
  return geometry.applyMatrix4(matrix);
}

function buildMaterial(spec: ObjectMaterial, palette: ScenePalette): Material {
  const slot = materialPreset(spec.preset).color;
  const base = palette[spec.color ?? slot];
  const color = spec.shade === undefined ? base : shadeHex(base, spec.shade);
  const material = createMaterial(spec.preset, { ...palette, [slot]: color });
  if (spec.roughness !== undefined) material.roughness = spec.roughness;
  if (spec.metalness !== undefined) material.metalness = spec.metalness;
  return material;
}

/**
 * Builds a spec into three.js objects: a group named after the spec; per part, a pivot group named
 * by part id (nested under its parent's pivot, carrying `position` and `rotation`) holding one mesh
 * of the same name (carrying the shape's offset, rotation and scale); and an empty `socket:<id>`
 * object per socket.
 *
 * Identical shapes share one geometry, and each spec material is one three.js material. The caller
 * owns everything: free it with `disposeObject` from `@hedronite/lts-primitives/three`.
 *
 * With `merge: "material"` the pivots and sockets are built the same way, but the pivots hold no
 * mesh; one mesh per material, named `material:<name>`, sits under the root with every shape baked
 * into it at the pose the spec gives.
 *
 * Takes a spec that has been through `parseObjectSpec`; throws if a parent is missing.
 */
export function createObjectFromSpec(spec: ObjectSpec, { palette = neutral.scene, merge }: ObjectFromSpecOptions = {}): Group {
  const root = new Group();
  root.name = spec.id;
  const materials = new Map<string, Material>();
  const geometries = new Map<string, BufferGeometry>();
  const nodes = new Map<string, Object3D>();
  const deferred: { readonly part: ObjectSpec["parts"][number]; readonly geometry: BufferGeometry }[] = [];

  const parentOf = (owner: string, parent: string | undefined): Object3D => {
    if (parent === undefined) return root;
    const node = nodes.get(parent);
    if (node === undefined) throw new Error(`"${owner}" names parent "${parent}", which is not a part declared before it`);
    return node;
  };

  for (const part of spec.parts) {
    const definition = spec.materials[part.material];
    if (definition === undefined) throw new Error(`part "${part.id}" uses unknown material "${part.material}"`);
    let material = materials.get(part.material);
    if (material === undefined) {
      material = buildMaterial(definition, palette);
      material.name = part.material;
      materials.set(part.material, material);
    }
    const key = JSON.stringify(part.shape);
    let geometry = geometries.get(key);
    if (geometry === undefined) {
      geometry = createGeometry(part.shape);
      geometries.set(key, geometry);
    }
    const pivot = new Group();
    pivot.name = part.id;
    pivot.position.set(...part.position);
    pivot.rotation.set(...part.rotation);
    if (merge === undefined) {
      const mesh = new Mesh(geometry, material);
      mesh.name = part.id;
      mesh.position.set(...part.shapePosition);
      mesh.rotation.set(...part.shapeRotation);
      mesh.scale.set(...part.scale);
      pivot.add(mesh);
    } else {
      deferred.push({ part, geometry });
    }
    parentOf(part.id, part.parent).add(pivot);
    nodes.set(part.id, pivot);
  }

  for (const socket of spec.sockets) {
    const node = new Object3D();
    node.name = `socket:${socket.id}`;
    node.position.set(...socket.position);
    node.rotation.set(...socket.rotation);
    parentOf(socket.id, socket.parent).add(node);
  }

  if (merge !== undefined) mergeByMaterial(root, deferred, nodes, materials, geometries);
  return root;
}

/** Replaces the deferred per-part shapes with one baked mesh per material, in the order materials first appear. */
function mergeByMaterial(
  root: Group,
  deferred: readonly { readonly part: ObjectSpec["parts"][number]; readonly geometry: BufferGeometry }[],
  nodes: ReadonlyMap<string, Object3D>,
  materials: ReadonlyMap<string, Material>,
  sources: ReadonlyMap<string, BufferGeometry>,
): void {
  root.updateMatrixWorld(true);
  const baked = new Map<string, BufferGeometry[]>();
  const local = new Matrix4();
  for (const { part, geometry } of deferred) {
    const pivot = nodes.get(part.id);
    if (pivot === undefined) throw new Error(`part "${part.id}" has no pivot`);
    local.compose(new Vector3(...part.shapePosition), new Quaternion().setFromEuler(new Euler(...part.shapeRotation)), new Vector3(...part.scale));
    const group = baked.get(part.material) ?? [];
    group.push(bake(geometry, local.premultiply(pivot.matrixWorld)));
    baked.set(part.material, group);
  }
  for (const [name, geometries] of baked) {
    const material = materials.get(name);
    const merged = mergeGeometries(geometries, false);
    if (material === undefined) throw new Error(`material "${name}" was never built`);
    merged.computeBoundingSphere();
    const mesh = new Mesh(merged, material);
    mesh.name = `material:${name}`;
    root.add(mesh);
    for (const geometry of geometries) geometry.dispose();
  }
  // The shared shapes were only sources; the merged meshes own their own copies.
  for (const geometry of sources.values()) geometry.dispose();
}
