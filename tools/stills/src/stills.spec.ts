// The still-frame rig's capture: one PNG per 3D asset of the registry. Run by `bun run stills` (the `stills` Playwright
// project, on a machine with a GPU, never in CI). The pictures land in STILLS_OUT, `test-results/stills` by default.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadRegistry } from "@hedronite/lts-registry";
import { expect, test } from "@playwright/test";
import { expectRenderer } from "../../../e2e/fixtures.js";
import { decodePng } from "./png.js";

const out = resolve(process.env["STILLS_OUT"] ?? "test-results/stills");
mkdirSync(out, { recursive: true });

// Every asset the registry lists but the icons, which are not drawn in 3D: a new asset is captured with no edit here.
const assets = loadRegistry()
  .list()
  .filter((meta) => meta.kind !== "icon");

for (const asset of assets) {
  test(`${asset.id} (${asset.kind})`, async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => {
      problems.push(error.message);
    });
    await page.goto(`/still.html?still=${encodeURIComponent(asset.id)}`);
    const stage = page.getByTestId("still");
    await expect(stage).toHaveAttribute("data-still", /^(ready|error)$/, { timeout: 60_000 });
    expect(await stage.getAttribute("data-error")).toBeNull();
    await expect(stage).toHaveAttribute("data-still", "ready");
    await expectRenderer(stage.locator("canvas"), ["webgpu"]);
    expect(problems).toEqual([]);
    const png = await stage.screenshot({ animations: "disabled" });
    const picture = decodePng(png);
    expect([picture.width, picture.height]).toEqual([512, 512]);
    writeFileSync(join(out, `${asset.id}.png`), png);
  });
}
