import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { compareDescriptors, createDescriptorRegistry, defineDescriptor, parameterFields, renderTemplates, type BuildOptions } from "./descriptor.js";
import { DuplicateAssetError } from "./registry.js";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

const parameters = z.object({
  size: z.number().min(1).max(5).default(2),
  count: z.number().int().min(1).max(9).default(3),
  edgeWidth: z.number().min(0.01).max(0.3).default(0.08),
  mode: z.enum(["soft", "hard"]).default("soft"),
  depth: z.union([z.literal(1), z.literal(2)]).default(2),
  tint: hex.optional(),
  flag: z.boolean().default(false),
  note: z.string().min(1).max(20).default("hi"),
  free: z.number().default(0),
});

const meta = { id: "test-orb", kind: "object", name: "Test orb", tags: ["test"], version: "0.1.0", package: "@hedronite/lts-test", added: "2026-11-17" };

type Params = z.output<typeof parameters>;
const built = (params: Params, palette: string | undefined, options: BuildOptions): { params: Params; palette: string | undefined; options: BuildOptions } => ({ params, palette, options });

const orb = (extra: Partial<Parameters<typeof defineDescriptor<(typeof parameters)["shape"], ReturnType<typeof built>, string>>[0]> = {}) =>
  defineDescriptor<(typeof parameters)["shape"], ReturnType<typeof built>, string>({
    meta,
    parameters,
    hints: { size: { label: "Diameter", group: "Shape", step: 0.5 }, mode: { group: "Look" }, count: { max: 6 } },
    templates: [
      { label: "TypeScript", code: 'import { {{pascal}} } from "pkg";\n\nconst {{camel}} = make("{{id}}", { size: {{param.size}}, count: {{param.count}}, ring: {{ring}} }); // {{name}} ({{kind}})' },
      { label: "React", code: "<Orb style={{ color: 'red' }} />" },
    ],
    vars: (params) => ({ ring: String(params.count * 2) }),
    build: (params, palette, options) => Promise.resolve(built(params, palette, options)),
    ...extra,
  });

describe("parameterFields", () => {
  const fields = Object.fromEntries(parameterFields(parameters, { size: { label: "Diameter", group: "Shape", step: 0.5 }, count: { max: 6 } }).map((field) => [field.key, field]));

  it("lists the fields in the schema's order", () => {
    expect(Object.keys(fields)).toEqual(["size", "count", "edgeWidth", "mode", "depth", "tint", "flag", "note", "free"]);
  });

  it("reads type, bounds and default from the schema", () => {
    expect(fields.size).toMatchObject({ type: "number", min: 1, max: 5, default: 2, optional: true });
    expect(fields.count).toMatchObject({ type: "integer", min: 1, default: 3 });
    expect(fields.note).toMatchObject({ type: "string", default: "hi" });
    expect(fields.flag).toMatchObject({ type: "boolean", default: false });
  });

  it("takes label, group, step, min and max from hints first", () => {
    expect(fields.size).toMatchObject({ label: "Diameter", group: "Shape", step: 0.5 });
    expect(fields.count).toMatchObject({ min: 1, max: 6 });
  });

  it("spells a key out for a label and derives a step when none is hinted", () => {
    expect(fields.edgeWidth).toMatchObject({ label: "Edge width", step: 0.001 });
    expect(fields.count).toMatchObject({ label: "Count", step: 1 });
    expect(fields.free?.step).toBeUndefined();
    expect(fields.free?.min).toBeUndefined();
  });

  it("offers a choice its options, from an enum or from literals", () => {
    expect(fields.mode).toMatchObject({ type: "choice", options: ["soft", "hard"], default: "soft" });
    expect(fields.depth).toMatchObject({ type: "choice", options: [1, 2], default: 2 });
  });

  it("calls a hex string a color, and marks what can be left out", () => {
    expect(fields.tint).toMatchObject({ type: "color", optional: true });
    expect(fields.tint?.default).toBeUndefined();
    expect(parameterFields(z.object({ must: z.number() }))[0]?.optional).toBe(false);
  });

  it("does not take the safe-integer span of an unbounded integer for a bound", () => {
    const [field] = parameterFields(z.object({ n: z.number().int().default(4) }));
    expect(field).toMatchObject({ type: "integer", step: 1 });
    expect(field?.min).toBeUndefined();
    expect(field?.max).toBeUndefined();
  });

  it("throws for a hint on a key the schema does not have and for a parameter no control can edit", () => {
    expect(() => parameterFields(parameters, { nope: { label: "x" } })).toThrow(/"nope"/);
    expect(() => parameterFields(z.object({ nested: z.object({ a: z.number() }) }))).toThrow(TypeError);
  });
});

describe("defineDescriptor", () => {
  it("carries the metadata, the schema, the fields and the defaults", () => {
    const descriptor = orb();
    expect(descriptor.meta).toEqual({ ...meta });
    expect(descriptor.parameters).toBe(parameters);
    expect(descriptor.fields.map((field) => field.key)).toEqual(Object.keys(parameters.shape));
    expect(descriptor.defaults).toEqual({ size: 2, count: 3, edgeWidth: 0.08, mode: "soft", depth: 2, flag: false, note: "hi", free: 0 });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.meta)).toBe(true);
    expect(Object.isFrozen(descriptor.defaults)).toBe(true);
  });

  it("lets the descriptor's own defaults override the schema's, and demands them where the schema has none", () => {
    const strict = z.object({ side: z.number().min(1) });
    const input = { meta, parameters: strict, templates: [], build: () => Promise.resolve(0) };
    expect(() => defineDescriptor(input)).toThrow(z.ZodError);
    expect(defineDescriptor({ ...input, defaults: { side: 4 } }).defaults).toEqual({ side: 4 });
    expect(orb({ defaults: { size: 4 } }).defaults).toMatchObject({ size: 4, count: 3 });
  });

  it("rejects metadata that does not parse, including a kind nobody registered", () => {
    expect(() => orb({ meta: { ...meta, kind: "sound" } })).toThrow(z.ZodError);
    expect(() => orb({ meta: { ...meta, id: "Not A Slug" } })).toThrow(z.ZodError);
  });

  it("takes an optional poster path and rejects one that is not relative", () => {
    expect(orb().poster).toBeUndefined();
    expect(orb({ poster: "posters/test-orb-hedronite.png" }).poster).toBe("posters/test-orb-hedronite.png");
    expect(() => orb({ poster: "/etc/passwd" })).toThrow(RangeError);
    expect(() => orb({ poster: "../up.png" })).toThrow(RangeError);
  });

  it("carries an optional preview and thumbnail, and rejects ones that do not fit the asset", () => {
    const base = { meta: { id: "demo", kind: "icon", name: "Demo", tags: ["t"], version: "0.1.0", added: "2026-11-01", package: "@hedronite/lts-demo" }, parameters: z.object({ period: z.number().min(1).max(60).default(9) }), templates: [], build: () => Promise.resolve(1) };
    const plain = defineDescriptor(base);
    expect(plain.preview).toBeUndefined();
    expect(plain.thumbnail).toBeUndefined();
    const shown = defineDescriptor({ ...base, preview: { stage: { period: 4 } }, thumbnail: { shape: "bipyramid", sides: 6, radius: 0.4 } });
    expect(shown.preview).toEqual({ stage: { period: 4 } });
    expect(shown.thumbnail).toEqual({ shape: "bipyramid", sides: 6, radius: 0.4 });
    expect(() => defineDescriptor({ ...base, preview: { stage: { period: 400 } } })).toThrow(z.ZodError);
    expect(() => defineDescriptor({ ...base, thumbnail: { shape: "bipyramid", sides: 2 } })).toThrow(z.ZodError);
  });

  it("does not build until asked, and builds with the defaults for what is left out", async () => {
    const build = vi.fn((params: Params) => Promise.resolve(params.size));
    const descriptor = defineDescriptor({ meta, parameters, templates: [], build });
    expect(build).not.toHaveBeenCalled();
    expect(await descriptor.build()).toBe(2);
    expect(await descriptor.build({ size: 4 })).toBe(4);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("hands build the parsed parameters, the palette and the options", async () => {
    const signal = new AbortController().signal;
    const result = await orb().build({ count: 5, mode: "hard" }, "lapis", { signal });
    expect(result.params).toMatchObject({ size: 2, count: 5, mode: "hard", depth: 2 });
    expect(result.palette).toBe("lapis");
    expect(result.options.signal).toBe(signal);
    expect((await orb().build()).options).toEqual({});
  });

  it("validates parameters where they enter", async () => {
    await expect(orb().build({ size: 99 })).rejects.toThrow(z.ZodError);
    await expect(orb().build({ mode: "other" })).rejects.toThrow(z.ZodError);
  });

  it("renders its templates for the defaults, and for the parameters given", () => {
    const descriptor = orb();
    expect(descriptor.snippets()[0]?.code).toBe('import { TestOrb } from "pkg";\n\nconst testOrb = make("test-orb", { size: 2, count: 3, ring: 6 }); // Test orb (object)');
    expect(descriptor.snippets({ size: 3.5, count: 4 })[0]?.code).toContain("size: 3.5, count: 4, ring: 8");
    expect(descriptor.snippets().map((snippet) => snippet.label)).toEqual(["TypeScript", "React"]);
    expect(descriptor.snippets()[1]?.code).toBe("<Orb style={{ color: 'red' }} />");
  });

  it("rejects a template with a placeholder that has no value", () => {
    expect(() => orb({ templates: [{ label: "x", code: "{{missing}}" }] })).toThrow(/no value for \{\{missing\}\}/);
  });
});

describe("renderTemplates", () => {
  it("fills every occurrence and leaves other braces alone", () => {
    expect(renderTemplates([{ label: "a", code: "{{x}} {{x}} {y} {{ z }}" }], { x: "1" })).toEqual([{ label: "a", code: "1 1 {y} {{ z }}" }]);
  });
});

describe("createDescriptorRegistry", () => {
  const first = orb();
  const second = orb({ meta: { ...meta, id: "another", kind: "material", tags: ["pbr"] } });

  it("finds a descriptor by id and lists them sorted, filtered by kind or tag", () => {
    const registry = createDescriptorRegistry();
    registry.register(first, second);
    expect(registry.get("test-orb")).toBe(first);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.list().map((d) => d.meta.id)).toEqual(["another", "test-orb"]);
    expect(registry.list({ kind: "material" }).map((d) => d.meta.id)).toEqual(["another"]);
    expect(registry.list({ tag: "test" }).map((d) => d.meta.id)).toEqual(["test-orb"]);
  });

  it("throws on a duplicate id and adds none of the batch", () => {
    const registry = createDescriptorRegistry();
    registry.register(first);
    expect(() => {
      registry.register(second, first);
    }).toThrow(DuplicateAssetError);
    expect(registry.get("another")).toBeUndefined();
    expect(() => {
      registry.register(second, second);
    }).toThrow(DuplicateAssetError);
  });
});

describe("compareDescriptors", () => {
  const manifest = { package: "@hedronite/lts-test", assets: [{ id: "test-orb", kind: "object", name: "Test orb", tags: ["test"], version: "0.1.0", added: "2026-11-17" }, { id: "second", kind: "object", name: "Second", version: "0.1.0" }] };
  const orbDescriptor = orb();
  const secondDescriptor = orb({ meta: { id: "second", kind: "object", name: "Second", version: "0.1.0", package: "@hedronite/lts-test" } });
  const agree = { missing: [], extra: [], duplicate: [], mismatched: [] };

  it("finds nothing when every manifest asset has exactly one descriptor", () => {
    expect(compareDescriptors(manifest, [orbDescriptor, secondDescriptor])).toEqual(agree);
  });

  it("finds a manifest asset with no descriptor, and a descriptor with no manifest asset", () => {
    expect(compareDescriptors(manifest, [orbDescriptor])).toEqual({ ...agree, missing: ["second"] });
    expect(compareDescriptors(manifest, [orbDescriptor, secondDescriptor, orb({ meta: { ...meta, id: "stray" } })])).toEqual({ ...agree, extra: ["stray"] });
  });

  it("finds an asset described twice", () => {
    expect(compareDescriptors(manifest, [orbDescriptor, secondDescriptor, orbDescriptor])).toEqual({ ...agree, duplicate: ["test-orb"] });
  });

  it("finds a descriptor whose metadata is not the manifest's entry", () => {
    expect(compareDescriptors(manifest, [orb({ meta: { ...meta, name: "Another name" } }), secondDescriptor])).toEqual({ ...agree, mismatched: ["test-orb"] });
    expect(compareDescriptors(manifest, [orb({ meta: { ...meta, package: "@hedronite/lts-other" } }), secondDescriptor])).toEqual({ ...agree, mismatched: ["test-orb"] });
  });

  it("throws for something that is not a manifest", () => {
    expect(() => compareDescriptors({ assets: [] }, [])).toThrow(z.ZodError);
  });
});
