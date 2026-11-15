import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { reviewObject } from "img-to-object/review";

// The image-to-object review, end to end: a render of the desk lamp becomes the "reference", so a
// review of the same spec against it must line up almost exactly. That proves the framing (the
// reference's subject box) and the scoring (the forge's Divine Eye) agree.

const lamp = join(import.meta.dirname, "..", "assets/src/objects/your-desk-lamp.json");

test("a spec reviewed against its own render lines up", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), "lts-review-"));
  try {
    await page.route("**/review-spec.json", (route) => route.fulfill({ body: readFileSync(lamp, "utf8"), contentType: "application/json" }));
    await page.setViewportSize({ width: 360, height: 480 });
    await page.goto("/embed.html?spec=/review-spec.json&width=360&height=480&yaw=20&pitch=10");
    await expect
      .poll(() => page.evaluate(() => {
        const state: unknown = Reflect.get(window, "__ltsEmbed");
        return typeof state === "object" && state !== null && "status" in state ? String(state.status) : "missing";
      }), { timeout: 15_000 })
      .toBe("drawn");
    const reference = join(dir, "reference.png");
    await page.locator("canvas").screenshot({ path: reference });

    const result = await reviewObject({ spec: lamp, reference, out: join(dir, "review"), yaw: 20, pitch: 10 });
    const read = (source: unknown, key: string): unknown => (typeof source === "object" && source !== null ? Object.entries(source).find(([k]) => k === key)?.[1] : undefined);
    const signals = read(result.scores, "signals");
    expect(read(signals, "silhouetteIoU")).toBeGreaterThan(0.95);
    expect(read(signals, "scaleDelta")).toBeLessThan(0.02);
    expect(read(result.scores, "hardGateFailures")).toEqual([]);
    expect(result.reference.width).toBe(360);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
