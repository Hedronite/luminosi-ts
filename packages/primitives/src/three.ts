import { AmbientLight, BufferAttribute, BufferGeometry, DirectionalLight, Group, Mesh, Texture, type Material, type Object3D } from "three";
import type { Polyhedron } from "./polyhedron.js";
import { triangulate } from "./polyhedron.js";

/** A flat-shaded three.js geometry for a polyhedron. The caller owns it and must dispose it. */
export function createPolyhedronGeometry(polyhedron: Polyhedron, name = "polyhedron"): BufferGeometry {
  const { positions, normals } = triangulate(polyhedron);
  const geometry = new BufferGeometry();
  geometry.name = name;
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export interface StudioLightOptions {
  /** Scales every light. Default 1. */
  readonly intensity?: number;
}

/** A neutral three-point rig (key, fill, rim) plus a little ambient. Add it to a scene; it holds no GPU resources. */
export function createStudioLights({ intensity = 1 }: StudioLightOptions = {}): Group {
  const rig = new Group();
  rig.name = "studio-lights";
  const light = (strength: number, x: number, y: number, z: number, name: string): DirectionalLight => {
    const l = new DirectionalLight(0xffffff, strength * intensity);
    l.position.set(x, y, z);
    l.name = name;
    return l;
  };
  rig.add(light(2.4, 3, 4, 5, "key"), light(0.9, -4, 1.5, 2, "fill"), light(1.6, 0, 3, -5, "rim"));
  const ambient = new AmbientLight(0xffffff, 0.25 * intensity);
  ambient.name = "ambient";
  rig.add(ambient);
  return rig;
}

type AnyMesh = Mesh<BufferGeometry, Material | Material[]>;

const isMesh = (object: Object3D): object is AnyMesh => object instanceof Mesh;

const materialsOf = (mesh: AnyMesh): readonly Material[] => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

/**
 * Frees every geometry and material under `root`, and every texture those materials use.
 * Shared resources are freed once. Detach `root` from its parent first if it should not be rendered again.
 */
export function disposeObject(root: Object3D): void {
  const freed = new Set<{ dispose: () => void }>();
  const free = (resource: { dispose: () => void }): void => {
    if (freed.has(resource)) return;
    freed.add(resource);
    resource.dispose();
  };
  root.traverse((object) => {
    if (!isMesh(object)) return;
    free(object.geometry);
    for (const material of materialsOf(object)) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) free(value);
      }
      free(material);
    }
  });
}
