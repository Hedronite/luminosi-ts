import { z } from "zod";
import { assetMetaSchema, type AssetKind, type AssetMeta } from "./asset.js";
import { manifestSchema } from "./manifest.js";
import { DuplicateAssetError, type AssetFilter } from "./registry.js";

/**
 * One asset, described so a program can use it without knowing which asset it is: its metadata, its
 * parameters (a Zod schema, with hints for a panel), what it builds, and the code that shows how to use it.
 * Descriptors are data plus one lazy `build`: a descriptor module imports no three.js, and `build` loads the
 * package's `./three` entry only when it is called.
 */

/** What a parameter panel needs beyond the schema. `min` and `max` default to the schema's own bounds. */
export interface ParameterHint {
  /** Text for the control. Default: the key, spelled out ("edgeWidth" is "Edge width"). */
  readonly label?: string;
  /** Controls with the same group sit together. */
  readonly group?: string;
  /** The smallest change a control makes. Default: 1 for integers, a hundredth of the range for other bounded numbers. */
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
}

export type ParameterHints = Readonly<Record<string, ParameterHint>>;

export type ParameterType = "number" | "integer" | "boolean" | "string" | "color" | "choice";

/** One parameter as a control sees it. */
export interface ParameterField {
  readonly key: string;
  readonly label: string;
  readonly type: ParameterType;
  readonly group?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** The value the schema fills in when the parameter is left out. */
  readonly default?: unknown;
  /** True when the parameter can be left out (it has a default, or is optional). */
  readonly optional: boolean;
  /** The values a "choice" offers, in the schema's order. */
  readonly options?: readonly (string | number)[];
}

/** Zod writes an unbounded integer as one that spans the safe integers; that is not a bound anyone chose. */
const bound = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER ? value : undefined);

const spell = (key: string): string => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A hundredth of the range, rounded down to a power of ten: 0.01 for 0.5 to 8. */
const stepFor = (min: number, max: number): number => 10 ** Math.floor(Math.log10((max - min) / 100));

const hasConst = (schema: unknown): schema is { readonly const: unknown } => typeof schema === "object" && schema !== null && "const" in schema;

const constants = (schemas: readonly unknown[]): (string | number)[] | undefined => {
  const values: (string | number)[] = [];
  for (const schema of schemas) {
    if (!hasConst(schema) || (typeof schema.const !== "string" && typeof schema.const !== "number")) return undefined;
    values.push(schema.const);
  }
  return values;
};

/** The part of a JSON Schema this reads for each property. Parsed, so what Zod writes is checked rather than assumed. */
const propertySchema = z.looseObject({
  type: z.string().optional(),
  pattern: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  enum: z.array(z.union([z.string(), z.number()])).optional(),
  anyOf: z.array(z.unknown()).optional(),
  default: z.unknown().optional(),
});

const objectSchema = z.looseObject({
  properties: z.record(z.string(), propertySchema).optional(),
  required: z.array(z.string()).optional(),
});

type JsonProperty = z.output<typeof propertySchema>;

function fieldOf(key: string, property: JsonProperty, required: boolean, hint: ParameterHint): ParameterField {
  const options = property.enum ?? (property.anyOf === undefined ? undefined : constants(property.anyOf));
  let type: ParameterType;
  if (options !== undefined) type = "choice";
  else if (property.type === "integer") type = "integer";
  else if (property.type === "number") type = "number";
  else if (property.type === "boolean") type = "boolean";
  else if (property.type === "string") type = property.pattern?.includes("#[0-9a-f]{6}") === true ? "color" : "string";
  else throw new TypeError(`parameter "${key}" is not a number, boolean, string or choice, so no control can edit it`);

  const min = hint.min ?? bound(property.minimum);
  const max = hint.max ?? bound(property.maximum);
  const step = hint.step ?? (type === "integer" ? 1 : type === "number" && min !== undefined && max !== undefined ? stepFor(min, max) : undefined);
  return {
    key,
    label: hint.label ?? spell(key),
    type,
    ...(hint.group === undefined ? {} : { group: hint.group }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(step === undefined ? {} : { step }),
    ...(property.default === undefined ? {} : { default: property.default }),
    optional: !required,
    ...(options === undefined ? {} : { options }),
  };
}

/**
 * The controls for a parameter schema, in the schema's key order. Throws for a parameter no control can edit
 * (an object, an array), and for a hint that names a key the schema does not have.
 */
export function parameterFields(parameters: z.ZodObject, hints: ParameterHints = {}): readonly ParameterField[] {
  const json = objectSchema.parse(z.toJSONSchema(parameters, { io: "input", unrepresentable: "any" }));
  const properties = json.properties ?? {};
  for (const key of Object.keys(hints)) {
    if (!Object.hasOwn(properties, key)) throw new RangeError(`a hint names "${key}", which is not a parameter`);
  }
  return Object.entries(properties).map(([key, property]) => fieldOf(key, property, json.required?.includes(key) === true, hints[key] ?? {}));
}

/** A piece of usage code with `{{name}}` placeholders. */
export interface SnippetTemplate {
  readonly label: string;
  readonly code: string;
}

/** A template with its placeholders filled in. */
export interface Snippet {
  readonly label: string;
  readonly code: string;
}

const camel = (id: string): string => id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascal = (id: string): string => camel(id).replace(/^[a-z]/, (c) => c.toUpperCase());

/**
 * Fills `{{name}}` in each template from `vars`. Throws for a placeholder with no value, so a typo cannot ship as
 * code. Text without double braces, and JSX's `{{ ... }}` with spaces inside, pass through.
 */
export function renderTemplates(templates: readonly SnippetTemplate[], vars: Readonly<Record<string, string>>): readonly Snippet[] {
  return templates.map(({ label, code }) => ({
    label,
    code: code.replace(/\{\{([\w.]+)\}\}/g, (_, name: string) => {
      const value = vars[name];
      if (value === undefined) throw new RangeError(`snippet "${label}": no value for {{${name}}}`);
      return value;
    }),
  }));
}

/**
 * A stand-in shape for an asset's gallery thumbnail, for an asset that has no single shape of its own (an object).
 * It is plain data, so the light list can carry it and the gallery draws it without loading a descriptor.
 */
const thumbnailSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("platonic"), solid: z.string().min(1) }),
  z.object({ shape: z.literal("bipyramid"), sides: z.number().int().min(3), radius: z.number().positive().optional(), height: z.number().positive().optional() }),
]);

export type Thumbnail = z.output<typeof thumbnailSchema>;

/** How an asset is put on show, beyond what its parameters default to. */
export interface AssetPreviewData {
  /**
   * Parameters a stage sets, over the defaults, when it puts this asset on show: a screen effect that sweeps every nine
   * seconds sweeps every few while someone looks. The values pass its schema.
   */
  readonly stage?: Readonly<Record<string, unknown>>;
}

/** Passed to `build` beside the parameters and palette. */
export interface BuildOptions {
  /** Aborts work that waits on the network, such as loading a model. */
  readonly signal?: AbortSignal;
}

/**
 * Everything the catalog, the agent commands and the playground need to know about one asset.
 * `Built` is what `build` makes, which depends on the kind (an SVG string, a geometry, a material, an object);
 * `Palette` is the scene colors it takes. Both are `unknown` when the descriptors are handled as a list.
 */
export interface AssetDescriptor<Built = unknown, Palette = unknown> {
  /** The manifest entry: id, kind, name, tags, version, package, and when it was added or where it came from. */
  readonly meta: AssetMeta;
  /** The parameters `build` takes, validated where they enter. Every field has a default or is optional. */
  readonly parameters: z.ZodObject;
  /** The parameters as controls see them: labels, groups, bounds and steps. */
  readonly fields: readonly ParameterField[];
  /** The value of every parameter when none is given: the schema's parse of `{}`, over the descriptor's own defaults. */
  readonly defaults: Readonly<Record<string, unknown>>;
  /** Usage code with `{{name}}` placeholders. */
  readonly templates: readonly SnippetTemplate[];
  /** A path (relative, forward slashes) to the still image the gallery shows before anything is built. */
  readonly poster?: string;
  /** How the catalog's stages put the asset on show, when the defaults do not. */
  readonly preview?: AssetPreviewData;
  /**
   * The stand-in shape the gallery draws for it. The light list of an asset kind carries it too, so the gallery needs no
   * descriptor to draw it.
   */
  readonly thumbnail?: Thumbnail;
  /**
   * Builds the asset. Parameters are parsed with `parameters`, so a missing one takes its default and a wrong one
   * throws a ZodError. The package's three.js entry loads here and nowhere else. The caller owns the result.
   */
  build(params?: unknown, palette?: Palette, options?: BuildOptions): Promise<Built>;
  /** The templates filled in for `params` (default: the defaults), so the code shown matches what is built. */
  snippets(params?: unknown): readonly Snippet[];
}

export interface DescriptorInput<Shape extends z.ZodRawShape, Built, Palette> {
  /** The manifest entry, as `registerManifest` takes it, with the package set. */
  readonly meta: unknown;
  readonly parameters: z.ZodObject<Shape>;
  readonly hints?: ParameterHints;
  /** For parameters the schema gives no default. */
  readonly defaults?: z.input<z.ZodObject<Shape>>;
  readonly templates: readonly SnippetTemplate[];
  /** Extra placeholder values for the templates, from the parsed parameters. Placeholders `id`, `name`, `kind`, `camel`, `pascal` and `param.<key>` are always there. */
  readonly vars?: (params: z.output<z.ZodObject<Shape>>) => Readonly<Record<string, string>>;
  readonly poster?: string;
  readonly preview?: AssetPreviewData;
  readonly thumbnail?: Thumbnail;
  readonly build: (params: z.output<z.ZodObject<Shape>>, palette: Palette | undefined, options: BuildOptions) => Promise<Built>;
}

/**
 * Checks a descriptor's parts against each other and freezes it: the metadata parses, the hints name real
 * parameters, the defaults satisfy the schema, and every template fills in. Throws on the first that does not.
 */
export function defineDescriptor<Shape extends z.ZodRawShape, Built, Palette = unknown>(input: DescriptorInput<Shape, Built, Palette>): AssetDescriptor<Built, Palette> {
  const meta = assetMetaSchema.parse(input.meta);
  const { parameters } = input;
  const fields = parameterFields(parameters, input.hints);
  const defaults = Object.freeze({ ...parameters.parse(input.defaults ?? {}) });
  if (input.poster !== undefined && !/^(?!\/)(?!.*\.\.)[\w./@-]+$/.test(input.poster)) {
    throw new RangeError(`poster "${input.poster}" is not a relative path`);
  }

  const parse = (params: unknown): z.output<z.ZodObject<Shape>> => parameters.parse({ ...defaults, ...(typeof params === "object" && params !== null ? params : {}) });
  const thumbnail = input.thumbnail === undefined ? undefined : thumbnailSchema.parse(input.thumbnail);
  if (input.preview?.stage !== undefined) parse(input.preview.stage); // the stage's parameters pass the schema, or this descriptor is wrong
  const snippets = (params?: unknown): readonly Snippet[] => {
    const parsed = parse(params);
    const vars: Record<string, string> = { id: meta.id, name: meta.name, kind: meta.kind, camel: camel(meta.id), pascal: pascal(meta.id) };
    for (const [key, value] of Object.entries(parsed)) vars[`param.${key}`] = String(value);
    return renderTemplates(input.templates, { ...vars, ...input.vars?.(parsed) });
  };
  snippets(); // every template fills in for the defaults, or this descriptor is wrong

  return Object.freeze({
    meta,
    parameters,
    fields,
    defaults,
    templates: input.templates,
    ...(input.poster === undefined ? {} : { poster: input.poster }),
    ...(input.preview === undefined ? {} : { preview: input.preview }),
    ...(thumbnail === undefined ? {} : { thumbnail }),
    // A bad parameter rejects, like any other failure of the build, rather than throwing before a promise exists.
    build: (params?: unknown, palette?: Palette, options: BuildOptions = {}) => Promise.resolve().then(() => input.build(parse(params), palette, options)),
    snippets,
  });
}

/** Descriptors by id. */
export interface DescriptorRegistry {
  /** Adds descriptors. Throws if an id is taken, and then adds none of them. */
  register(...descriptors: readonly AssetDescriptor[]): void;
  get(id: string): AssetDescriptor | undefined;
  /** Every matching descriptor, sorted by id. */
  list(filter?: AssetFilter): readonly AssetDescriptor[];
}

export function createDescriptorRegistry(): DescriptorRegistry {
  const descriptors = new Map<string, AssetDescriptor>();
  return {
    register(...added) {
      const seen = new Set<string>();
      for (const { meta } of added) {
        if (descriptors.has(meta.id) || seen.has(meta.id)) throw new DuplicateAssetError(meta.id);
        seen.add(meta.id);
      }
      for (const descriptor of added) descriptors.set(descriptor.meta.id, descriptor);
    },
    get: (id) => descriptors.get(id),
    list(filter = {}) {
      const kind: AssetKind | undefined = filter.kind;
      return [...descriptors.values()]
        .filter(({ meta }) => (kind === undefined || meta.kind === kind) && (filter.tag === undefined || meta.tags.includes(filter.tag)))
        .sort((a, b) => (a.meta.id < b.meta.id ? -1 : 1));
    },
  };
}

/** How a package's descriptors differ from its manifest. Every list is empty when they agree. */
export interface DescriptorComparison {
  /** In the manifest, with no descriptor. */
  readonly missing: readonly string[];
  /** Described, but not in the manifest. */
  readonly extra: readonly string[];
  /** Described more than once. */
  readonly duplicate: readonly string[];
  /** Present in both, but the descriptor's metadata is not the manifest's entry (with the package set). */
  readonly mismatched: readonly string[];
}

/**
 * Compares a package's manifest with its descriptors, so "every asset has exactly one descriptor" is a test and
 * not a convention. Throws if `manifest` is not a manifest.
 */
export function compareDescriptors(manifest: unknown, descriptors: readonly AssetDescriptor[]): DescriptorComparison {
  const parsed = manifestSchema.parse(manifest);
  const expected = new Map(parsed.assets.map((asset) => [asset.id, JSON.stringify(assetMetaSchema.parse({ ...asset, package: parsed.package }))]));
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  const extra: string[] = [];
  const mismatched: string[] = [];
  for (const { meta } of descriptors) {
    if (seen.has(meta.id)) duplicate.add(meta.id);
    seen.add(meta.id);
    const want = expected.get(meta.id);
    if (want === undefined) extra.push(meta.id);
    else if (want !== JSON.stringify(meta)) mismatched.push(meta.id);
  }
  return { missing: [...expected.keys()].filter((id) => !seen.has(id)), extra, duplicate: [...duplicate], mismatched };
}
