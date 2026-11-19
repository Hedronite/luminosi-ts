import type { AssetKind } from "@hedronite/lts-core";
import type { z } from "zod";
import type { Scene, SceneIssue } from "./schema.js";

/** What a reference can point at. Looks are named by id like the rest, though a look takes no parameters. */
export type RefKind = Extract<AssetKind, "primitive" | "object" | "material" | "shader" | "effect"> | "look";

/**
 * What the caller knows about one id: the schema of the parameters it takes. A registry's asset descriptor fits, and
 * so does `{}` for a look. The root never imports a registry's builders, so the caller passes the lookup in.
 */
export interface Resolved {
  readonly parameters?: z.ZodObject;
}

/** The thing `id` names as a `kind`, or undefined when there is none. */
export type Resolve = (kind: RefKind, id: string) => Resolved | undefined;

type Path = readonly (string | number)[];

/**
 * Checks the parts of a document that only the caller's registry can know, and the structure of its nodes. It
 * returns every issue it finds, in document order, and an empty list for a good document:
 *
 * - `unknown-primitive`, `unknown-object`, `unknown-material`, `unknown-shader`, `unknown-effect`, `unknown-look`:
 *   an id that `resolve` does not know as that kind;
 * - `unknown-param`: a parameter the asset's schema does not have;
 * - `invalid-param`: a value outside the asset's schema;
 * - `duplicate-id`: two nodes with one id (reported at the second);
 * - `missing-parent`: a parent that is no node's id;
 * - `cycle`: a node that is its own ancestor (reported at the first node of each cycle).
 */
export function checkRefs(scene: Scene, resolve: Resolve): readonly SceneIssue[] {
  const issues: SceneIssue[] = [];
  const add = (path: Path, code: string, message: string): void => {
    issues.push({ path, code, message });
  };

  const known = (kind: RefKind, id: string, path: Path): Resolved | undefined => {
    const found = resolve(kind, id);
    if (found === undefined) add(path, `unknown-${kind}`, `no ${kind} named "${id}"`);
    return found;
  };

  const checkParams = (found: Resolved | undefined, given: Readonly<Record<string, unknown>> | undefined, path: Path): void => {
    if (found === undefined || given === undefined) return;
    const schema = found.parameters;
    const names = schema === undefined ? [] : Object.keys(schema.shape);
    const strangers = Object.keys(given).filter((key) => !names.includes(key));
    for (const key of strangers) add([...path, key], "unknown-param", `"${key}" is not a parameter here${names.length === 0 ? " (there are none)" : `; they are ${names.join(", ")}`}`);
    if (schema === undefined) return;
    const parsed = schema.safeParse(Object.fromEntries(Object.entries(given).filter(([key]) => names.includes(key))));
    if (parsed.success) return;
    for (const issue of parsed.error.issues) add([...path, ...issue.path.filter((key): key is string | number => typeof key !== "symbol")], "invalid-param", issue.message);
  };

  if (typeof scene.look === "string") known("look", scene.look, ["look"]);

  const ids = new Map<string, number>();
  scene.nodes.forEach((node, index) => {
    const at: Path = ["nodes", index];
    if (ids.has(node.id)) add([...at, "id"], "duplicate-id", `id "${node.id}" is already node ${String(ids.get(node.id))}`);
    else ids.set(node.id, index);

    const { asset, surface } = node;
    const kind = asset.kind === "object" ? "object" : "primitive";
    checkParams(known(kind, asset.id, [...at, "asset", "id"]), asset.params, [...at, "asset", "params"]);
    if (asset.kind === "framed") known("material", asset.edges.material, [...at, "asset", "edges", "material"]);

    if (surface !== undefined) {
      const [which, id] = "material" in surface ? (["material", surface.material] as const) : (["shader", surface.shader] as const);
      checkParams(known(which, id, [...at, "surface", which]), surface.params, [...at, "surface", "params"]);
    }
  });

  scene.nodes.forEach((node, index) => {
    if (node.parent !== null && !ids.has(node.parent)) add(["nodes", index, "parent"], "missing-parent", `no node has the id "${node.parent}"`);
  });

  // A node is in a cycle when walking up its parents comes back to it. Each cycle is reported once, at its first node.
  const parents = new Map(scene.nodes.map((node) => [node.id, node.parent] as const));
  const reported = new Set<string>();
  scene.nodes.forEach((node, index) => {
    const walked = new Set<string>();
    let at: string | null = node.id;
    while (at !== null && !walked.has(at)) {
      walked.add(at);
      at = parents.get(at) ?? null;
    }
    if (at !== node.id) return;
    const members = [...walked];
    if (members.some((member) => reported.has(member))) return;
    for (const member of members) reported.add(member);
    add(["nodes", index, "parent"], "cycle", `"${node.id}" is its own ancestor`);
  });

  scene.effects.forEach((effect, index) => {
    checkParams(known("effect", effect.id, ["effects", index, "id"]), effect.params, ["effects", index, "params"]);
  });

  return issues;
}
