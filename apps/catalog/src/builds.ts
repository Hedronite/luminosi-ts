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

/** The sets live outside React, so a stage that is mounted again (its Canvas, or anything above it) keeps counting where it was. */
const byStage = new Map<string, Set<string>>();
const byElement = new WeakMap<object, Set<string>>();

/**
 * The uuids a stage has ever attached, as one set for the stage's lifetime in the page. A stage is the host element it reports
 * onto, known by its `data-testid` when it has one, so a host that is itself mounted again is still the same stage.
 */
export function buildsOf(host: Pick<HTMLElement, "dataset">): Set<string> {
  const name = host.dataset["testid"];
  if (name !== undefined) {
    const held = byStage.get(name) ?? new Set<string>();
    byStage.set(name, held);
    return held;
  }
  const held = byElement.get(host) ?? new Set<string>();
  byElement.set(host, held);
  return held;
}
