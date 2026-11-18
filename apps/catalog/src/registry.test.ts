import { describe, expect, it } from "vitest";
import { shapeFor } from "./registry";

describe("shapeFor", () => {
  it("gives a primitive its own shape", () => {
    expect(shapeFor("platonic-cube", "primitive")?.faces).toHaveLength(6);
  });

  it("gives the objects that have a stand-in their own", () => {
    const cluster = shapeFor("crystal-cluster", "object");
    const lattice = shapeFor("instanced-lattice", "object");
    expect(cluster).toBeDefined();
    expect(lattice).toBeDefined();
    expect(cluster).not.toEqual(lattice);
  });

  it("gives every other object the generic stand-in, so none is left without a thumbnail", () => {
    // An object stored as data, and one that does not exist yet.
    const lamp = shapeFor("your-desk-lamp", "object");
    expect(lamp?.faces.length).toBeGreaterThan(0);
    expect(shapeFor("some-future-object", "object")).toEqual(lamp);
  });

  it("has nothing for a primitive id that does not exist", () => {
    expect(shapeFor("no-such-primitive", "primitive")).toBeUndefined();
  });
});
