import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseCredit, sourcePins } from "./parse.js";
import { archiveUrl, digestOf, filesUnder, hashed, isLicenseBearing, keeps, matchesGlob, parsePin, readPin, type Pin } from "./pin.js";
import { resolveVendor } from "./resolve.js";

const vendorDir = resolve(import.meta.dirname, "../../../assets/vendor");
const folders = readdirSync(vendorDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

const scratch: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "lts-pin-"));
  scratch.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const write = (dir: string, files: Readonly<Record<string, string>>): void => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
};

const commit = "6f56b8f1f665ce64c41506033b66ca67e2bc7724";
const hash = "a".repeat(64);
const good = {
  schema: 1,
  kept: false,
  sources: [{ source: "https://github.com/lucide-icons/lucide", commit, include: ["icons/*.svg", "LICENSE"] }],
  contentHash: hash,
};

describe("the pin's schema", () => {
  it("reads a fetchable pin and a kept one", () => {
    expect(parsePin(good, "x").kept).toBe(false);
    expect(parsePin({ schema: 1, kept: true, keptReason: "no repository and no archive upstream", source: "https://www.isocons.app/", version: "v2.1", contentHash: hash }, "x").kept).toBe(true);
  });

  it.each<[string, unknown]>([
    ["a short commit", { ...good, sources: [{ source: "https://github.com/a/b", commit: "6f56b8f1" }] }],
    ["a branch for a commit", { ...good, sources: [{ source: "https://github.com/a/b", commit: "main" }] }],
    ["an upper-case commit", { ...good, sources: [{ source: "https://github.com/a/b", commit: commit.toUpperCase() }] }],
    ["no hash", { schema: 1, kept: false, sources: good.sources }],
    ["a short hash", { ...good, contentHash: "abc" }],
    ["no sources", { ...good, sources: [] }],
    ["a source that is not a GitHub repository", { ...good, sources: [{ source: "https://example.com/a/b", commit }] }],
    ["a key it does not know", { ...good, note: "x" }],
    ["a kept pin with no reason", { schema: 1, kept: true, source: "https://www.isocons.app/", contentHash: hash }],
    ["a glob that climbs out", { ...good, sources: [{ source: "https://github.com/a/b", commit, exclude: ["../x"] }] }],
    ["a glob with a backslash", { ...good, sources: [{ source: "https://github.com/a/b", commit, include: ["a\\b"] }] }],
    ["an absolute glob", { ...good, sources: [{ source: "https://github.com/a/b", commit, include: ["/etc"] }] }],
    ["an empty include", { ...good, sources: [{ source: "https://github.com/a/b", commit, include: [] }] }],
    ["several sources without an `into` each", { ...good, sources: [{ source: "https://github.com/a/b", commit }, { source: "https://github.com/a/c", commit }] }],
    ["an overlay that climbs out", { ...good, overlay: ["../x"] }],
  ])("refuses %s", (_name, pin) => {
    expect(() => parsePin(pin, "assets/vendor/x/vendor.json")).toThrow(/assets\/vendor\/x\/vendor\.json/);
  });

  it("holds a folder of several repositories to one `into` each", () => {
    const several = { ...good, sources: [{ source: "https://github.com/a/b", commit, into: "b" }, { source: "https://github.com/a/c", commit, into: "c" }] };
    expect(parsePin(several, "x").kept).toBe(false);
    expect(() => parsePin({ ...good, sources: [{ source: "https://github.com/a/b", commit, into: "b" }, { source: "https://github.com/a/c", commit, into: "b" }] }, "x")).toThrow();
  });

  it("names the archive of a commit at GitHub's own address", () => {
    expect(archiveUrl(good.sources[0] ?? { source: "", commit })).toBe(`https://codeload.github.com/lucide-icons/lucide/tar.gz/${commit}`);
  });
});

describe("globs", () => {
  it.each([
    ["icons/*.svg", "icons/a.svg", true],
    ["icons/*.svg", "icons/sub/a.svg", false],
    ["icons/*.svg", "icons/a.json", false],
    ["LICENSE", "LICENSE", true],
    ["LICENSE", "sub/LICENSE", false],
    [".github/", ".github/workflows/ci.yml", true],
    [".github/", ".githubx/a", false],
    [".github/", "sub/.github/a", false],
    ["site/", "site/media/a.png", true],
    ["packages/duotone/src/**", "packages/duotone/src/a/b.tsx", true],
    ["packages/duotone/src/**", "packages/duotone/package.json", false],
    ["**/*.md", "a/b/c.md", true],
    ["**/*.md", "c.md", true],
    ["showcase/showroom/assets/*.glb", "showcase/showroom/assets/a.glb", true],
    ["showcase/showroom/assets/*.glb", "showcase/showroom/assets/a.glb.txt", false],
    ["a?c", "abc", true],
    ["a?c", "a/c", false],
    ["a.b", "axb", false],
  ])("%s matches %s: %s", (pattern, path, expected) => {
    expect(matchesGlob(pattern, path)).toBe(expected);
  });

  it("keeps what `include` names and `exclude` does not", () => {
    const source = { include: ["src/**", "LICENSE"], exclude: ["src/private/"] };
    expect(keeps(source, "src/a.ts")).toBe(true);
    expect(keeps(source, "LICENSE")).toBe(true);
    expect(keeps(source, "src/private/a.ts")).toBe(false);
    expect(keeps(source, "docs/a.md")).toBe(false);
    expect(keeps({}, "anything/at/all")).toBe(true);
    expect(keeps({ exclude: [".github/"] }, ".github/a.yml")).toBe(false);
  });
});

describe("the content hash", () => {
  const files = { "a.txt": "alpha\n", "dir/b.txt": "beta\n", LICENSE: "lic\n", "dir/LICENSE-MIT": "mit\n", "CREDIT.md": "credit", "vendor.json": "{}", ".DS_Store": "x", "dir/.DS_Store": "y" };

  it("is the sha256 of the `sha256  path` lines sorted by path, leaving out CREDIT.md, vendor.json, .DS_Store and the license-bearing files", () => {
    const dir = temp();
    write(dir, files);
    expect(digestOf(dir, false)).toEqual({ hash: "873cd7cf6ebf57074cebfebed9aca73ce883493a22052647def36a1cc28f4ea3", files: 2, bytes: 11 });
  });

  it("for a kept folder leaves out only CREDIT.md, vendor.json and .DS_Store (R10)", () => {
    const dir = temp();
    write(dir, files);
    expect(digestOf(dir, true)).toEqual({ hash: "ede930a54be9b37037243c8c74c7acea62821bca32d184eed474d89dce63a85a", files: 4, bytes: 19 });
  });

  it("does not move when a file is edited by a byte, added or renamed", () => {
    const dir = temp();
    write(dir, files);
    const before = digestOf(dir, false).hash;
    write(dir, { "a.txt": "alphb\n" });
    expect(digestOf(dir, false).hash).not.toBe(before);
    write(dir, { "a.txt": "alpha\n", "c.txt": "" });
    expect(digestOf(dir, false).hash).not.toBe(before);
    rmSync(join(dir, "c.txt"));
    expect(digestOf(dir, false).hash).toBe(before);
    write(dir, { LICENSE: "changed\n" });
    expect(digestOf(dir, false).hash).toBe(before);
  });

  it("refuses a link in a folder", () => {
    const dir = temp();
    write(dir, { "a.txt": "a" });
    symlinkSync(join(dir, "a.txt"), join(dir, "link.txt"));
    expect(() => filesUnder(dir)).toThrow(/not a file or a folder/);
  });

  it.each([
    ["LICENSE", true],
    ["LICENSE-APACHE", true],
    ["LICENSE.md", true],
    ["NOTICE", true],
    ["COPYING", true],
    ["THIRD_PARTY_NOTICES.md", true],
    ["ASSET-LICENSES.md", true],
    ["FONT-LICENSES.md", true],
    ["renderer/third_party/glamx/LICENSE-MIT", true],
    ["icons/copyright.svg", false],
    ["license.txt", false],
    ["README.md", false],
    ["docs/LICENSING.txt", false],
    ["src/licenses.ts", false],
  ])("%s is license-bearing: %s", (path, expected) => {
    expect(isLicenseBearing(path)).toBe(expected);
  });

  it("covers a path unless it is the folder's own, or license-bearing in a fetched folder", () => {
    expect(hashed("src/a.ts", false)).toBe(true);
    expect(hashed("CREDIT.md", false)).toBe(false);
    expect(hashed("sub/CREDIT.md", false)).toBe(true);
    expect(hashed("LICENSE", false)).toBe(false);
    expect(hashed("LICENSE", true)).toBe(true);
    expect(hashed("vendor.json", true)).toBe(false);
  });
});

// ---- the pins in the repository ---------------------------------------------------------------------------------------

/** The backticked paths a line of CREDIT.md lists. */
const ticks = (line: string): readonly string[] => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");

/** What disagrees between a pin and its folder's CREDIT.md, in words; empty when they agree. */
function creditProblems(folder: string, pin: Pin, creditText: string): readonly string[] {
  const problems: string[] = [];
  const credit = parseCredit(creditText, `${folder}/CREDIT.md`);
  const pins = sourcePins(credit.source);
  if (pin.kept) {
    const archives = pins.filter((one) => one.kind === "archive");
    if (archives.length !== 1 || archives[0]?.kind !== "archive" || archives[0].sha256 !== pin.contentHash) problems.push("the kept pin's hash is not the one CREDIT.md pins");
    return problems;
  }
  const commits = pins.filter((one) => one.kind === "commit");
  if (commits.length !== pin.sources.length) problems.push(`CREDIT.md pins ${String(commits.length)} commits, the pin has ${String(pin.sources.length)} sources`);
  for (const one of commits) {
    const match = pin.sources.filter((source) => source.commit.startsWith(one.commit) && (one.repo === undefined || source.into === one.repo || source.source.endsWith(`/${one.repo}`)));
    if (match.length !== 1) problems.push(`CREDIT.md's ${one.commit} is not the start of exactly one pinned commit`);
  }
  const kept = /^Kept as published: only (.+)\.$/m.exec(creditText);
  const include = new Set(pin.sources.flatMap((source) => source.include ?? []));
  const named = new Set(kept === null ? [] : ticks(kept[1] ?? ""));
  if ([...include].sort().join("\n") !== [...named].sort().join("\n")) problems.push("the paths the pin includes and the paths CREDIT.md says are kept differ");
  const exclude = new Set(pin.sources.flatMap((source) => source.exclude ?? []));
  const left = new Set(creditText.split("\n").filter((line) => line.startsWith("- ") && line.includes("left out")).flatMap(ticks));
  if ([...exclude].sort().join("\n") !== [...left].sort().join("\n")) problems.push("the paths the pin excludes and the paths CREDIT.md says are left out differ");
  for (const path of pin.overlay ?? []) if (!creditText.includes(`\`${path}\``)) problems.push(`the overlay ${path} is not named in CREDIT.md`);
  return problems;
}

const pinOf = (folder: string): Pin => {
  const pin = readPin(vendorDir, folder);
  if (pin === undefined) throw new Error(`assets/vendor/${folder} has no vendor.json`);
  return pin;
};
const creditOf = (folder: string): string => readFileSync(join(vendorDir, folder, "CREDIT.md"), "utf8");

describe("the pins in assets/vendor", () => {
  it("has the folders to check", () => {
    expect(folders.length).toBeGreaterThanOrEqual(11);
    expect(folders).toEqual(expect.arrayContaining(["isocons", "techartist", "threert", "lucide"]));
  });

  it.each(folders)("%s has a pin that reads", (folder) => {
    expect(pinOf(folder).contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps isocons, and only isocons, with its reason", () => {
    const kept = folders.filter((folder) => pinOf(folder).kept);
    expect(kept).toEqual(["isocons"]);
    expect(pinOf("isocons")).toMatchObject({ kept: true, version: "v2.1" });
  });

  it("holds techartist's three repositories in one pin", () => {
    const pin = pinOf("techartist");
    if (pin.kept) throw new Error("techartist is not kept");
    expect(pin.sources.map((source) => [source.source, source.into])).toEqual([
      ["https://github.com/iamtechartist/geometry-in-flux", "geometry-in-flux"],
      ["https://github.com/iamtechartist/bioluminescence", "bioluminescence"],
      ["https://github.com/iamtechartist/Threejs-3D-Webpage", "threejs-3d-webpage"],
    ]);
  });

  it.each(folders)("%s: pin and CREDIT.md agree, both ways (commits, kept paths, left-out paths, the overlay)", (folder) => {
    expect(creditProblems(folder, pinOf(folder), creditOf(folder))).toEqual([]);
  });

  it("fails a pin whose commit prefix is changed, one with a path CREDIT.md does not name, and a missing kept line", () => {
    const lucide = pinOf("lucide");
    if (lucide.kept) throw new Error("lucide is not kept");
    const [source] = lucide.sources;
    if (source === undefined) throw new Error("no source");
    const wrong: Pin = { ...lucide, sources: [{ ...source, commit: `0${source.commit.slice(1)}` }] };
    expect(creditProblems("lucide", wrong, creditOf("lucide")).join("; ")).toMatch(/not the start of exactly one pinned commit/);
    const extra: Pin = { ...lucide, sources: [{ ...source, include: [...(source.include ?? []), "docs/**"] }] };
    expect(creditProblems("lucide", extra, creditOf("lucide")).join("; ")).toMatch(/include.*differ/);
    expect(creditProblems("lucide", lucide, creditOf("lucide").replace(/^Kept as published:.*$/m, "")).join("; ")).toMatch(/include.*differ/);
    const threert = pinOf("threert");
    if (threert.kept) throw new Error("threert is not kept");
    const [one] = threert.sources;
    if (one === undefined) throw new Error("no source");
    const dropped: Pin = { ...threert, sources: [{ ...one, exclude: (one.exclude ?? []).filter((path) => path !== "site/") }] };
    expect(creditProblems("threert", dropped, creditOf("threert")).join("; ")).toMatch(/exclude.*differ/);
    const iso = pinOf("isocons");
    expect(creditProblems("isocons", { ...iso, contentHash: "0".repeat(64) }, creditOf("isocons")).join("; ")).toMatch(/hash/);
  });

  // The raw files come through the resolver, so this holds before the raw tree leaves the repository and after (from the cache): and with no cache and no raw files it fails, naming the fetch.
  it.each(folders)("%s: the files the resolver gives hash to the pin", (folder) => {
    const pin = pinOf(folder);
    const found = resolveVendor(folder, { vendorDir, env: process.env });
    if (!found.ok) throw new Error(found.error);
    const digest = digestOf(found.dir, pin.kept);
    expect(digest.hash).toBe(pin.contentHash);
    expect(digest.files).toBeGreaterThan(0);
  });

  it("every folder's license-bearing files stay in the repository", () => {
    for (const folder of folders) {
      const own = join(vendorDir, folder);
      expect(filesUnder(own).filter(isLicenseBearing).length, `${folder} keeps a license file`).toBeGreaterThan(0);
    }
  });
});
