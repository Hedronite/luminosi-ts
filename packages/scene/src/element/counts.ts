import type { Object3D } from "three";

const noteUuid = (value: unknown, seen: Set<string>): void => {
  if (typeof value === "object" && value !== null && "uuid" in value && typeof value.uuid === "string") seen.add(value.uuid);
};

/**
 * Adds to `seen` the `uuid` of every drawable object under `root` (anything that carries a material), of its geometry and of every
 * material it holds. It reads the scene graph and nothing else: no name, no kind of material. A new mesh, a swapped material and a
 * swapped geometry each add one. The same count the site island keeps.
 */
export function noteBuilds(root: Object3D, seen: Set<string>): void {
  root.traverse((object) => {
    if (!("material" in object)) return;
    seen.add(object.uuid);
    if ("geometry" in object) noteUuid(object.geometry, seen);
    const held: unknown = object.material;
    const materials: readonly unknown[] = Array.isArray(held) ? held : [held];
    for (const material of materials) noteUuid(material, seen);
  });
}

/** What the renderer itself reports it holds, from `info.memory`. */
export interface RendererMemory {
  readonly geometries: number;
  readonly textures: number;
  readonly targets: number;
  readonly programs: number;
}

/** The renderer's memory report: geometries, textures, render targets and programs, 0 for what it does not count. */
export function memoryOf(renderer: object): RendererMemory {
  const info: unknown = "info" in renderer ? renderer.info : undefined;
  const memory: unknown = typeof info === "object" && info !== null && "memory" in info ? info.memory : undefined;
  const count = (key: string): number => {
    const value: unknown = typeof memory === "object" && memory !== null && key in memory ? Reflect.get(memory, key) : undefined;
    return typeof value === "number" ? value : 0;
  };
  return { geometries: count("geometries"), textures: count("textures"), targets: count("renderTargets"), programs: count("programs") };
}
