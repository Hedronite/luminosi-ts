import type { Scene } from "../schema.js";

/**
 * One list of names fixes the order of keys: a key on it is written at its place on it, in every object, and a key not on
 * it (most parameter names) follows them all in alphabetical order. So every object has exactly one order whatever order
 * the value was built in, and a parameter that is called `id`, `scale` or `material` is written by this list, not
 * alphabetically.
 */
const ORDER = [
  "format",
  "version",
  "look",
  "seed",
  "nodes",
  "lights",
  "environment",
  "camera",
  "effects",
  "ink",
  "tracks",
  "clips",
  "rest",
  "kind",
  "id",
  "target",
  "keyframes",
  "time",
  "value",
  "easing",
  "driver",
  "trigger",
  "parent",
  "position",
  "rotation",
  "scale",
  "asset",
  "surface",
  "edges",
  "material",
  "shader",
  "params",
  "rig",
  "intensity",
  "target",
  "fov",
  "base",
  "accent",
  "metal",
  "glass",
  "emissive",
];

const rank = (key: string): number => {
  const at = ORDER.indexOf(key);
  return at === -1 ? ORDER.length : at;
};

const byKey = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);

/** A number in the shortest form that reads back as the same number; negative zero is written as -0, which JSON reads back as negative zero. */
function numberText(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`${String(value)} has no JSON form`);
  return Object.is(value, -0) ? "-0" : String(value);
}

function write(value: unknown, indent: string): string {
  if (typeof value === "number") return numberText(value);
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // A list of numbers (a position, a rotation) stays on one line.
    if (value.every((item) => typeof item === "number")) return `[${value.map((item) => numberText(item)).join(", ")}]`;
    const inner = `${indent}  `;
    return `[\n${value.map((item) => `${inner}${write(item, inner)}`).join(",\n")}\n${indent}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(byKey);
    if (entries.length === 0) return "{}";
    const inner = `${indent}  `;
    return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${write(item, inner)}`).join(",\n")}\n${indent}}`;
  }
  throw new TypeError(`${typeof value} has no JSON form`);
}

/**
 * A scene as text, in one canonical form: two-space indent, one key order (the list above, then any other key alphabetically), numbers in their shortest round-trip form (negative zero as -0), numeric lists on one line, and
 * a final newline. Equal documents give equal text, and `parseScene` of the text is the document.
 */
export function toCanonicalJson(scene: Scene): string {
  return `${write(scene, "")}\n`;
}
