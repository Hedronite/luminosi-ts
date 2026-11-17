import { AmbientLight, BatchedMesh, BufferAttribute, BufferGeometry, DirectionalLight, Group, InstancedMesh, Line, Mesh, Points, Texture, type Material, type Object3D } from "three";
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

/** Anything that draws a geometry with a material: meshes (instanced and batched too), lines (segments and loops too) and points. */
type Drawable = Mesh<BufferGeometry, Material | Material[]> | Line<BufferGeometry, Material | Material[]> | Points<BufferGeometry, Material | Material[]>;

const isDrawable = (object: Object3D): object is Drawable => object instanceof Mesh || object instanceof Line || object instanceof Points;

const materialsOf = (drawable: Drawable): readonly Material[] => (Array.isArray(drawable.material) ? drawable.material : [drawable.material]);

/**
 * Frees every geometry and material under `root`, and every texture those materials use. That covers
 * meshes, lines and points, and the buffers an `InstancedMesh` or `BatchedMesh` holds for its instances.
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
    if (!isDrawable(object)) return;
    // Instanced and batched meshes own instance buffers; a batched mesh frees its own geometry too.
    const geometry: BufferGeometry = object.geometry;
    if (object instanceof BatchedMesh) free(object);
    else {
      if (object instanceof InstancedMesh) free(object);
      free(geometry);
    }
    for (const material of materialsOf(object)) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) free(value);
      }
      free(material);
    }
  });
}
