import type { Scene, SceneLook, SceneNode } from "../schema.js";

/** A number as source text: the shortest form that reads back as the same number, negative zero kept. */
export function num(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`${String(value)} has no source form`);
  return Object.is(value, -0) ? "-0" : String(value);
}

/** A list of numbers as an array literal. */
export const vec = (values: readonly number[]): string => `[${values.map(num).join(", ")}]`;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * A JSON value as a TypeScript literal: object keys in alphabetical order, so equal values give equal text. A key that is
 * not a plain name is quoted, and `__proto__` is written as a computed key so it is a key and not the prototype.
 */
export function literal(value: unknown): string {
  if (typeof value === "number") return num(value);
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length === 0) return "{}";
    const key = (name: string): string => (name === "__proto__" ? '["__proto__"]' : IDENTIFIER.test(name) ? name : JSON.stringify(name));
    return `{ ${entries.map(([name, item]) => `${key(name)}: ${literal(item)}`).join(", ")} }`;
  }
  throw new TypeError(`${typeof value} has no source form`);
}

/** One node in the order the code is written: parents before their children, siblings in document order. */
export interface Entry {
  readonly node: SceneNode;
  /** The index of the parent entry, or -1 for a node of the scene's root. */
  readonly parent: number;
  /** The indexes of the child entries. */
  readonly children: number[];
}

/**
 * The nodes as a forest, written parent first. A node whose parent is no node's id stands at the root; a node in a cycle
 * has no way in from the root and is left out. `checkRefs` reports both, and a checked document has neither. A node
 * is never named by its id in code: entries are numbered.
 */
export function forest(scene: Scene): readonly Entry[] {
  const byId = new Map(scene.nodes.map((node, index) => [node.id, index] as const));
  const under = scene.nodes.map((): number[] => []);
  const roots: number[] = [];
  scene.nodes.forEach((node, index) => {
    const parent = node.parent === null ? undefined : byId.get(node.parent);
    if (parent === undefined || parent === index) roots.push(index);
    else under[parent]?.push(index);
  });
  const entries: Entry[] = [];
  const visit = (index: number, parent: number): void => {
    const node = scene.nodes[index];
    if (node === undefined) return;
    const at = entries.length;
    entries.push({ node, parent, children: [] });
    entries[parent]?.children.push(at);
    for (const child of under[index] ?? []) visit(child, at);
  };
  for (const root of roots) visit(root, -1);
  return entries;
}

/** The uniform scale a primitive's or a framed solid's `scale` parameter asks for, or undefined. It scales the asset, not the node's children. */
export function assetScale(node: SceneNode): number | undefined {
  if (node.asset.kind === "object") return undefined;
  const scale = node.asset.params?.["scale"];
  return typeof scale === "number" ? scale : undefined;
}

/** The look as `const palette` source, and the names it needs from the tokens package. */
export function lookSource(look: SceneLook): { readonly values: readonly string[]; readonly types: readonly string[]; readonly lines: readonly string[] } {
  if (typeof look !== "string") {
    const { base, accent, metal, glass, emissive } = look;
    return { values: [], types: ["ScenePalette"], lines: ["const palette: ScenePalette = {", ...Object.entries({ base, accent, metal, glass, emissive }).map(([name, hex]) => `  ${name}: ${JSON.stringify(hex)},`), "};"] };
  }
  if (look === "neutral") return { values: ["neutral"], types: [], lines: ["const palette = neutral.scene;"] };
  return { values: ["neutral", "presets"], types: [], lines: [`const palette = presets.find((preset) => preset.id === ${JSON.stringify(look)})?.scene ?? neutral.scene;`] };
}

/** `{ a, b, type C }`, the names in order. */
export const names = (values: readonly string[], types: readonly string[] = []): string => `{ ${[...values, ...types.map((name) => `type ${name}`)].join(", ")} }`;

/** One import line. The module comes in as a value, so this package's own source never reads like an import of it. */
export const importLine = (clause: string, module: string): string => `import ${clause} from ${JSON.stringify(module)};`;
