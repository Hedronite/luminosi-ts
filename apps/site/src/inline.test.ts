import { describe, expect, it } from "vitest";
// The site inlines its scene document into `<lts-scene>`'s JSON script with `<` escaped (R24), so the text
// cannot close the script element from the inside. The escape is the same expression index.astro applies.
const inline = (document: unknown): string => JSON.stringify(document).replace(/</g, "\\u003c");

describe("the site's inlined scene document", () => {
  it("escapes < so the text cannot close the script element from the inside", () => {
    const hostile = { note: "</script><img src=x onerror=alert(1)>" };
    const text = inline(hostile);
    expect(text).not.toMatch(/<\/script/i);
    expect(text).toContain("\\u003c");
    // The escaped text reads back as the same document.
    expect(JSON.parse(text)).toEqual(hostile);
  });
});
