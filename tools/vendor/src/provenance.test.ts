// Where an adopted asset came from, against the pin of the folder it came from: the commit it names is the folder's
// pinned commit, its license is the license the policy gives that path, every pin carries its provenance, and a pin's
// transformations are exactly its sources' include, exclude and overlay (plus any layout of several sources).
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { screenEffectInfo } from "@hedronite/lts-postfx";
import { effectInfo } from "@hedronite/lts-shaders";
import { describe, expect, it } from "vitest";
import { provenanceOf, readPin } from "./pin.js";
import { ruleOf } from "./policy.js";

const vendorDir = resolve(import.meta.dirname, "../../../assets/vendor");
const folders = readdirSync(vendorDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const pinOf = (folder: string) => {
  const pin = readPin(vendorDir, folder);
  if (pin === undefined) throw new Error(`${folder} has no pin`);
  return pin;
};

interface Carrier {
  readonly id: string;
  readonly origin:
    | {
        readonly vendor: string;
        readonly relation: string;
        readonly path: string;
        readonly commit?: string | undefined;
        readonly license?: string | undefined;
        readonly transformations?: readonly string[] | undefined;
      }
    | undefined;
}
const carriers: readonly Carrier[] = [
  ...Object.entries(screenEffectInfo).map(([id, info]) => ({ id: `effect ${id}`, origin: info.origin })),
  ...Object.entries(effectInfo).map(([id, info]) => ({ id: `shader ${id}`, origin: info.origin })),
];
const adopted = carriers.filter((carrier): carrier is Carrier & { origin: NonNullable<Carrier["origin"]> } => carrier.origin !== undefined);

describe("the provenance of every pin", () => {
  it("has at least the eleven folders", () => {
    expect(folders.length).toBeGreaterThanOrEqual(11);
  });
  it.each(folders)("%s carries its license, transformations, date and reviewer", (folder) => {
    const pin = pinOf(folder);
    const provenance = provenanceOf(pin, `assets/vendor/${folder}/vendor.json`);
    expect(provenance.license).toMatch(/\S/);
    expect(provenance.vendoredOn).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
    expect(provenance.reviewer).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
    expect(Array.isArray(provenance.transformations)).toBe(true);
  });
  it.each(folders)("%s states each change to its sources, and no other", (folder) => {
    const pin = pinOf(folder);
    const sources = pin.kept ? [] : pin.sources;
    const overlay = pin.kept ? undefined : pin.overlay;
    const from = sources.flatMap((source) => [
      ...(source.include ?? []).map((path) => `include:${path}`),
      ...(source.exclude ?? []).map((path) => `exclude:${path}`),
    ]);
    const declared = (pin.transformations ?? [])
      .filter((change) => change.kind !== "layout")
      .flatMap((change) => change.paths.map((path) => `${change.kind}:${path}`));
    expect(declared.sort()).toEqual([...from, ...(overlay ?? []).map((path) => `overlay:${path}`)].sort());
  });
  it.each(folders)("%s lays out several sources as one folder, and says so", (folder) => {
    const pin = pinOf(folder);
    const places = (pin.kept ? [] : pin.sources).flatMap((source) => (source.into === undefined ? [] : [source.into]));
    const layouts = (pin.transformations ?? []).filter((change) => change.kind === "layout");
    const expected = places.length === 0 ? [] : [places.sort()];
    expect(layouts.map((change) => [...change.paths].sort())).toEqual(expected);
  });
});

describe("an adopted asset's origin", () => {
  it("is carried by the first two ports", () => {
    expect(adopted.length).toBeGreaterThanOrEqual(2);
  });
  it.each(adopted.map((carrier) => [carrier.id, carrier.origin] as const))("%s names its folder's pinned commit", (_id, origin) => {
    const pin = pinOf(origin.vendor);
    const agrees = pin.kept ? origin.commit === undefined : pin.sources.some((source) => source.commit === origin.commit);
    expect(agrees, `${origin.vendor} names ${String(origin.commit)}`).toBe(true);
  });
  it.each(adopted.map((carrier) => [carrier.id, carrier.origin] as const))("%s carries its license and what it changed", (_id, origin) => {
    expect(origin.license).toBeDefined();
    expect((origin.transformations ?? []).length).toBeGreaterThan(0);
  });
  it.each(adopted.map((carrier) => [carrier.id, carrier.origin] as const))("%s is under the license its path gets", (_id, origin) => {
    const rule = ruleOf(pinOf(origin.vendor), origin.path);
    if (rule === undefined) throw new Error(`${origin.vendor}/${origin.path} has no license rule`);
    expect(origin.license).toBe(rule.spdx);
  });
});
