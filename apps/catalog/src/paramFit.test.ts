import { loadDescriptors } from "@hedronite/lts-registry";
import { stackStructure } from "@hedronite/lts-postfx/three";
import { describe, expect, it } from "vitest";
import { accepts, dropsUnset, fitParams, formatParams, readParams, startValues, structuralParams, withEdit } from "./paramFit";

const registry = await loadDescriptors();

/** What a surface shader's build hands back: the parts of its handle this reads. */
const isHandle = (value: unknown): value is { readonly structural: readonly string[]; readonly dispose: () => void } => typeof value === "object" && value !== null && "structural" in value && Array.isArray(value.structural) && "dispose" in value && typeof value.dispose === "function";

const need = (id: string) => {
  const descriptor = registry.get(id);
  if (descriptor === undefined) throw new Error(`no descriptor for ${id}`);
  return descriptor;
};

describe("readParams", () => {
  it("reads pairs joined by commas as text, and a JSON object as it is", () => {
    expect(readParams("density=80, speed=3.5,color=#ff8800")).toEqual({ density: "80", speed: "3.5", color: "#ff8800" });
    expect(readParams('{"density":80,"tint":"#112233"}')).toEqual({ density: 80, tint: "#112233" });
  });

  it("gives nothing for an empty, unreadable or non-object value", () => {
    for (const text of ["", "   ", "density", "{oops", "[1,2]", "{}", "=3"]) expect(readParams(text)).toBeUndefined();
  });
});

describe("fitParams", () => {
  const hologram = need("hologram");
  const toon = need("toon");

  it("makes each value the type its parameter takes, in pairs or JSON", () => {
    expect(fitParams(hologram, "density=80,speed=3.5")).toEqual({ density: 80, speed: 3.5 });
    expect(fitParams(hologram, '{"density":80,"color":"#112233"}')).toEqual({ density: 80, color: "#112233" });
    expect(fitParams(hologram, "color=112233")).toEqual({ color: "#112233" });
    expect(fitParams(toon, "bands=4")).toEqual({ bands: 4 });
  });

  it("leaves out what the asset does not take: other names, values out of range, text for a number", () => {
    expect(fitParams(hologram, "nope=1,density=9999,speed=fast,intensity=2")).toEqual({ intensity: 2 });
    expect(fitParams(toon, "bands=2.5,outline=0.2")).toEqual({ outline: 0.2 });
  });

  it("reads booleans, choices and text by their parameter's type", () => {
    const watch = need("dress-watch");
    for (const field of watch.fields.filter((each) => each.type === "boolean")) expect(fitParams(watch, `${field.key}=true`)).toEqual({ [field.key]: true });
    const ascii = need("ascii");
    expect(fitParams(ascii, '{"ramp":" .:#"}')).toEqual({ ramp: " .:#" });
    const framed = need("framed-solid");
    expect(fitParams(framed, "solid=cube")).toEqual({ solid: "cube" });
    expect(fitParams(framed, "solid=blob")).toEqual({});
  });
});

describe("what is shown with nothing in the address, and edits", () => {
  it("starts from the defaults, with the stage's own values over them", () => {
    expect(startValues(need("scan"))).toMatchObject({ period: 4 });
    expect(startValues(need("hologram"))).toEqual(need("hologram").defaults);
  });

  it("an edit to the start value is no override; clearing one takes it out", () => {
    const start = { density: 40, speed: 1.5 };
    expect(withEdit(start, {}, "density", 80)).toEqual({ density: 80 });
    expect(withEdit(start, { density: 80 }, "density", 40)).toEqual({});
    expect(withEdit(start, { density: 80, speed: 2 }, "speed", undefined)).toEqual({ density: 80 });
  });

  it("only a parameter with no default makes a clear need a new build", () => {
    const dissolve = need("dissolve");
    expect(dropsUnset(dissolve, { progress: 0.4 }, {})).toBe(true);
    expect(dropsUnset(dissolve, { color: "#112233" }, {})).toBe(true);
    expect(dropsUnset(dissolve, { speed: 2 }, {})).toBe(false);
    expect(dropsUnset(dissolve, {}, { progress: 0.4 })).toBe(false);
  });

  it("accepts what the schema accepts", () => {
    expect(accepts(need("toon"), "bands", 4)).toBe(true);
    expect(accepts(need("toon"), "bands", 9)).toBe(false);
  });
});

describe("formatParams", () => {
  it("writes pairs when they read back, and JSON when a text holds a comma, an equals sign or a brace", () => {
    expect(formatParams({})).toBe("");
    expect(formatParams({ density: 80, speed: 1.5, tint: "#112233", flag: true })).toBe("density=80,speed=1.5,tint=#112233,flag=true");
    const ramp = { ramp: " .,:#" };
    expect(formatParams(ramp)).toBe(JSON.stringify(ramp));
  });

  it("round trips through the address text for every asset with parameters", () => {
    for (const descriptor of registry.list().filter(({ fields }) => fields.length > 0)) {
      const start = startValues(descriptor);
      const edited = Object.fromEntries(
        descriptor.fields.flatMap((field) => {
          const value = field.type === "boolean" ? field.default !== true : field.type === "choice" ? field.options?.find((option) => option !== field.default) : field.type === "color" ? "#123456" : field.type === "string" ? "a,b=c" : field.min !== undefined && field.max !== undefined && field.default !== field.max ? field.max : undefined;
          return value === undefined || !accepts(descriptor, field.key, value) ? [] : [[field.key, value]];
        }),
      );
      const overrides = Object.entries(edited).reduce((acc, [key, value]) => withEdit(start, acc, key, value), {});
      expect(fitParams(descriptor, formatParams(overrides))).toEqual(overrides);
    }
  });
});

describe("structuralParams", () => {
  it("lists exactly what each surface shader's handle says is baked in", async () => {
    const handles = await Promise.all(registry.list({ kind: "shader" }).map(async (descriptor) => ({ id: descriptor.meta.id, built: await descriptor.build() })));
    expect(handles.length).toBeGreaterThan(0);
    for (const { id, built } of handles) {
      expect(isHandle(built)).toBe(true);
      expect(isHandle(built) ? [...built.structural].sort() : undefined).toEqual([...(structuralParams[id] ?? [])].sort());
      if (isHandle(built)) built.dispose();
    }
  });

  it("lists the ASCII ramp, which rebuilds the stack, and no other screen-effect parameter", () => {
    const base = stackStructure([{ id: "ascii" }]);
    expect(stackStructure([{ id: "ascii", params: { ramp: " .:#" } }])).not.toBe(base);
    expect(structuralParams["ascii"]).toEqual(["ramp"]);
    for (const descriptor of registry.list({ kind: "effect" })) {
      const keys = descriptor.fields.map((field) => field.key);
      for (const key of structuralParams[descriptor.meta.id] ?? []) expect(keys).toContain(key);
    }
    // A value that is not the ramp writes in place: the same structure.
    const cell = need("ascii").fields.find((field) => field.key === "cell");
    expect(cell).toBeDefined();
    expect(stackStructure([{ id: "ascii", params: { cell: 7 } }])).toBe(base);
  });
});
