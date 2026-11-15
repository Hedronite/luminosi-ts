import { describe, expect, it } from "vitest";
import { firstUrl, humanize, parseCredit, parseDemoReadme, parseFrontMatter } from "./parse.js";

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
