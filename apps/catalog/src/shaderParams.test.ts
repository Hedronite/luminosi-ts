import { describe, expect, it } from "vitest";
import { shaderParams } from "./shaderParams";

describe("shaderParams", () => {
  it("reads pairs joined by commas, numbers as numbers and the rest as text", () => {
    expect(shaderParams("density=80, speed=3.5,color=#ff8800")).toEqual({ density: 80, speed: 3.5, color: "#ff8800" });
  });

  it("reads a JSON object", () => {
    expect(shaderParams('{"density":80,"tint":"#112233"}')).toEqual({ density: 80, tint: "#112233" });
  });

  it("gives nothing for an empty, unreadable or non-object value", () => {
    for (const text of ["", "   ", "density", "{oops", "[1,2]", "{}", "=3"]) expect(shaderParams(text)).toBeUndefined();
  });
});
