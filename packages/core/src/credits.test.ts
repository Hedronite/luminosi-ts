import { describe, expect, it } from "vitest";
import { creditSchema, vendorCreditSchema } from "./credits.js";
import { vendorCredits } from "./generated/vendorCredits.js";

const entries = Object.entries(vendorCredits);

describe("vendorCredits", () => {
  it("holds a credit for every vendored folder, by folder id in order", () => {
    expect(entries.length).toBeGreaterThanOrEqual(11);
    expect(Object.keys(vendorCredits)).toEqual(Object.keys(vendorCredits).toSorted());
  });

  it.each(entries)("%s has its work, address, pin, license and credit", (_, entry) => {
    expect(vendorCreditSchema.safeParse(entry).success).toBe(true);
  });

  it("pins the CRT's and the soap film's folders", () => {
    expect(vendorCredits["threeui"]?.pin).toBe("02f9835e60ef8f0cac7907810aa223b7d414db1b");
    expect(vendorCredits["codevember-2026"]?.pin).toBe("4df8e67a");
  });
});

describe("creditSchema", () => {
  const crt = { ...vendorCredits["threeui"], subject: "crt", kind: "effect", relation: "ported", path: "src/shaders/crt/crtShaders.ts" };

  it("takes a credit for an asset and one for a look", () => {
    expect(creditSchema.safeParse(crt).success).toBe(true);
    expect(creditSchema.safeParse({ ...crt, subject: "omarchy", kind: "look", relation: "adopted", path: "" }).success).toBe(true);
  });

  it("names every field and refuses a relation that is not one of the three", () => {
    expect(Object.keys(creditSchema.unwrap().shape)).toEqual(["work", "source", "pin", "license", "credit", "subject", "kind", "relation", "path"]);
    expect(creditSchema.safeParse({ ...crt, relation: "copied" }).success).toBe(false);
    expect(creditSchema.safeParse({ ...crt, kind: "planet" }).success).toBe(false);
  });

  it.each(["work", "source", "pin", "license", "credit", "subject", "kind", "relation", "path"])("refuses a credit without %s", (field) => {
    expect(creditSchema.safeParse({ ...crt, [field]: undefined }).success).toBe(false);
  });
});
