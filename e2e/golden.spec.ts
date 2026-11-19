// The golden-image check: each 3D asset, drawn by the still-frame rig, against the golden the rig drew for it (e2e/golden/<id>.png).
// Two projects run this file (playwright.config.ts): `golden` (bun run e2e:golden), strict, on the real GPU, never in CI; and
// `golden-loose` (bun run e2e:golden:loose), coarse, on software WebGL, which is what CI runs. Neither is in the default run.
// Besides the clean frame, each asset is drawn with four plants (a blank canvas, a recoloured subject, a missing part and a moved
// camera, applied to the page the rig drew) and the check must fail every one of them, in whichever mode it runs.
// GOLDEN_MEASURE=1 asserts none of the bars and only writes the distances (<report>/<mode>/<id>.json), for setting them; GOLDEN_FRAMES=<dir>
// also writes every frame it compared, for trying other measures offline. The report goes to GOLDEN_REPORT, test-results/golden by default.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadRegistry } from "@hedronite/lts-registry";
import { expect, test, type Page } from "@playwright/test";
import { decodePng } from "../tools/stills/src/png.js";
import { looseDistance, looseFails, strictDistance, strictFails } from "./golden/metrics.js";

const goldens = resolve(import.meta.dirname, "golden");
const measuring = process.env["GOLDEN_MEASURE"] === "1";
const report = resolve(process.env["GOLDEN_REPORT"] ?? join("test-results", "golden"));
const frames = process.env["GOLDEN_FRAMES"];

// Every asset the registry lists but the icons, as the rig captures them: a new asset has no golden until `bun run goldens` writes it, and fails until then.
const assets = loadRegistry()
  .list()
  .filter((meta) => meta.kind !== "icon");

const plants = ["blank canvas", "recoloured subject", "missing part", "moved camera"] as const;
type Plant = (typeof plants)[number];

/** Alters the page the rig drew, the way a regression would alter the picture. `clear` undoes it. */
async function plant(page: Page, what: Plant | "clear"): Promise<void> {
  await page.evaluate((change) => {
    const stage = document.querySelector<HTMLElement>('[data-testid="still"]');
    if (stage === null) throw new Error("the page has no still stage");
    const canvas = stage.querySelector("canvas");
    if (canvas === null) throw new Error("the still stage has no canvas");
    document.getElementById("plant")?.remove();
    canvas.style.visibility = "";
    canvas.style.filter = "";
    canvas.style.transform = "";
    if (change === "blank canvas") canvas.style.visibility = "hidden";
    if (change === "recoloured subject") canvas.style.filter = "sepia(1) hue-rotate(140deg) saturate(1.5)";
    // The camera a few degrees along: the picture shifted and a little larger.
    if (change === "moved camera") canvas.style.transform = "translate(16px, 10px) scale(1.04)";
    if (change === "missing part") {
      // A block of the middle of the stage painted over with the stage's own background.
      const block = document.createElement("div");
      block.id = "plant";
      block.style.cssText = "position:absolute;left:176px;top:176px;width:160px;height:160px;background:#f5f5f5";
      stage.append(block);
    }
  }, what);
}

test("every golden image belongs to an asset", () => {
  const known = new Set(assets.map((meta) => `${meta.id}.png`));
  const stray = readdirSync(goldens).filter((name) => name.endsWith(".png") && !known.has(name));
  expect(stray, "goldens with no asset in the registry: regenerate with bun run goldens").toEqual([]);
});

for (const asset of assets) {
  test(`${asset.id} (${asset.kind}) matches its golden and fails its plants`, async ({ page }, testInfo) => {
    const strict = testInfo.project.name === "golden";
    const file = join(goldens, `${asset.id}.png`);
    expect(existsSync(file), `no golden for ${asset.id}: bun run goldens writes it`).toBe(true);
    const golden = decodePng(readFileSync(file));

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
    expect(problems).toEqual([]);

    const fails = (distance: ReturnType<typeof strictDistance> | ReturnType<typeof looseDistance>): boolean => ("changedPixels" in distance ? strictFails(distance) : looseFails(distance));
    const measure = (frame: ReturnType<typeof decodePng>): ReturnType<typeof strictDistance> | ReturnType<typeof looseDistance> => (strict ? strictDistance(frame, golden) : looseDistance(frame, golden));
    const shoot = async (name: string): Promise<ReturnType<typeof decodePng>> => {
      const png = await stage.screenshot({ animations: "disabled" });
      if (frames !== undefined) {
        mkdirSync(frames, { recursive: true });
        writeFileSync(join(frames, `${asset.id}.${name}.png`), png);
      }
      return decodePng(png);
    };

    const clean = measure(await shoot("clean"));
    const results: Record<string, unknown> = { asset: asset.id, kind: asset.kind, mode: strict ? "strict" : "loose", clean };
    const missed: string[] = [];
    for (const what of plants) {
      // eslint-disable-next-line no-await-in-loop -- one page, one plant at a time
      await plant(page, what);
      // eslint-disable-next-line no-await-in-loop -- the picture is read before the next plant
      const planted = measure(await shoot(what.replaceAll(" ", "-")));
      results[what] = planted;
      if (!fails(planted)) missed.push(what);
    }
    await plant(page, "clear");

    const out = join(report, strict ? "strict" : "loose");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${asset.id}.json`), `${JSON.stringify(results)}\n`);

    if (measuring) return;
    expect(fails(clean), `${asset.id} no longer matches its golden: ${JSON.stringify(clean)}. If the change is intended, regenerate with bun run goldens and list this id in the PR`).toBe(false);
    expect(missed, `${asset.id}: the check passed these plants, which it must fail`).toEqual([]);
  });
}
