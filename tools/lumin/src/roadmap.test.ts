import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./commands.js";

/**
 * The roadmap says what shipped. From Stage 5 on, every checklist line is checked in both
 * directions: a ticked `[x]` line cites the pull request(s) that delivered it (`#nn`), and an
 * open `[ ]` line cites none. An open line whose work partly merged says so in a parenthesis that
 * starts with `partial:` (`(partial: the field, #30)`); only that parenthesis may name a pull
 * request on an open line. Stages 0 to 4 predate the pull request trail and are not checked.
 */
const firstCheckedHeading = "## Stage 5";

const drift = (text: string): readonly string[] => {
  const start = text.indexOf(firstCheckedHeading);
  if (start < 0) return [`no "${firstCheckedHeading}" heading`];
  const problems: string[] = [];
  text
    .slice(start)
    .split("\n")
    .forEach((line, index) => {
      const mark = /^\s*- \[([ x])\] /.exec(line)?.[1];
      if (mark === undefined) return;
      const cited = /#\d+/.test(line.replace(/\(partial:[^)]*\)/g, ""));
      const label = line.replace(/^\s*- \[[ x]\] /, "").slice(0, 48);
      const at = text.slice(0, start).split("\n").length + index;
      if (mark === "x" && !cited) problems.push(`ROADMAP.md:${String(at)} is ticked but cites no pull request: ${label}`);
      if (mark === " " && cited) problems.push(`ROADMAP.md:${String(at)} cites a pull request but is not ticked: ${label}`);
    });
  return problems;
};

describe("ROADMAP.md", () => {
  const text = readFileSync(join(root, "ROADMAP.md"), "utf8");

  it("ticks every line that cites a pull request, and cites one on every ticked line (Stage 5 on)", () => {
    expect(drift(text)).toEqual([]);
  });

  it("fails a line that cites a pull request but stays open", () => {
    const planted = text.replace("- [x] A6 Truth pass", "- [ ] A6 Truth pass");
    expect(planted).not.toBe(text);
    expect(drift(planted).join("\n")).toMatch(/is not ticked: A6 Truth pass/);
  });

  it("fails a ticked line that cites no pull request", () => {
    const planted = text.replace(/(- \[x\] A6 Truth pass[^\n]*) \(#35\)/, "$1");
    expect(planted).not.toBe(text);
    expect(drift(planted).join("\n")).toMatch(/is ticked but cites no pull request: A6 Truth pass/);
  });

  it("lets an open line name a pull request only inside a partial: note", () => {
    const open = "## Stage 5\n- [ ] X1 later work (partial: the part that landed, #30)\n";
    expect(drift(open)).toEqual([]);
    expect(drift(open.replace("(partial: ", "(").replace("#30)", "#30)"))).toHaveLength(1);
    expect(drift("## Stage 5\n- [ ] X1 later work (#30)\n")).toHaveLength(1);
    expect(drift("## Stage 5\n- [x] X1 done (#30)\n")).toEqual([]);
    expect(drift("## Stage 5\n- [x] X1 done\n")).toHaveLength(1);
  });

  it("leaves no internal step label in the file", () => {
    expect(text).not.toMatch(/\bW[0-9]+ ?G[0-9]+\b/);
  });
});
