// Where an adopted asset came from, against the pin of the folder it came from: the commit it names is the folder's
// pinned commit, its license is the license the policy gives that path, and every pin carries its provenance.
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

interface Carrier {
  readonly id: string;
  readonly origin: { readonly vendor: string; readonly relation: string; readonly path: string; readonly commit?: string | undefined; readonly license?: string | undefined; readonly transformations?: readonly string[] | undefined } | undefined;
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
    const pin = readPin(vendorDir, folder);
    if (pin === undefined) throw new Error(`${folder} has no pin`);
    const provenance = provenanceOf(pin, `assets/vendor/${folder}/vendor.json`);
    expect(provenance.license).toMatch(/\S/);
    expect(provenance.vendoredOn).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
    expect(provenance.reviewer).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
    expect(Array.isArray(provenance.transformations)).toBe(true);
  });
});

describe("an adopted asset's origin", () => {
  it("is carried by the first two ports", () => {
    expect(adopted.length).toBeGreaterThanOrEqual(2);
  });
  it.each(adopted.map((carrier) => [carrier.id, carrier.origin] as const))("%s names its folder's pinned commit", (_id, origin) => {
    const pin = readPin(vendorDir, origin.vendor);
    if (pin === undefined) throw new Error(`${origin.vendor} has no pin`);
    if (pin.kept) {
      expect(origin.commit, `${origin.vendor} is kept: its origin names no commit`).toBeUndefined();
      return;
    }
    expect(pin.sources.map((source) => source.commit)).toContain(origin.commit);
  });
  it.each(adopted.map((carrier) => [carrier.id, carrier.origin] as const))("%s carries its license and what it changed", (_id, origin) => {
    expect(origin.license, `${origin.vendor}/${origin.path} has no license`).toBeDefined();
    expect((origin.transformations ?? []).length, `${origin.vendor}/${origin.path} says nothing of what changed`).toBeGreaterThan(0);
  });
  it.each(adopted.map((carrier) => [carrier.id, carrier.origin] as const))("%s is under the license its path gets", (_id, origin) => {
    const pin = readPin(vendorDir, origin.vendor);
    const rule = ruleOf(pin, origin.path);
    if (rule === undefined) throw new Error(`${origin.vendor}/${origin.path} has no license rule`);
    expect(origin.license).toBe(rule.spdx);
  });
});
