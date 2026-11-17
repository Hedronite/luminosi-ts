import { describe, expect, it } from "vitest";
import { firstUrl, humanize, parseCredit, parseDemoReadme, parseFrontMatter, requirePin, sourcePins } from "./parse.js";

const credit = `# Credit

- **What:** Lucide icons (1,808 SVGs)
- **Source:** https://github.com/lucide-icons/lucide
- **License:** ISC (\`LICENSE\`)
- **Credit:** Lucide Icons and contributors
- **Pulled:** 2026-08

Vendored into LuminosiTS as published.
`;

describe("parseCredit", () => {
  it("reads the five fields every CREDIT.md carries", () => {
    expect(parseCredit(credit, "lucide")).toEqual({
      what: "Lucide icons (1,808 SVGs)",
      source: "https://github.com/lucide-icons/lucide",
      license: "ISC (`LICENSE`)",
      credit: "Lucide Icons and contributors",
      pulled: "2026-08",
    });
  });

  it("names the field that is missing", () => {
    expect(() => parseCredit(credit.replace(/^- \*\*Credit:.*$/m, ""), "lucide/CREDIT.md")).toThrow('lucide/CREDIT.md: no "credit" line');
  });
});

describe("firstUrl", () => {
  it("takes the URL and leaves what follows it", () => {
    expect(firstUrl("https://github.com/elayadesign/ai-design-skills (`456d9e0d`)")).toBe("https://github.com/elayadesign/ai-design-skills");
    expect(firstUrl("no link here")).toBeUndefined();
  });
});

describe("parseFrontMatter", () => {
  it("splits one-line fields from the body and unquotes values", () => {
    const { fields, body } = parseFrontMatter('---\nname: better-ui\ndescription: "Improves UI: radius, hit areas."\n---\n\n# UI\n');
    expect(Object.fromEntries(fields)).toEqual({ name: "better-ui", description: "Improves UI: radius, hit areas." });
    expect(body).toBe("\n# UI\n");
  });

  it("leaves Markdown without front matter as it is", () => {
    expect(parseFrontMatter("# Title\n").body).toBe("# Title\n");
  });
});

describe("parseDemoReadme", () => {
  it("separates the description from the live demo link, whatever its case", () => {
    expect(parseDemoReadme("A sculpture that unfolds.\n\nLive Demo: https://iamtechartist.github.io/Threejs-3D-Webpage/\n")).toEqual({
      description: "A sculpture that unfolds.",
      live: "https://iamtechartist.github.io/Threejs-3D-Webpage/",
    });
    expect(parseDemoReadme("Just words.").live).toBeUndefined();
  });
});

it("humanizes ids", () => {
  expect(humanize("geometry-in-flux")).toBe("Geometry in flux");
});

describe("pins", () => {
  const commit = "4df8e67ab6584b3c354f06f0f9ce9a4348f82dbe";
  const hash = "a".repeat(64);

  it("reads a commit, short or full, and each commit of a multi-repository source", () => {
    expect(sourcePins("https://github.com/ttillberg/codevember-2026 (`4df8e67a`)")).toEqual([{ kind: "commit", commit: "4df8e67a" }]);
    expect(sourcePins(`https://example.org/ (\`${commit}\`, \`${commit.slice(0, 12)}\`)`)).toHaveLength(2);
  });

  it("reads a version with the folder's hash", () => {
    expect(sourcePins(`https://www.isocons.app/ (v2.1, \`sha256:${hash}\`)`)).toEqual([{ kind: "archive", version: "2.1", sha256: hash }]);
  });

  it.each([
    ["no pin", "https://github.com/lucide-icons/lucide"],
    ["a branch name", "https://github.com/lucide-icons/lucide (`main`)"],
    ["latest", "https://github.com/lucide-icons/lucide (latest)"],
    ["a bare version", "https://www.isocons.app/ (v2.1)"],
    ["a commit too short", "https://github.com/lucide-icons/lucide (`4df8e67`)"],
    ["a commit not in backticks", `https://github.com/lucide-icons/lucide (${commit})`],
    ["a hash of the wrong length", "https://www.isocons.app/ (v2.1, `sha256:abc123`)"],
  ])("rejects %s", (_name, source) => {
    expect(() => requirePin(source, "lucide/CREDIT.md")).toThrow("lucide/CREDIT.md: the source line has no pin");
  });
});
