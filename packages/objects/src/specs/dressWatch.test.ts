import { disposeObject } from "@hedronite/lts-primitives";
import { hedronite } from "@hedronite/lts-tokens";
import { Box3, Vector3, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { createObjectFromSpec } from "../fromSpec.js";
import { parseObjectSpec } from "../spec.js";
import { dressWatchSpec } from "./dressWatch.js";

const named = (root: Object3D, name: string): Object3D => {
  const object = root.getObjectByName(name);
  if (object === undefined) throw new Error(`no object named ${name}`);
  return object;
};

/** Where a hand's far end points, as a unit vector in the dial plane. */
const handDirection = (root: Object3D, name: string): readonly [number, number] => {
  const center = new Box3().setFromObject(named(root, name)).getCenter(new Vector3());
  const length = Math.hypot(center.x, center.y);
  return [center.x / length, center.y / length];
};

describe("dressWatchSpec", () => {
  it("is a valid spec that survives a JSON round trip", () => {
    const spec = dressWatchSpec();
    expect(parseObjectSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
  });

  it("is the same for the same time", () => {
    expect(dressWatchSpec({ hours: 10, minutes: 10 })).toEqual(dressWatchSpec({ hours: 10, minutes: 10 }));
    expect(dressWatchSpec({ hours: 10, minutes: 10 })).not.toEqual(dressWatchSpec({ hours: 10, minutes: 11 }));
  });

  it("is a case one unit across, with the crown at 3 and the strap along 12–6", () => {
    const root = createObjectFromSpec(dressWatchSpec());
    const caseBox = new Box3().setFromObject(named(root, "case"));
    expect(caseBox.max.x - caseBox.min.x).toBeCloseTo(1, 2);
    expect(caseBox.max.y - caseBox.min.y).toBeCloseTo(1, 2);
    expect(new Box3().setFromObject(named(root, "crown")).min.x).toBeGreaterThan(0.5);
    const all = new Box3().setFromObject(root);
    expect(all.max.y).toBeGreaterThan(0.9);
    expect(all.min.y).toBeLessThan(-0.9);
    expect(all.max.y - all.min.y).toBeLessThan(2);
    disposeObject(root);
  });

  it("points the hands at the time it shows", () => {
    const root = createObjectFromSpec(dressWatchSpec({ hours: 15, minutes: 0, seconds: 45 }));
    root.updateMatrixWorld(true);
    const [hx, hy] = handDirection(root, "hand-hour");
    expect(hx).toBeCloseTo(1, 2);
    expect(hy).toBeCloseTo(0, 2);
    const [mx, my] = handDirection(root, "hand-minute");
    // 45 seconds past the hour: the minute hand has crept 4.5° past 12.
    expect(Math.atan2(mx, my)).toBeCloseTo((4.5 * Math.PI) / 180, 1);
    const [sx, sy] = handDirection(root, "hand-second");
    expect(sx).toBeCloseTo(-1, 2);
    expect(sy).toBeCloseTo(0, 2);
    disposeObject(root);
  });

  it("has twelve Roman indices and sixty minute ticks", () => {
    const { parts } = dressWatchSpec();
    const hours = new Set(parts.filter((p) => p.id.startsWith("numeral-")).map((p) => p.id.split("-")[1]));
    expect(hours.size).toBe(12);
    expect(parts.filter((p) => p.id.startsWith("minute-"))).toHaveLength(60);
  });

  it("builds under any palette and frees cleanly", () => {
    const root = createObjectFromSpec(dressWatchSpec(), { palette: hedronite.scene });
    expect(root.name).toBe("dress-watch");
    expect(() => {
      disposeObject(root);
    }).not.toThrow();
  });

  it("rejects times off the dial", () => {
    expect(() => dressWatchSpec({ hours: 24 })).toThrow(RangeError);
    expect(() => dressWatchSpec({ minutes: 60 })).toThrow(RangeError);
    expect(() => dressWatchSpec({ seconds: 1.5 })).toThrow(RangeError);
  });
});
