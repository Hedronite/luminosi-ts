import { materialPreset } from "@hedronite/lts-materials";
import { createMaterial } from "@hedronite/lts-materials/three";
import { primitive } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";
import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type Material,
} from "three";
import { shadeHex, type ObjectMaterial, type ObjectShape, type ObjectSpec } from "./spec.js";

export interface ObjectFromSpecOptions {
  /** Scene colors for the materials. Default: the neutral token preset. */
  readonly palette?: ScenePalette;
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
 * owns everything: free it with `disposeObject` from `@hedronite/lts-primitives`.
 *
 * Takes a spec that has been through `parseObjectSpec`; throws if a parent is missing.
 */
export function createObjectFromSpec(spec: ObjectSpec, { palette = neutral.scene }: ObjectFromSpecOptions = {}): Group {
  const root = new Group();
  root.name = spec.id;
  const materials = new Map<string, Material>();
  const geometries = new Map<string, BufferGeometry>();
  const nodes = new Map<string, Object3D>();

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
    const mesh = new Mesh(geometry, material);
    mesh.name = part.id;
    mesh.position.set(...part.shapePosition);
    mesh.rotation.set(...part.shapeRotation);
    mesh.scale.set(...part.scale);
    pivot.add(mesh);
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

  return root;
}
