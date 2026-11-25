/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Every fixture project the tests in this folder write is their own scratch: out, out-bad, out-markup, out-motion and out-mount,
// made inside the package and removed again by the owning file's afterAll. .gitignore holds `tools/scene-emit/out*/`, so git
// never sees them, and that is worth more than tidiness: lumin-ui's diff scope reads `git ls-files --others --exclude-standard`
// and would take a scratch .tsx for an untracked UI file for as long as it is on disk, racing the afterAll that removes it.
//
// This file reads the five names and writes only into a folder of its own, under the same pattern: the others create and remove
// theirs in parallel, so writing into one of those would race their afterAll. It asks git about its own path alone, so a stray
// file elsewhere - in a parallel package or in a developer's clone - cannot fail it.
const here = fileURLToPath(new URL(".", import.meta.url));
const pkg = join(here, "..");
const root = join(pkg, "..", "..");
const scratch = ["out", "out-bad", "out-markup", "out-motion", "out-mount"] as const;
const own = `out-untracked-${process.pid}`;

const git = (args: readonly string[]) => spawnSync("git", [...args], { cwd: root, encoding: "utf8" });

describe("the scratch the fixture tests write", () => {
  it("is ignored, so git does not see it as untracked", () => {
    const dir = join(pkg, own);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "probe.tsx"), "export {};\n");
      for (const name of [...scratch, own]) {
        expect(git(["check-ignore", join("tools", "scene-emit", name, "probe.tsx")]).status, `${name} is not ignored`).toBe(0);
      }
      const listed = git(["ls-files", "--others", "--exclude-standard", "--", join("tools", "scene-emit", own)]);
      expect(listed.status).toBe(0);
      expect(listed.stdout.trim()).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
