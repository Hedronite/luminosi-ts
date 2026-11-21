import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { filesUnder, parsePin, readPin, type Pin } from "./pin.js";
import { adoptable, classify, coverageProblems, entryFor, originProblem, POLICY, ruleOf } from "./policy.js";
import { resolveVendor } from "./resolve.js";

const vendorDir = resolve(import.meta.dirname, "../../../assets/vendor");
const folders = readdirSync(vendorDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

const pinOf = (folder: string): Pin => {
  const pin = readPin(vendorDir, folder);
  if (pin === undefined) throw new Error(`assets/vendor/${folder} has no vendor.json`);
  return pin;
};

/** The files of a folder as the policy sees them: every raw file, through the resolver (so it fails with `not_fetched` when there is none), CREDIT.md and vendor.json aside. */
function filesOf(folder: string): readonly string[] {
  const found = resolveVendor(folder, { vendorDir, env: process.env });
  if (!found.ok) throw new Error(found.error);
  return filesUnder(found.dir).filter((path) => path !== "CREDIT.md" && path !== "vendor.json");
}

const hash = "a".repeat(64);
const commit = "0123456789abcdef0123456789abcdef01234567";
const pinWith = (licenses: unknown): Pin => parsePin({ schema: 1, kept: false, sources: [{ source: "https://github.com/a/b", commit }], contentHash: hash, ...(licenses === undefined ? {} : { licenses }) }, "x");

describe("the policy table", () => {
  it("gives every license one of the four classes and a one-line reason", () => {
    expect(Object.keys(POLICY).length).toBeGreaterThanOrEqual(10);
    const classes = new Set(["adopt", "adopt-with-attribution", "showcase-only", "forbidden"]);
    const bad = Object.entries(POLICY).filter(([, entry]) => !classes.has(entry.class) || entry.reason.length <= 10 || entry.reason.includes("\n")).map(([id]) => id);
    expect(bad).toEqual([]);
  });

  it.each([
    ["CC0-1.0", "adopt"],
    ["LicenseRef-PublicDomain", "adopt"],
    ["MIT", "adopt-with-attribution"],
    ["ISC", "adopt-with-attribution"],
    ["Apache-2.0", "adopt-with-attribution"],
    ["BSD-3-Clause", "adopt-with-attribution"],
    ["CC-BY-4.0", "adopt-with-attribution"],
    ["OFL-1.1", "showcase-only"],
    ["LicenseRef-ThirdPartyScreenshots", "showcase-only"],
    ["GPL-3.0-only", "forbidden"],
    ["AGPL-3.0-or-later", "forbidden"],
    ["CC-BY-NC-4.0", "forbidden"],
    ["Frobnicate-1.0", "forbidden"],
  ])("%s is %s", (id, expected) => {
    expect(classify(id).class).toBe(expected);
  });

  it("refuses what it does not know, and says it does not know it", () => {
    expect(classify("Frobnicate-1.0").unknown).toEqual(["Frobnicate-1.0"]);
    expect(classify("GPL-3.0-only").unknown).toEqual([]);
    expect(classify("MIT").unknown).toEqual([]);
  });

  it.each([
    ["MIT OR Apache-2.0", "adopt-with-attribution"],
    ["MIT OR CC0-1.0", "adopt"],
    ["MIT OR GPL-2.0-only", "adopt-with-attribution"],
    ["MIT AND OFL-1.1", "showcase-only"],
    ["MIT AND CC0-1.0", "adopt-with-attribution"],
    ["(MIT AND OFL-1.1) OR CC0-1.0", "adopt"],
    ["MIT AND (OFL-1.1 OR GPL-3.0-only)", "showcase-only"],
    ["GPL-2.0-only WITH Classpath-exception-2.0", "forbidden"],
    ["MIT WITH Some-exception", "adopt-with-attribution"],
    ["Apache-2.0+", "adopt-with-attribution"],
  ])("the expression %s is %s: OR the most permissive, AND the most restrictive, WITH its base", (expression, expected) => {
    expect(classify(expression).class).toBe(expected);
  });

  it.each(["", "MIT OR", "(MIT", "MIT)", "AND MIT", "MIT MIT", "MIT WITH", "MIT WITH OR"])("does not read %j as an expression", (expression) => {
    expect(() => classify(expression)).toThrow(/not an SPDX license expression/);
  });
});

describe("a pin's licenses, path by path", () => {
  const licenses = [
    { spdx: "OFL-1.1", paths: ["fonts/**"] },
    { spdx: "CC0-1.0", paths: ["media/*.png"] },
    { spdx: "MIT", remainder: true },
  ];
  const files = ["src/a.ts", "fonts/a.woff2", "fonts/deep/b.woff2", "media/a.png", "media/a.txt", "LICENSE"];

  it("names the entry a path is in: an entry that names it, else the remainder", () => {
    const pin = pinWith(licenses);
    expect(ruleOf(pin, "fonts/deep/b.woff2")).toMatchObject({ spdx: "OFL-1.1", class: "showcase-only", covers: "fonts/**" });
    expect(ruleOf(pin, "media/a.png")).toMatchObject({ spdx: "CC0-1.0", class: "adopt" });
    expect(ruleOf(pin, "media/a.txt")).toMatchObject({ spdx: "MIT", class: "adopt-with-attribution", covers: "remainder" });
    expect(entryFor(pinWith(licenses).licenses ?? [], "src/a.ts")?.remainder).toBe(true);
    expect(ruleOf(pinWith([{ spdx: "MIT", paths: ["a/**"] }]), "b/c")).toBeUndefined();
    expect(ruleOf(pinWith(undefined), "src/a.ts")).toBeUndefined();
    expect(ruleOf(undefined, "src/a.ts")).toBeUndefined();
  });

  it("says which rules let a file be ported", () => {
    const pin = pinWith(licenses);
    expect(adoptable(ruleOf(pin, "src/a.ts") ?? { spdx: "", class: "forbidden", reason: "", covers: "" })).toBe(true);
    expect(adoptable(ruleOf(pin, "fonts/a.woff2") ?? { spdx: "", class: "adopt", reason: "", covers: "" })).toBe(false);
  });

  it("finds nothing wrong with licenses that cover every file once", () => {
    expect(coverageProblems("demo", pinWith(licenses), files)).toEqual([]);
  });

  it("fails a license the policy does not know", () => {
    expect(coverageProblems("demo", pinWith([{ spdx: "Frobnicate-1.0", remainder: true }]), files).join("\n")).toMatch(/Frobnicate-1\.0 is not in the license policy/);
    expect(coverageProblems("demo", pinWith([{ spdx: "MIT AND Frobnicate-1.0", remainder: true }]), files).join("\n")).toMatch(/Frobnicate-1\.0 is not in the license policy/);
    expect(coverageProblems("demo", pinWith([{ spdx: "MIT OR", remainder: true }]), files).join("\n")).toMatch(/not an SPDX license expression/);
  });

  it("fails a folder with no licenses", () => {
    expect(coverageProblems("demo", pinWith(undefined), files).join("\n")).toMatch(/no licenses/);
  });

  it("fails a path two entries name", () => {
    const twice = [{ spdx: "MIT", paths: ["src/**", "LICENSE"] }, { spdx: "ISC", paths: ["src/a.ts"] }, { spdx: "CC0-1.0", remainder: true }];
    expect(coverageProblems("demo", pinWith(twice), files).join("\n")).toMatch(/covered by two entries: src\/a\.ts \(MIT and ISC\)/);
  });

  it("fails a path no entry covers, an entry that names no file, and a second remainder", () => {
    expect(coverageProblems("demo", pinWith([{ spdx: "MIT", paths: ["src/**"] }]), files).join("\n")).toMatch(/covered by no entry/);
    expect(coverageProblems("demo", pinWith([...licenses, { spdx: "ISC", paths: ["nothing/**"] }]), files).join("\n")).toMatch(/ISC entry for nothing\/\*\* matches no file/);
    expect(coverageProblems("demo", pinWith([...licenses, { spdx: "ISC", remainder: true }]), files).join("\n")).toMatch(/more than one remainder/);
  });

  it("does not read an entry that is both paths and the remainder, or neither", () => {
    expect(() => pinWith([{ spdx: "MIT", paths: ["a"], remainder: true }])).toThrow(/paths.*remainder/);
    expect(() => pinWith([{ spdx: "MIT" }])).toThrow(/paths.*remainder/);
  });
});

describe("the pins in assets/vendor", () => {
  it.each(folders)("%s: licenses that the policy knows, covering every file of the folder once", (folder) => {
    const files = filesOf(folder);
    expect(files.length).toBeGreaterThan(0);
    expect(coverageProblems(folder, pinOf(folder), files)).toEqual([]);
  });

  it("is where a license says it is: the fonts, the screenshots, the public-domain and CC0 media, the dual and Apache parts, the Feather icons", () => {
    const at = (folder: string, path: string) => ruleOf(pinOf(folder), path);
    expect(at("threeui", "src/shaders/fonts/fragment-mono.woff2")).toMatchObject({ spdx: "OFL-1.1", class: "showcase-only" });
    expect(at("threeui", "public/sketchbook/newsreader.woff2")).toMatchObject({ class: "showcase-only" });
    expect(at("threeui", "src/shaders/crt/crtShaders.ts")).toMatchObject({ spdx: "MIT", class: "adopt-with-attribution" });
    expect(at("coreui-icons", "svg/free/cil-3d.svg")).toMatchObject({ spdx: "CC-BY-4.0" });
    expect(at("coreui-icons", "README.md")).toMatchObject({ spdx: "MIT" });
    expect(at("lucide", "icons/airplay.svg")).toMatchObject({ spdx: "MIT" });
    expect(at("lucide", "icons/house.svg")).toMatchObject({ spdx: "ISC" });
    expect(at("isocons", "LICENSE")).toMatchObject({ spdx: "CC-BY-4.0" });
    expect(at("codevember-2026", "06/blender/src/wright-orrery-full.jpg")).toMatchObject({ spdx: "LicenseRef-PublicDomain", class: "adopt" });
    expect(at("codevember-2026", "06/src/App.tsx")).toMatchObject({ spdx: "MIT" });
    expect(at("threert", "renderer/third_party/parry3d/LICENSE")).toMatchObject({ spdx: "Apache-2.0" });
    expect(at("threert", "renderer/third_party/glamx/src/core.ts")).toMatchObject({ spdx: "MIT OR Apache-2.0", class: "adopt-with-attribution" });
    expect(at("threert", "tools/city/README.md")).toMatchObject({ spdx: "MIT" });
    expect(at("threert", "showcase/museum/assets/lion_head_1k.glb")).toMatchObject({ spdx: "CC0-1.0", class: "adopt" });
    expect(at("threert", "showcase/daylight-home/assets/Sofa_01_1k.glb")).toMatchObject({ spdx: "CC0-1.0" });
    expect(at("threert", "showcase/moon-phases/assets/moon_lroc_2k.jpg")).toMatchObject({ spdx: "LicenseRef-PublicDomain" });
    expect(at("threert", "docs/img/tokyo-shinjuku-day.jpg")).toMatchObject({ spdx: "LicenseRef-ThirdPartyScreenshots", class: "showcase-only" });
    expect(at("threert", "docs/images/reel.webp")).toMatchObject({ class: "showcase-only" });
    expect(at("threert", "package-lock.json")).toMatchObject({ spdx: "MIT" });
  });

  it("fails the plants: a pin with an unknown license, a folder with no licenses, two entries covering one path", () => {
    const folder = "threeui";
    const files = filesOf(folder);
    const real = pinOf(folder);
    const unknown = parsePin({ ...real, licenses: [{ spdx: "Frobnicate-1.0", remainder: true }] }, folder);
    expect(coverageProblems(folder, unknown, files).join("\n")).toMatch(/not in the license policy/);
    const bare = Object.fromEntries(Object.entries(real).filter(([key]) => key !== "licenses"));
    expect(coverageProblems(folder, parsePin(bare, folder), files).join("\n")).toMatch(/no licenses/);
    const twice = parsePin({ ...real, licenses: [...(real.licenses ?? []), { spdx: "ISC", paths: ["src/shaders/**"] }] }, folder);
    expect(coverageProblems(folder, twice, files).join("\n")).toMatch(/covered by two entries/);
  });
});

describe("an asset's origin against the policy", () => {
  const threeui = (): Pin => pinOf("threeui");

  it("lets a port or an adoption come from an adoptable path, and refuses one from a showcase-only path", () => {
    expect(originProblem(threeui(), { vendor: "threeui", relation: "ported", path: "src/shaders/crt/crtShaders.ts" })).toBeUndefined();
    expect(originProblem(threeui(), { vendor: "threeui", relation: "adopted", path: "src/shaders/crt/crtShaders.ts" })).toBeUndefined();
    expect(originProblem(threeui(), { vendor: "threeui", relation: "ported", path: "src/shaders/fonts/fragment-mono.woff2" })).toMatch(/is ported but is under OFL-1\.1, which is showcase-only/);
    expect(originProblem(threeui(), { vendor: "threeui", relation: "adopted", path: "src/shaders/fonts/fragment-mono.woff2" })).toMatch(/showcase-only/);
  });

  it("lets work only inspired by another pass, unless the path is forbidden outright", () => {
    expect(originProblem(threeui(), { vendor: "threeui", relation: "inspired", path: "src/shaders/fonts/fragment-mono.woff2" })).toBeUndefined();
    const forbidden = pinWith([{ spdx: "GPL-3.0-only", remainder: true }]);
    expect(originProblem(forbidden, { vendor: "demo", relation: "inspired", path: "a/b.ts" })).toMatch(/forbidden/);
    expect(originProblem(forbidden, { vendor: "demo", relation: "ported", path: "a/b.ts" })).toMatch(/forbidden/);
  });

  it("refuses a path no rule covers, and a folder with no pin", () => {
    expect(originProblem(pinWith([{ spdx: "MIT", paths: ["a/**"] }]), { vendor: "demo", relation: "ported", path: "b/c.ts" })).toMatch(/no license rule/);
    expect(originProblem(undefined, { vendor: "demo", relation: "inspired", path: "b/c.ts" })).toMatch(/no license rule/);
  });
});
