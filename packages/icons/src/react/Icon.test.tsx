import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArrowRight, Check } from "./generated.js";

describe("icon components", () => {
  it("are decorative by default", () => {
    const html = renderToStaticMarkup(<ArrowRight />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<title");
  });

  it("are labelled by their title when given one", () => {
    const html = renderToStaticMarkup(<Check title="Saved" />);
    expect(html).toContain('role="img"');
    expect(html).toMatch(/aria-labelledby="([^"]+)".*<title id="\1">Saved<\/title>/);
  });

  it("pass size, stroke width and other SVG props through", () => {
    const html = renderToStaticMarkup(<Check size={40} strokeWidth={1.25} className="text-current" />);
    expect(html).toContain('width="40"');
    expect(html).toContain('stroke-width="1.25"');
    expect(html).toContain('class="text-current"');
  });
});
