import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScene, type Scene } from "@hedronite/lts-scene";
import { toVanilla } from "@hedronite/lts-scene/emit";
import type { Fixture } from "./fixtures.js";

const here = import.meta.dirname;

/** Where the committed, generated module of a fixture is, and where its goldens are. */
export const generatedPath = (name: Fixture): string => join(here, "generated", `${name}.ts`);
export const plantPath = (name: Fixture, plant: string): string => join(here, "plants", `${name}.${plant}.ts`);
export const goldenPath = (name: Fixture): string => join(here, `${name}.png`);

/** A fixture of `packages/scene/fixtures`, read. */
export function fixture(name: Fixture): Scene {
  const parsed = parseScene(readFileSync(join(here, "../../packages/scene/fixtures", `${name}.json`), "utf8"));
  if (!parsed.ok) throw new Error(`fixture ${name} does not read: ${JSON.stringify(parsed.issues)}`);
  return parsed.scene;
}

/** The module the emitter writes for a document. */
export const emit = (scene: Scene): string => toVanilla(scene);

/** Whether `text` is the module the emitter writes for the fixture now. */
export const isCurrent = (name: Fixture, text: string): boolean => text === emit(fixture(name));
