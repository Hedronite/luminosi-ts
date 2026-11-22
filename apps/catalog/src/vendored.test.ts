import { describe, expect, it } from "vitest";
import { commitUrl, formatBytes, mergePolicies, packFromSet, policyTitles, resolveLink, shortCommit } from "./vendored";

describe("resolveLink", () => {
  const repo = "https://github.com/jakubkrehel/skills";
  const pages = ["skills/better-ui/SKILL.md", "skills/better-ui/icons.md"];

  it("keeps absolute links", () => {
    expect(resolveLink("https://jakub.kr/", "README.md", { repo })).toEqual({ kind: "external", href: "https://jakub.kr/" });
  });

  it("opens a sibling page in the catalog", () => {
    expect(resolveLink("icons.md", "skills/better-ui/SKILL.md", { repo, pages })).toEqual({ kind: "page", path: "skills/better-ui/icons.md" });
    expect(resolveLink("./icons.md#sizes", "skills/better-ui/SKILL.md", { repo, pages })).toEqual({ kind: "page", path: "skills/better-ui/icons.md" });
  });

  it("sends other relative links to the file on GitHub, resolving ..", () => {
    expect(resolveLink("../better-colors/SKILL.md", "skills/better-ui/SKILL.md", { repo, pages })).toEqual({
      kind: "external",
      href: `${repo}/blob/HEAD/skills/better-colors/SKILL.md`,
    });
  });

  it("drops relative links with nowhere to go, anchors and other schemes", () => {
    expect(resolveLink("LICENSE", "README.md", {})).toEqual({ kind: "none" });
    expect(resolveLink("#install", "README.md", { repo })).toEqual({ kind: "none" });
    expect(resolveLink("javascript:alert(1)", "README.md", { repo })).toEqual({ kind: "none" });
  });
});

it("matches packs to their set by prefix and dash", () => {
  expect(packFromSet("stash-regular", "stash")).toBe(true);
  expect(packFromSet("lucide", "lucide")).toBe(true);
  expect(packFromSet("stashed", "stash")).toBe(false);
});

it("formats sizes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(36 * 1024)).toBe("36 KB");
  expect(formatBytes(91.4 * 1024 * 1024)).toBe("91 MB");
  expect(formatBytes(2.2 * 1024 * 1024)).toBe("2.2 MB");
});

it("links a source at its own commit, never at a branch", () => {
  expect(commitUrl({ repo: "https://github.com/coreui/coreui-icons", commit: "88d1cfc47fc3cc84114de2a01b04db11a941bdf9" })).toBe(
    "https://github.com/coreui/coreui-icons/tree/88d1cfc47fc3cc84114de2a01b04db11a941bdf9",
  );
  expect(shortCommit("88d1cfc47fc3cc84114de2a01b04db11a941bdf9")).toBe("88d1cfc4");
});
it("names every class of the license gate in words", () => {
  expect(policyTitles).toEqual({
    adopt: "adoptable",
    "adopt-with-attribution": "adoptable with attribution",
    "showcase-only": "showcase only",
    forbidden: "not adoptable",
  });
});

it("merges policy rows with the same class and license, adding their files", () => {
  expect(
    mergePolicies([
      { class: "adopt-with-attribution", spdx: "MIT", fileCount: 30 },
      { class: "adopt", spdx: "MIT", fileCount: 3 },
      { class: "adopt-with-attribution", spdx: "MIT", fileCount: 763 },
    ]),
  ).toEqual([
    { class: "adopt-with-attribution", spdx: "MIT", fileCount: 793 },
    { class: "adopt", spdx: "MIT", fileCount: 3 },
  ]);
});
