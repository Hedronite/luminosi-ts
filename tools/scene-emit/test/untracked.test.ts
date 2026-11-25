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
const here = fileURLToPath(new URL(".", import.meta.url));
const pkg = join(here, "..");
const root = join(pkg, "..", "..");
const scratch = ["out", "out-bad", "out-markup", "out-motion", "out-mount"] as const;

const git = (args: readonly string[]) => spawnSync("git", [...args], { cwd: root, encoding: "utf8" });

describe("the scratch the fixture tests write", () => {
  it("is ignored, so git sees nothing untracked while it is on disk", () => {
    for (const name of scratch) {
      expect(git(["check-ignore", join("tools", "scene-emit", name, "probe.tsx")]).status, `${name} is not ignored`).toBe(0);
      mkdirSync(join(pkg, name), { recursive: true });
      writeFileSync(join(pkg, name, "probe.tsx"), "export {};\n");
    }
    const listed = git(["ls-files", "--others", "--exclude-standard"]);
    for (const name of scratch) rmSync(join(pkg, name, "probe.tsx"), { force: true });
    expect(listed.status).toBe(0);
    expect(listed.stdout.trim()).toBe("");
  });
});
