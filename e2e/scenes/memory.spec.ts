// The leftovers each round-trip fixture may keep in the renderer after it is freed (e2e/scenes.spec.ts holds the renderer to them): no browser.
import { expect, test } from "@playwright/test";
import { fixture } from "./emitted.js";
import { roundTrip } from "./fixtures.js";
import { leftoverTextures } from "./memory.js";

test("each fixture's leftovers are the environment's texture, and transmission glass's where it has glass", () => {
  expect(Object.fromEntries(roundTrip.map((name) => [name, leftoverTextures(fixture(name))]))).toEqual({
    "primitives-in-materials": 2,
    "framed-solid-shader": 1,
    "object-effects-ink": 1,
    "transform-hierarchy": 2,
  });
});
