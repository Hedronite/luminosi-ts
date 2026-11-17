import { positionLocal, sin, time } from "three/tsl";
import type { Node } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createHologramMaterial } from "./three.js";

const nodesUnder = (root: Node): Node[] => {
  const found: Node[] = [];
  root.traverse((node) => {
    found.push(node);
  });
  return found;
};

/**
 * Oscillators that run on time alone: a sine over `time` with no position in it swings the whole
 * surface at once, which is a flicker. A sine over time and position (scan lines climbing) is not.
 */
const flickers = (root: Node): Node[] =>
  nodesUnder(root).filter((node) => {
    if (!("isMathNode" in node) || node.isMathNode !== true) return false;
    const inside = nodesUnder(node);
    const oscillates = "method" in node && (node.method === "sin" || node.method === "cos");
    return oscillates && inside.includes(time) && !inside.includes(positionLocal);
  });

describe("the flicker check", () => {
  it("finds a whole-surface oscillation over time", () => {
    expect(flickers(sin(time.mul(23))).length).toBeGreaterThan(0);
  });

  it("leaves a travelling pattern alone", () => {
    expect(flickers(sin(positionLocal.y.mul(10).add(time))).length).toBe(0);
  });
});

describe("hologram", () => {
  it("does not flicker: its opacity holds steady at any one point on the surface, bar the lines climbing it", () => {
    const material = createHologramMaterial();
    const roots = [material.opacityNode, material.colorNode];
    for (const root of roots) {
      if (root === null) throw new Error("the hologram has no node for this channel");
      expect(flickers(root)).toEqual([]);
    }
  });
});
