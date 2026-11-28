import { neutral, sceneLighting, type ScenePalette } from "@hedronite/lts-tokens";
import { AmbientLight, BatchedMesh, BufferAttribute, BufferGeometry, DirectionalLight, Group, InstancedMesh, Light, Line, Mesh, Points, Texture, type Material, type Object3D } from "three";
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

export type StudioLightRole = "key" | "fill" | "rim" | "ambient";

const studioLightRoles = new WeakMap<Object3D, StudioLightRole>();

export interface StudioLightOptions {
  /** Scales every light. Default 1. */
  readonly intensity?: number;
  /** Scene lighting tokens for key, fill, rim, and ambient lights. Default: neutral. */
  readonly palette?: ScenePalette;
}

/** A three-point rig (key, fill, rim) plus ambient, colored from `palette`. Add it to a scene; it holds no GPU resources. */
export function createStudioLights({ intensity = 1, palette = neutral.scene }: StudioLightOptions = {}): Group {
  const lighting = sceneLighting(palette);
  const rig = new Group();
  rig.name = "studio-lights";
  const light = (strength: number, x: number, y: number, z: number, role: Exclude<StudioLightRole, "ambient">): DirectionalLight => {
    const l = new DirectionalLight(lighting[role], strength * intensity);
    l.position.set(x, y, z);
    l.name = role;
    studioLightRoles.set(l, role);
    return l;
  };
  rig.add(light(2.4, 3, 4, 5, "key"), light(0.9, -4, 1.5, 2, "fill"), light(1.6, 0, 3, -5, "rim"));
  const ambient = new AmbientLight(lighting.ambient, 0.25 * intensity);
  ambient.name = "ambient";
  studioLightRoles.set(ambient, "ambient");
  rig.add(ambient);
  return rig;
}



/** The studio light with role, if root holds one from createStudioLights. */
export function findStudioLight(root: Object3D, role: Exclude<StudioLightRole, "ambient">): DirectionalLight | undefined {
  let found: DirectionalLight | undefined;
  root.traverse((child) => {
    if (found !== undefined) return;
    if (child instanceof DirectionalLight && studioLightRoles.get(child) === role) found = child;
  });
  return found;
}

/** Recolors studio lights built by `createStudioLights` in place from `palette`. */
export function applyStudioLightsPalette(target: Object3D, palette: ScenePalette): void {
  const lighting = sceneLighting(palette);
  target.traverse((child) => {
    const role = studioLightRoles.get(child);
    if (role !== undefined && child instanceof Light) child.color.set(lighting[role]);
  });
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
