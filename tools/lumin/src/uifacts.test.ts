import { describe, expect, it } from "vitest";
import { uiFacts } from "./uifacts.js";

const source = `import { Close } from "@hedronite/lts-icons/react";
export function Panel({ on }: { on: boolean }) {
  return (
    <section className="mt-6">
      <button type="button" aria-label="Close" className={\`rounded \${on ? "ring-2 ring-accent" : "ring-0"}\`}>
        <Close size={16} />
      </button>
      <div onClick={() => {}} className="outline-none">Open</div>
      <img src="a.png" {...rest} />
      <p>Hello {"world"}</p>
    </section>
  );
}`;

describe("uiFacts", () => {
  const rows = uiFacts("Panel.tsx", source);
  const tag = (name: string) => rows.filter((row) => row.tag === name);

  it("lists every element with its line and attributes", () => {
    expect(rows.map((row) => [row.tag, row.line])).toEqual([
      ["section", 4],
      ["button", 5],
      ["Close", 6],
      ["div", 8],
      ["img", 9],
      ["p", 10],
    ]);
    expect(tag("button")[0]?.attrs).toMatchObject({ type: "button", "aria-label": "Close" });
    expect(tag("img")[0]?.attrs).toMatchObject({ src: "a.png", "{...}": "{...rest}" });
    expect(tag("div")[0]?.attrs["onClick"]).toBe("{() => {}}");
  });

  it("links each element to its nearest element ancestor", () => {
    expect(rows.map((row) => row.parent)).toEqual([-1, 0, 1, 0, 0, 0]);
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("counts expression children and records ancestors, nearest first", () => {
    expect(tag("p")[0]).toMatchObject({ dynamic: 0, ancestors: ["section"] });
    expect(tag("Close")[0]?.ancestors).toEqual(["button", "section"]);
    const dynamic = uiFacts("L.tsx", "export const L = ({ n }: { n: string }) => <label><button>{n}</button><input /></label>;");
    expect(dynamic.find((row) => row.tag === "button")).toMatchObject({ dynamic: 1, text: "" });
    expect(dynamic.find((row) => row.tag === "input")?.ancestors).toEqual(["label"]);
  });

  it("reads the literal parts of a className, ternary arms included", () => {
    expect(tag("button")[0]?.class).toBe("rounded ring-2 ring-accent ring-0");
    expect(tag("div")[0]?.class).toBe("outline-none");
  });

  it("knows an icon-only button and collects text children", () => {
    expect(tag("button")[0]).toMatchObject({ iconOnly: true, children: 1, text: "" });
    expect(tag("p")[0]?.text).toBe("Hello world");
    expect(tag("div")[0]).toMatchObject({ iconOnly: false, text: "Open" });
  });
});
