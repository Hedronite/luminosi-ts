import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PackIcon } from "./PackIcon.js";

describe("PackIcon", () => {
  const icon = {
    id: "box",
    name: "Box",
    importName: "box",
    viewBox: "0 0 512 512",
    paint: { fill: "none", stroke: "currentColor", strokeWidth: "32" },
    paths: [{ d: "M0 0h10v10H0z", fill: "currentColor", fillRule: "evenodd" as const }],
  };

  it("is decorative unless titled, and keeps each path's paint", () => {
    expect(renderToStaticMarkup(<PackIcon icon={icon} />)).toContain('aria-hidden="true"');
    const html = renderToStaticMarkup(<PackIcon icon={icon} title="Box" size={40} />);
    expect(html).toMatch(/aria-labelledby="([^"]+)".*<title id="\1">Box<\/title>/);
    expect(html).toContain('width="40"');
    expect(html).toContain('fill-rule="evenodd"');
  });
});
