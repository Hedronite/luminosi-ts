import { describe, expect, it } from "vitest";
import { creditSchema, vendorCreditSchema } from "./credits.js";
import { lookCredits } from "./generated/lookCredits.js";
import { vendorCredits } from "./generated/vendorCredits.js";

const vendored = Object.entries(vendorCredits);
const looks = Object.entries(lookCredits);

/** A commit, or a release version and the hash of the folder, each possibly named by its repository: what a pin reads like. */
const pinPart = /^(?:[\w.-]+: )?(?:[0-9a-f]{8,40}|v\d+(?:\.\d+)+ sha256:[0-9a-f]{64})$/;

describe("vendorCredits", () => {
  it("has entries, by folder id in order", () => {
    expect(vendored.length).toBeGreaterThan(0);
    expect(Object.keys(vendorCredits)).toEqual(Object.keys(vendorCredits).toSorted());
  });

  it.each(vendored)("%s has its work, address, pin, license and credit, as plain text over https", (_, entry) => {
    expect(vendorCreditSchema.safeParse(entry).success).toBe(true);
    expect(entry.license).not.toContain("`");
    expect(entry.pin.split(", ").every((part) => pinPart.test(part))).toBe(true);
  });

  it("gives a link only to licenses that ask for one", () => {
    for (const [, entry] of vendored) expect(entry.licenseUrl === undefined || entry.license.includes("CC-BY")).toBe(true);
  });
});

describe("lookCredits", () => {
  it.each(looks)("%s is a look's credit, ported from a pinned source", (id, entry) => {
    expect(creditSchema.safeParse(entry).success).toBe(true);
    expect(entry).toMatchObject({ subject: id, kind: "look", relation: "ported" });
    expect(pinPart.test(entry.pin)).toBe(true);
  });

  it("has entries, by look id in order", () => {
    expect(looks.length).toBeGreaterThan(0);
    expect(Object.keys(lookCredits)).toEqual(Object.keys(lookCredits).toSorted());
  });
});

describe("creditSchema", () => {
  const [, first] = vendored[0] ?? [];
  const crt = { ...first, subject: "crt", kind: "effect", relation: "ported", path: "src/shaders/crt/crtShaders.ts" };

  it("takes a credit for an asset and one for a look", () => {
    expect(creditSchema.safeParse(crt).success).toBe(true);
    expect(creditSchema.safeParse({ ...crt, subject: "omarchy", kind: "look", relation: "adopted", path: "themes/omarchy/colors.toml" }).success).toBe(true);
  });

  it("names every field, with the link to the license optional", () => {
    expect(Object.keys(creditSchema.unwrap().shape)).toEqual(["work", "source", "pin", "license", "licenseUrl", "credit", "subject", "kind", "relation", "path"]);
    expect(creditSchema.safeParse({ ...crt, licenseUrl: "https://creativecommons.org/licenses/by/4.0/" }).success).toBe(true);
  });

  it.each(["work", "source", "pin", "license", "credit", "subject", "kind", "relation", "path"])("refuses a credit without %s", (field) => {
    expect(creditSchema.safeParse({ ...crt, [field]: undefined }).success).toBe(false);
  });

  it("refuses a relation or a kind that is not on the list", () => {
    expect(creditSchema.safeParse({ ...crt, relation: "copied" }).success).toBe(false);
    expect(creditSchema.safeParse({ ...crt, kind: "planet" }).success).toBe(false);
  });

  it.each(["http://example.com/work", "ftp://example.com/work", "javascript:alert(1)", "example.com/work", "file:///etc/passwd"])("takes https addresses only, so not %s", (address) => {
    expect(creditSchema.safeParse({ ...crt, source: address }).success).toBe(false);
    expect(creditSchema.safeParse({ ...crt, licenseUrl: address }).success).toBe(false);
  });

  it.each(["../secrets", "/etc/passwd", "a/../../b", "", "a\\b"])("takes a path by an origin path's rules: inside the work, forward slashes, nothing that climbs out, so not %j", (path) => {
    expect(creditSchema.safeParse({ ...crt, path }).success).toBe(false);
  });

  it("takes license and credit as plain text: no backticks", () => {
    expect(creditSchema.safeParse({ ...crt, license: "MIT (`LICENSE`)" }).success).toBe(false);
    expect(creditSchema.safeParse({ ...crt, credit: "`Someone`" }).success).toBe(false);
  });
});
