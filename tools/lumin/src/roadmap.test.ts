import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./commands.js";

/**
 * The roadmap says what shipped, checked in both directions. On every stage, an open `[ ]` line cites
 * no pull request (`#nn`) unless it does so inside a parenthesis that starts with `partial:` (for
 * example `(partial: the field, #30)`), because a merged PR on an open line means it should be
 * ticked or say what is still missing. From Stage 5 on, a ticked `[x]` line must cite the pull
 * request(s) that delivered it; Stages 0 to 4 predate the pull request trail, so a ticked line
 * there may cite none.
 */
const firstCitedHeading = "## Stage 5";

const drift = (text: string): readonly string[] => {
  const lines = text.split("\n");
  const firstCited = lines.findIndex((line) => line.startsWith(firstCitedHeading));
  if (firstCited < 0) return [`no "${firstCitedHeading}" heading`];
  const problems: string[] = [];
  lines.forEach((line, index) => {
    const mark = /^\s*- \[([ x])\] /.exec(line)?.[1];
    if (mark === undefined) return;
    const cited = /#\d+/.test(line.replace(/\(partial:[^)]*\)/g, ""));
    const label = line.replace(/^\s*- \[[ x]\] /, "").slice(0, 48);
    const at = String(index + 1);
    if (mark === "x" && !cited && index >= firstCited) problems.push(`ROADMAP.md:${at} is ticked but cites no pull request: ${label}`);
    if (mark === " " && cited) problems.push(`ROADMAP.md:${at} cites a pull request but is not ticked: ${label}`);
  });
  return problems;
};

describe("ROADMAP.md", () => {
  const text = readFileSync(join(root, "ROADMAP.md"), "utf8");

  it("ticks every line that cites a pull request on every stage, and cites one on every ticked line from Stage 5 on", () => {
    expect(drift(text)).toEqual([]);
  });

  it("fails a line that cites a pull request but stays open", () => {
    const planted = text.replace("- [x] A6 Truth pass", "- [ ] A6 Truth pass");
    expect(planted).not.toBe(text);
    expect(drift(planted).join("\n")).toMatch(/is not ticked: A6 Truth pass/);
  });

  it("fails an early-stage line that cites a pull request but is unticked, and lets one that cites none stay ticked", () => {
    const early = "- [x] Core: asset registry";
    expect(text).toContain(early);
    const unticked = text.replace(early, "- [ ] Core: asset registry");
    expect(drift(unticked).join("\n")).toMatch(/is not ticked: Core: asset registry/);
    const uncited = text.replace("removed in #36", "removed in the loader change");
    expect(uncited).not.toBe(text);
    expect(drift(uncited)).toEqual([]);
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

  it("ticks B1 with its pull requests, ticks C4 with the three that built it and lists the open follow-ups", () => {
    expect(text).toMatch(/- \[x\] B1 [^\n]*\(#46, #49, #50, #52\)/);
    expect(text).toMatch(/- \[x\] C4 [^\n]*stdio MCP server over the same operations[^\n]*\(#80, #81, #\d+\)/);
    expect(text).toMatch(/- \[[ x]\] A5 [^\n]*secure origin/);
    for (const follow of ["`preview` and `thumbnail` fields", "`e2e/` and the config files", "CI shards balanced by run time", "Icon packs as data"]) {
      expect(text).toMatch(new RegExp(`- \\[[ x]\\] [^\\n]*${follow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    }
  });

  it("leaves no internal step label in the file", () => {
    expect(text).not.toMatch(/\bW[0-9]+ ?G[0-9]+\b/);
  });
});
