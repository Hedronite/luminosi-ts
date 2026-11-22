// The generated provenance data, checked against the pins it is generated from: each entry parses, a folder's sources
// are its pin's commits, its policies describe exactly the pin's licenses and cover every raw file once, and the kept
// folder names no source. Read against the cache the fetch writes; a missing cache is `not fetched`, never a skip.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { vendorCreditRecords, vendorProvenanceSchema, type VendorProvenance } from "@hedronite/lts-core";
import { describe, expect, it } from "vitest";
import { vendorProvenance } from "./vendorProvenance.js";

const root = resolve(import.meta.dirname, "../../../..");
const vendorDir = join(root, "assets/vendor");
const cacheDir = ((): string => {
  const given = process.env["LTS_VENDOR_CACHE"];
  return given === undefined || given === "" ? join(root, ".vendor") : given;
})();

interface Pin {
  readonly kept: boolean;
  readonly keptReason?: string;
  readonly sources?: readonly { readonly source: string; readonly commit: string }[];
  readonly transformations: readonly { readonly kind: string; readonly paths: readonly string[]; readonly reason: string }[];
  readonly vendoredOn: string;
  readonly reviewer: string;
  readonly licenses: readonly { readonly spdx: string; readonly paths?: readonly string[]; readonly remainder?: boolean }[];
}

const folders = readdirSync(vendorDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const pinOf = (folder: string): Pin => JSON.parse(readFileSync(join(vendorDir, folder, "vendor.json"), "utf8")) as Pin;

/** A glob as the pins write them: `*` any run but a slash, `?` one such character, `**` any run of folders, `dir/` a folder. */
function matches(pattern: string, path: string): boolean {
  const text = pattern.endsWith("/") ? `${pattern}**` : pattern;
  let out = "";
  for (let at = 0; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (char === "*" && text.charAt(at + 1) === "*") {
      const slash = text.charAt(at + 2) === "/";
      out += slash ? "(?:.*/)?" : ".*";
      at += slash ? 2 : 1;
    } else if (char === "*") out += "[^/]*";
    else out += char === "?" ? "[^/]" : char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "s").test(path);
}

/** Every file of a folder's raw copy, by its path inside the folder: the kept folder in the repository, the rest in the cache. */
function rawFiles(folder: string, pin: Pin): readonly string[] {
  const dir = pin.kept ? join(vendorDir, folder) : join(cacheDir, folder);
  if (!existsSync(dir)) throw new Error(`assets/vendor/${folder}'s raw files are not fetched: run \`bun run vendor:fetch ${folder}\``);
  return readdirSync(dir, { recursive: true })
    .map((path) => path.split("\\").join("/"))
    .filter((path) => statSync(join(dir, path)).isFile());
}

/** The distinct license ids of a pin, as the one expression the data carries. */
const expression = (pin: Pin): string =>
  [...new Set(pin.licenses.map((entry) => (entry.spdx.includes(" ") ? `(${entry.spdx})` : entry.spdx)))].join(" AND ");

describe("the generated vendor provenance", () => {
  it("has an entry for every pinned folder", () => {
    expect(Object.keys(vendorProvenance).sort()).toEqual(folders);
  });
  it.each(folders)("%s parses with the core schema", (folder) => {
    const parsed = vendorProvenanceSchema.safeParse(vendorProvenance[folder]);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });
  it.each(folders)("%s carries its pin's sources, kind and license", (folder) => {
    const pin = pinOf(folder);
    const entry = vendorProvenance[folder] as VendorProvenance;
    expect(entry.sources.map((source) => source.commit)).toEqual(pin.sources?.map((source) => source.commit) ?? []);
    expect(entry.sources.map((source) => source.repo)).toEqual(pin.sources?.map((source) => source.source) ?? []);
    expect(entry.fetched).toBe(!pin.kept);
    expect(entry.keptReason).toBe(pin.keptReason);
    expect(entry.license).toBe(expression(pin));
    expect(entry.licenseIds).toEqual([...new Set(pin.licenses.map((license) => license.spdx))]);
    expect(entry.vendoredOn).toBe(pin.vendoredOn);
    expect(entry.reviewer).toBe(pin.reviewer);
    expect(entry.transformations.map((change) => change.kind)).toEqual(pin.transformations.map((change) => change.kind));
  });
  it.each(folders)("%s has a policy row for each of its pin's licenses", (folder) => {
    const pin = pinOf(folder);
    const entry = vendorProvenance[folder] as VendorProvenance;
    expect(entry.policies).toHaveLength(pin.licenses.length);
    for (const license of pin.licenses) {
      const row = entry.policies.find(
        (candidate) => candidate.spdx === license.spdx && candidate.files.join(",") === (license.paths ?? []).join(","),
      );
      if (row === undefined) throw new Error(`${folder}: no policy row for ${license.spdx} (${(license.paths ?? []).join(", ")})`);
    }
  });
  it.each(folders)("%s covers each raw file by one policy row at most, and the rest by its remainder", (folder) => {
    const pin = pinOf(folder);
    const entry = vendorProvenance[folder] as VendorProvenance;
    const named = entry.policies.filter((row) => row.files.length > 0);
    const remainder = entry.policies.filter((row) => row.files.length === 0);
    expect(remainder.length).toBeLessThanOrEqual(1);
    const files = rawFiles(folder, pin);
    const twice: string[] = [];
    const bare: string[] = [];
    for (const file of files) {
      const covering = named.filter((row) => row.files.some((pattern) => matches(pattern, file)));
      if (covering.length > 1) twice.push(`${file} (${covering.map((row) => row.spdx).join(" and ")})`);
      if (covering.length === 0 && remainder.length === 0) bare.push(file);
    }
    expect({ twice: twice.slice(0, 3), bare: bare.slice(0, 3) }).toEqual({ twice: [], bare: [] });
    expect(files.length).toBeGreaterThan(0);
  });
  it.each(folders)("%s has a credit record carrying its commit and license id", (folder) => {
    const pin = pinOf(folder);
    const record = vendorCreditRecords[folder];
    if (record === undefined) throw new Error(`${folder} has no credit record`);
    expect(record.commit).toBe(pin.sources?.[0]?.commit);
    expect(record.licenseId).toBe(expression(pin));
  });
});
