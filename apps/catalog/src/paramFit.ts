import type { AssetDescriptor, ParameterField, Snippet } from "@hedronite/lts-core";

/** The parts of a descriptor the panel and the address need. */
export type Described = Pick<AssetDescriptor, "fields" | "parameters" | "defaults" | "preview">;

export type Values = Readonly<Record<string, unknown>>;

/**
 * Parameters baked into an asset's graph, by asset id: changing one builds the asset again instead of writing a uniform.
 * Those of a surface shader are the handle's `structural` list, and the screen effects' is the ASCII ramp (`stackStructure`);
 * paramFit.test.ts holds this table to both.
 */
export const structuralParams: Readonly<Record<string, readonly string[]>> = {
  toon: ["bands"],
  dissolve: ["progress"],
  ascii: ["ramp"],
};

/** Parameters the detail view cannot honour, so no control is offered for them and the address cannot carry them: the viewport serves its own bundled model, whatever a "url" says. */
const notShown: readonly string[] = ["url"];

/** The parameters the panel offers and the address carries: the descriptor's, less those the view cannot honour. */
export const shownFields = (described: Pick<Described, "fields">): readonly ParameterField[] => described.fields.filter((field) => !notShown.includes(field.key));

/**
 * Reads a `params` value: a JSON object (`{"density":80}`), or pairs joined by commas (`density=80,speed=3`). The values are
 * left as they came, text for pairs; `fitParams` makes them what each parameter takes. Nothing comes back for an empty or unreadable value.
 */
export function readParams(text: string): Values | undefined {
  const read = ((): unknown => {
    if (text.trim().startsWith("{")) {
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    }
    const pairs = text.split(",").map((pair): [string, string] => [pair.slice(0, Math.max(pair.indexOf("="), 0)).trim(), pair.slice(pair.indexOf("=") + 1)]);
    return Object.fromEntries(pairs.filter(([name]) => name !== ""));
  })();
  if (typeof read !== "object" || read === null || Array.isArray(read)) return undefined;
  const entries = Object.entries(read);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** What a parameter of this type takes, made from what the address held (text, or whatever JSON gave). Nothing when it does not fit. */
function coerce(field: ParameterField, raw: unknown): unknown {
  const text = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : undefined;
  switch (field.type) {
    case "number":
    case "integer":
      return text !== undefined && text !== "" && Number.isFinite(Number(text)) ? Number(text) : undefined;
    case "boolean":
      return raw === true || raw === "true" ? true : raw === false || raw === "false" ? false : undefined;
    case "choice":
      return field.options?.find((option) => option === raw || String(option) === text);
    case "color":
      return text === undefined ? undefined : /^[0-9a-f]{6}$/i.test(text) ? `#${text}` : text;
    case "string":
      return typeof raw === "string" ? raw : undefined;
  }
}

/** Whether `value` is one the descriptor's schema takes for `key`. */
export const accepts = (described: Described, key: string, value: unknown): boolean => described.parameters.safeParse({ [key]: value }).success;

/**
 * The parameters an address asks for, fitted to the asset: only its own parameters, each made the type it takes, and only
 * those its schema accepts. The rest are left out, so a stale or hand-written address cannot reach a handle.
 */
export function fitParams(described: Described, text: string): Values {
  const raw = readParams(text) ?? {};
  const fitted: Record<string, unknown> = {};
  for (const field of shownFields(described)) {
    if (!Object.hasOwn(raw, field.key)) continue;
    const value = coerce(field, raw[field.key]);
    if (value !== undefined && accepts(described, field.key, value)) fitted[field.key] = value;
  }
  return fitted;
}

/** What the asset shows with nothing in the address: its defaults, over which the stage lays its own values (a scan that sweeps often enough to catch). */
export const startValues = (described: Described): Values => ({ ...described.defaults, ...described.preview?.stage });

/** `overrides` with `key` set to `value`, or taken out for undefined; a value equal to the start value is no override either. */
export function withEdit(start: Values, overrides: Values, key: string, value: unknown): Values {
  const others = Object.entries(overrides).filter(([name]) => name !== key);
  return Object.fromEntries(value === undefined || Object.is(value, start[key]) ? others : [...others, [key, value]]);
}

/** The address text for `overrides`: pairs when they read back safely, a JSON object when a text holds a comma, an equals sign or a brace. Empty for none. */
export function formatParams(overrides: Values): string {
  const entries = Object.entries(overrides);
  if (entries.length === 0) return "";
  const plain = entries.every(([, value]) => typeof value !== "string" || (!/[,={]/.test(value) && value.trim() === value && value !== ""));
  return plain ? entries.map(([key, value]) => `${key}=${String(value)}`).join(",") : JSON.stringify(overrides);
}

/** Whether going from `before` to `after` takes out a parameter that has no default: it cannot be written back live, so the asset is built again. */
export const dropsUnset = (described: Described, before: Values, after: Values): boolean => Object.keys(before).some((key) => !Object.hasOwn(after, key) && described.defaults[key] === undefined);

/** The parameters that differ from the start, as a snippet: for an asset whose usage code does not take them, so the code still shows what the view shows. */
export function changedParameters(overrides: Values): Snippet | undefined {
  const entries = Object.entries(overrides);
  if (entries.length === 0) return undefined;
  return { label: "Changed parameters", code: `const params = { ${entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")} };` };
}
