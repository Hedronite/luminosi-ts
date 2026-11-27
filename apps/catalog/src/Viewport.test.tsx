import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Plant (R6 / G5): a detail viewport on `frameloop="always"` lets frames climb under reduced motion,
 * so `e2e/stage-quality.spec.ts` ("with every stage feature draws no frames of its own") fails on the detail view.
 */
describe("Viewport frameloop plant", () => {
  it("keeps the detail viewport on demand frameloop", () => {
    const source = readFileSync(join(import.meta.dirname, "Viewport.tsx"), "utf8");
    expect(source, "plant: frameloop always would fail reduced-motion stage-quality on the detail view").toContain(
      'frameloop="demand"',
    );
    expect(source).not.toMatch(/WebGPUCanvas[^>]*frameloop=\{?\s*["']always["']\s*\}?/);
  });
});