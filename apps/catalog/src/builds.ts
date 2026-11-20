import type { Object3D } from "three";

const noteUuid = (value: unknown, seen: Set<string>): void => {
  if (typeof value === "object" && value !== null && "uuid" in value && typeof value.uuid === "string") seen.add(value.uuid);
};

/**
 * Adds to `seen` the `uuid` of every drawable object under `root` (anything that carries a material: meshes, lines, points),
 * of its geometry, and of every material it holds. It reads the scene graph and nothing else: no name, no type of material.
 * A new mesh, a swapped material and a swapped geometry each add one.
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

/**
 * A keyed family of sets that live outside React, so a stage that is mounted again (its Canvas, or anything above it, or the host
 * element itself) keeps counting where it was. The key is the host's `data-testid`: an element has no identity that outlives its
 * mount, so a host without one could only be counted from zero each time, and the count would go down. It is an error, not a quiet reset.
 */
function family(): (host: Pick<HTMLElement, "dataset">) => Set<string> {
  const byStage = new Map<string, Set<string>>();
  return (host) => {
    const name = host.dataset["testid"];
    if (name === undefined) throw new Error("a stage reports its counts onto a host with a data-testid: this host has none");
    const held = byStage.get(name) ?? new Set<string>();
    byStage.set(name, held);
    return held;
  };
}

/**
 * The uuids a stage has ever attached, as one set for the stage's lifetime in the page. A stage is the host element it reports
 * onto, known by its `data-testid` when it has one, so a host that is itself mounted again is still the same stage.
 */
export const buildsOf = family();

/**
 * The `uuid` of every render-target texture the stage's screen-effect pipeline has ever held (`ScreenEffects.targetIds`, handed over
 * by `ScreenEffectsPass`'s `onPipeline`), kept the way `buildsOf` keeps its set: never lowered. A new pipeline (an effect added or
 * removed, a ramp changed, a remount) adds its targets; a parameter, an ink and a pause add none.
 */
export const effectBuildsOf = family();

/**
 * Adds the render-target textures of a pipeline the stage has just built to the stage's `effectBuildsOf` set. A host that is not
 * there cannot be counted onto, and the targets are not dropped quietly: it is an error (the host holds the Canvas, so it is mounted
 * whenever one of its passes reports).
 */
export function noteEffectTargets(host: Pick<HTMLElement, "dataset"> | null, ids: readonly string[]): void {
  if (host === null) throw new Error("a screen-effect pipeline was built on a stage whose host is not mounted: its targets would go uncounted");
  const seen = effectBuildsOf(host);
  for (const id of ids) seen.add(id);
}

/**
 * What the renderer itself reports it holds, from `info.memory`: geometries, textures and render targets. The WebGPU renderer counts
 * all three; the WebGL renderer counts no render targets, so those read 0 there.
 */
export function memoryOf(gl: object): { readonly geometries: number; readonly textures: number; readonly targets: number } {
  const read = (from: unknown, key: string): unknown => (typeof from === "object" && from !== null ? Reflect.get(from, key) : undefined);
  const memory = read(read(gl, "info"), "memory");
  const count = (key: string): number => {
    const value = read(memory, key);
    return typeof value === "number" ? value : 0;
  };
  return { geometries: count("geometries"), textures: count("textures"), targets: count("renderTargets") };
}
