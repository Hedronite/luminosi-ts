import type { SceneNode } from "@hedronite/lts-scene";
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { axes, fromField, groups, nudged, readField, shown, toField, TransformPanel, withAxis, type Axis, type Group } from "./TransformPanel";

const node = (over: Partial<SceneNode> = {}): SceneNode => ({
  id: "n1",
  parent: null,
  position: [1.25, -2, 0.5],
  rotation: [0.3, 0.5, -1],
  scale: [1, 2, 3],
  asset: { kind: "primitive", id: "platonic-cube" },
  ...over,
});

const markup = (current: SceneNode | null, label?: string): string => renderToStaticMarkup(<TransformPanel node={current} {...(label === undefined ? {} : { label })} onChange={() => undefined} onGestureEnd={() => undefined} />);

/** Each field of a rendered panel: its id, and the text of the label that points at it. */
function fieldsOf(html: string): { readonly id: string; readonly label: string }[] {
  const labels = [...html.matchAll(/<label for="([^"]+)"[^>]*>([^<]*)<\/label>/g)].map((match) => ({ id: match[1] ?? "", label: match[2] ?? "" }));
  const inputs = [...html.matchAll(/<input id="([^"]+)"/g)].map((match) => match[1] ?? "");
  expect(inputs).toEqual(labels.map((each) => each.id));
  return labels;
}

describe("TransformPanel", () => {
  it("has a labelled number field for each axis of the position, the rotation and the scale, and says rotation is in degrees", () => {
    const html = markup(node(), "Cube, satin");
    expect(fieldsOf(html).map((each) => each.label)).toEqual(["Position X", "Position Y", "Position Z", "Rotation X", "Rotation Y", "Rotation Z", "Scale X", "Scale Y", "Scale Z"]);
    expect(html).toContain("Rotation (degrees)");
    expect(html.match(/<input [^>]*type="number"/g)).toHaveLength(9);
    expect(html).toContain("Transform: Cube, satin");
  });

  it("shows what the document holds: position and scale as they are, rotation in degrees", () => {
    const html = markup(node({ rotation: [Math.PI / 2, 0, -Math.PI] }));
    expect(html).toContain('value="1.25"');
    expect(html).toContain('value="90"');
    expect(html).toContain('value="-180"');
    expect(html).toContain('value="3"');
  });

  it("says a nested node's numbers are relative to its parent, and a root node's are not", () => {
    expect(markup(node({ parent: "n0" }))).toContain("Relative to n0");
    expect(markup(node())).not.toContain("Relative to");
  });

  it("asks for a selection when there is none, with no fields", () => {
    const html = markup(null);
    expect(html).toContain("Select a node");
    expect(html).not.toContain("<input");
  });
});

describe("what a field says to the document", () => {
  it("changes one axis of one transform and leaves every other number exactly as it was", () => {
    const start = node();
    for (const group of groups) {
      for (const axis of axes) {
        const change = withAxis(start, group, axis, 7);
        expect(Object.keys(change)).toEqual([group]);
        const changed = change[group];
        expect(changed?.[axis]).toBe(fromField(group, 7));
        for (const other of axes.filter((each) => each !== axis)) expect(Object.is(changed?.[other], start[group][other])).toBe(true);
      }
    }
  });

  it("gives back the radians the document holds, within 1e-9, for the degrees a rotation field shows", () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 100, noNaN: true }), fc.constantFrom<Axis>(0, 1, 2), (radians, axis) => {
        const start = node({ rotation: [0, 0, 0] });
        const degrees = toField("rotation", radians);
        expect(Math.abs(fromField("rotation", degrees) - radians)).toBeLessThan(1e-9);
        // A degree value typed into a field is turned to radians once, and no other axis moves.
        const rotation = withAxis(start, "rotation", axis, degrees).rotation;
        expect(Math.abs((rotation?.[axis] ?? Number.NaN) - radians)).toBeLessThan(1e-9);
        expect(rotation?.filter((_, at) => at !== axis)).toEqual([0, 0]);
      }),
    );
  });

  it("turns 90 degrees into a half pi, and keeps position and scale in the document's own unit", () => {
    expect(withAxis(node(), "rotation", 1, 90).rotation?.[1]).toBeCloseTo(Math.PI / 2, 12);
    expect(withAxis(node(), "position", 2, 4.5).position?.[2]).toBe(4.5);
    expect(withAxis(node(), "scale", 0, 0.25).scale?.[0]).toBe(0.25);
  });

  it("reads a number from text, and nothing from what is not one", () => {
    expect(readField("12.5")).toBe(12.5);
    expect(readField(" -3e2 ")).toBe(-300);
    // "1." is the number 1 on its way to 1.5: it reads, and the field keeps the text until it loses focus.
    expect(readField("1.")).toBe(1);
    expect(["", " ", "-", "e", "abc", "Infinity", "NaN", "1,5"].map((text) => readField(text))).toEqual(Array(8).fill(undefined));
    expect(shown(0.1 + 0.2)).toBe("0.3");
    expect(shown(17.188733853924695)).toBe("17.188734");
  });
});

describe("the arrow keys", () => {
  const start = node();

  it("move a position by a tenth, a rotation by a degree and a scale by a tenth, up and down", () => {
    expect(nudged(start, "position", 0, 1).position?.[0]).toBeCloseTo(1.35, 12);
    expect(nudged(start, "position", 0, -1).position?.[0]).toBeCloseTo(1.15, 12);
    expect(toField("rotation", nudged(start, "rotation", 1, 1).rotation?.[1] ?? Number.NaN)).toBeCloseTo(toField("rotation", 0.5) + 1, 9);
    expect(nudged(start, "scale", 2, -1).scale?.[2]).toBeCloseTo(2.9, 12);
  });

  it("move ten times as far with Shift and a tenth as far with Alt, and Shift wins when both are held", () => {
    expect(nudged(start, "position", 1, 1, { shift: true }).position?.[1]).toBeCloseTo(-1, 12);
    expect(nudged(start, "position", 1, 1, { alt: true }).position?.[1]).toBeCloseTo(-1.99, 12);
    expect(nudged(start, "position", 1, 1, { shift: true, alt: true }).position?.[1]).toBeCloseTo(-1, 12);
  });

  it("do not drift: ten steps up and ten down are the number they began at, within 1e-9, on every axis", () => {
    fc.assert(
      fc.property(fc.double({ min: -50, max: 50, noNaN: true }), fc.constantFrom<Group>("position", "rotation", "scale"), fc.constantFrom<Axis>(0, 1, 2), (value, group, axis) => {
        let current = node({ [group]: [value, value, value] });
        for (const direction of [...Array<1>(10).fill(1), ...Array<-1>(10).fill(-1)]) {
          const change = nudged(current, group, axis, direction);
          current = { ...current, ...change };
        }
        expect(Math.abs(current[group][axis] - value)).toBeLessThan(1e-9);
      }),
    );
  });
});
