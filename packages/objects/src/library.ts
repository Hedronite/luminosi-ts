import { generatedObjects } from "./generated/objects.js";
import { parseObjectSpec, type ObjectSpec } from "./spec.js";

/** Library objects stored as data (assets/src/objects): what the manifest lists. */
export interface LibraryObject {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly added: string;
}

export const libraryObjects: readonly LibraryObject[] = generatedObjects.map(({ id, name, tags, added }) => ({ id, name, tags, added }));

/** The parsed ObjectSpec of a library object stored as data, or undefined for any other id. */
export function objectSpecById(id: string): ObjectSpec | undefined {
  const entry = generatedObjects.find((object) => object.id === id);
  return entry === undefined ? undefined : parseObjectSpec(entry.spec);
}
