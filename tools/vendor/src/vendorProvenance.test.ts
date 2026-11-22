// The generated provenance data, checked against the pins it is generated from with the policy's own matcher and
// coverage check: each entry parses, a folder's sources are its pin's, its policies are the pin's licenses with file
// counts that add up, every raw file is covered once, and the kept folder names no source.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { vendorCreditRecords, vendorProvenanceSchema } from "@hedronite/lts-core";
import { describe, expect, it } from "vitest";
import { vendorProvenance } from "../../../apps/catalog/src/generated/vendorProvenance.js";
import { filesUnder, hashed, readPin, type Pin } from "./pin.js";
import { coverageProblems, matchesGlob } from "./policy.js";
import { resolveVendor } from "./resolve.js";

const vendorDir = resolve(import.meta.dirname, "../../../assets/vendor");
const context = { vendorDir, env: process.env };
const folders = readdirSync(vendorDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const pinOf = (folder: string): Pin => {
  const pin = readPin(vendorDir, folder);
  if (pin === undefined) throw new Error(`${folder} has no pin`);
  return pin;
};
/** The files a pin's hash covers, through the resolver: the cache for a fetched folder, the folder itself for a kept one. */
function countedFiles(folder: string, pin: Pin): readonly string[] {
  const found = resolveVendor(folder, context);
  if (!found.ok) throw new Error(found.error);
  return filesUnder(found.dir).filter((path) => hashed(path, pin.kept));
}
const expression = (pin: Pin): string =>
  [...new Set((pin.licenses ?? []).map((entry) => (entry.spdx.includes(" ") ? `(${entry.spdx})` : entry.spdx)))].join(" AND ");
const entryOf = (folder: string) => {
  const entry = vendorProvenance[folder];
  if (entry === undefined) throw new Error(`${folder} has no provenance`);
  return entry;
};

describe("the generated vendor provenance", () => {
  it("has an entry for every pinned folder", () => {
    expect(Object.keys(vendorProvenance).sort()).toEqual(folders);
  });
  it.each(folders)("%s parses with the core schema", (folder) => {
    const parsed = vendorProvenanceSchema.safeParse(vendorProvenance[folder]);
    if (!parsed.success) throw new Error(`${folder}: ${JSON.stringify(parsed.error.issues)}`);
    expect(parsed.success).toBe(true);
  });
  it.each(folders)("%s carries its pin's sources, kind, license and transformations", (folder) => {
    const pin = pinOf(folder);
    const entry = entryOf(folder);
    const sources = pin.kept ? [] : pin.sources.map((source) => ({ repo: source.source, commit: source.commit }));
    expect(entry.sources).toEqual(sources);
    expect(entry.fetched).toBe(!pin.kept);
    expect(entry.keptReason).toBe(pin.kept ? pin.keptReason : undefined);
    expect(entry.license).toBe(expression(pin));
    expect(entry.licenseIds).toEqual([...new Set((pin.licenses ?? []).map((license) => license.spdx))]);
    expect(entry.vendoredOn).toBe(pin.vendoredOn);
    expect(entry.reviewer).toBe(pin.reviewer);
    expect(entry.transformations).toEqual(pin.transformations);
  });
  it.each(folders)("%s has a policy row for each of its pin's licenses", (folder) => {
    const pin = pinOf(folder);
    const entry = entryOf(folder);
    expect(entry.policies).toHaveLength((pin.licenses ?? []).length);
    for (const license of pin.licenses ?? []) {
      const row = entry.policies.find(
        (candidate) => candidate.spdx === license.spdx && candidate.files.join(",") === (license.paths ?? []).join(","),
      );
      if (row === undefined) throw new Error(`${folder}: no policy row for ${license.spdx} (${(license.paths ?? []).join(", ")})`);
    }
  });
  it.each(folders)("%s counts its files per policy row, and the rows add up", (folder) => {
    const pin = pinOf(folder);
    const entry = entryOf(folder);
    const files = countedFiles(folder, pin);
    expect(entry.totalFiles).toBe(files.length);
    const named = entry.policies.filter((row) => row.files.length > 0);
    const remainder = entry.policies.filter((row) => row.files.length === 0);
    expect(remainder.length).toBeLessThanOrEqual(1);
    for (const row of named) {
      const matching = files.filter((file) => row.files.some((pattern) => matchesGlob(pattern, file)));
      expect(row.fileCount, `${folder}: ${row.spdx} ${row.files.join(", ")}`).toBe(matching.length);
    }
    expect(entry.policies.reduce((sum, row) => sum + row.fileCount, 0)).toBe(entry.totalFiles);
  });
  it.each(folders)("%s has no coverage problem in its pin, as the policy reads it", (folder) => {
    const pin = pinOf(folder);
    expect(coverageProblems(folder, pin, countedFiles(folder, pin))).toEqual([]);
  });
  it.each(folders)("%s has a credit record naming its sources and license id", (folder) => {
    const pin = pinOf(folder);
    const record = vendorCreditRecords[folder];
    if (record === undefined) throw new Error(`${folder} has no credit record`);
    expect(record.sources).toEqual(pin.kept ? [] : pin.sources.map((source) => ({ repo: source.source, commit: source.commit })));
    expect(record.licenseId).toBe(expression(pin));
  });
});
