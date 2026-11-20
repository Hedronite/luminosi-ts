import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { builds, expect, test } from "./fixtures.js";

/** How long a stage may take to draw: every wait below is on the stage's own counters, and this is only the ceiling that makes a stage that never draws fail. */
const STAGE_WAIT = 20_000;

/** How many reports of the stage's counters, one after another, must hold the same build count before it is called settled. */
const QUIET_REPORTS = 4;

/**
 * A stage's `data-builds` once it has settled: positive, and the same in each of its next few reports. The stage writes its counters on a timer
 * of its own, and each write sets the attribute, so the wait is counted in those writes and not in milliseconds: a slow machine takes longer to
 * reach them and does not read the count early. A stage that stops reporting, or never settles, fails after `STAGE_WAIT` with a message that says so.
 */
async function settledBuilds(host: Locator): Promise<number> {
  const result = await host.evaluate(
    (element, { quiet, ceiling }) =>
      new Promise<{ readonly builds: number; readonly settled: boolean; readonly reports: number }>((resolve) => {
        let last = -1;
        let held = 0;
        let reports = 0;
        const done = (settled: boolean): void => {
          observer.disconnect();
          clearTimeout(timer);
          resolve({ builds: last, settled, reports });
        };
        const observer = new MutationObserver(() => {
          reports += 1;
          const now = Number(element.getAttribute("data-builds"));
          held = now > 0 && now === last ? held + 1 : 0;
          last = now;
          if (held >= quiet) done(true);
        });
        const timer = setTimeout(() => {
          done(false);
        }, ceiling);
        observer.observe(element, { attributes: true, attributeFilter: ["data-builds"] });
      }),
    { quiet: QUIET_REPORTS, ceiling: STAGE_WAIT },
  );
  expect(result.settled, `the stage's build count did not settle: ${String(result.reports)} reports in ${String(STAGE_WAIT)} ms, the last of ${String(result.builds)}`).toBe(true);
  return result.builds;
}

test("the playground composes primitives and exports the scene", async ({ page }) => {
  await page.goto("/?view=playground");
  await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();
  const scene = page.getByRole("list", { name: "Scene" }).getByRole("listitem");
  // The count is read once the list has drawn its first item, so a slow machine does not read it empty.
  await expect(scene.first()).toBeVisible();
  const before = await scene.count();
  const viewport = page.getByTestId("playground-viewport");
  await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  const built = await settledBuilds(viewport);

  await page.getByLabel("Primitive", { exact: true }).selectOption("hexagonal-bipyramid");
  await page.getByLabel("Surface", { exact: true }).selectOption("glass");
  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(scene).toHaveCount(before + 1);

  // The counter's positive control in the playground: an added node is a new build.
  await expect.poll(() => builds(viewport), { message: "builds after an add", timeout: STAGE_WAIT }).toBeGreaterThan(built);
  await expect(page.getByRole("region", { name: "JSON export" }).locator("code")).toContainText('"kind": "primitive", "id": "hexagonal-bipyramid"');
  await expect(page.getByRole("region", { name: "React export" }).locator("code")).toContainText('<PrimitiveMesh primitive="hexagonal-bipyramid" material="glass"');
  await expect(page.getByRole("region", { name: "Vanilla export" }).locator("code")).toContainText('createPolyhedronGeometry(primitive("hexagonal-bipyramid")');
  await expect(page.getByTestId("playground-viewport")).toHaveAttribute("data-frames", /^[1-9]\d*$/);

  await page.getByRole("button", { name: "Remove Hexagonal bipyramid, Glass" }).click();
  await expect(scene).toHaveCount(before);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("the playground lines up every material on one shape", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?view=playground");
  const lineup = page.getByTestId("material-lineup");
  await lineup.scrollIntoViewIfNeeded();
  await expect(page.getByRole("list", { name: "Materials in the lineup" }).getByRole("listitem")).toHaveCount(13);
  // Thirteen materials, transmission among them, compile slowly under software rendering in CI.
  await expect(lineup).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  // One shared shape: a single geometry however many materials.
  await expect(lineup).toHaveAttribute("data-gpu-geometries", "1");
  await page.getByLabel("Shape", { exact: true }).selectOption("platonic-icosahedron");
  await expect(page.getByRole("group", { name: "13 materials on the Icosahedron shape, in a grid." })).toBeVisible();
  expect(errors).toEqual([]);
});

// Opening, saving, sharing and undoing. Each test below is one short page: a runner that draws in software takes most of a minute for a long one.

const things = (page: Page): Locator => page.getByRole("list", { name: "Scene" }).getByRole("listitem");
const exported = (page: Page): Locator => page.getByRole("region", { name: "JSON export" }).locator("code");
const undo = (page: Page): Locator => page.getByRole("button", { name: "Undo", exact: true });
const redo = (page: Page): Locator => page.getByRole("button", { name: "Redo", exact: true });
const openInput = (page: Page): Locator => page.getByLabel("Open scene");
const problems = (page: Page): Locator => page.getByRole("alert");

/** The playground at `address`, once its starter scene is listed: the JSON export it shows. */
async function playgroundAt(page: Page, address = "/?view=playground"): Promise<string> {
  await page.goto(address);
  await expect(things(page)).toHaveCount(3);
  return (await exported(page).textContent()) ?? "";
}

/** The page's JSON export as a document with `change` applied, as a file's bytes. */
async function fileWith(page: Page, change: (doc: { nodes: unknown[] }) => void): Promise<Buffer> {
  const doc: { nodes: unknown[] } = JSON.parse((await exported(page).textContent()) ?? "{}");
  change(doc);
  return Buffer.from(JSON.stringify(doc), "utf8");
}

const sceneFile = (name: string, buffer: Buffer): { name: string; mimeType: string; buffer: Buffer } => ({ name, mimeType: "application/json", buffer });

test("opening a scene file replaces the document in one step that undo takes back", async ({ page }) => {
  const start = await playgroundAt(page);
  await expect(undo(page)).toBeDisabled();
  const pair = await fileWith(page, (doc) => {
    doc.nodes = doc.nodes.slice(0, 2);
  });
  await openInput(page).setInputFiles(sceneFile("pair.lts-scene.json", pair));
  await expect(things(page)).toHaveCount(2);
  await expect(page.getByText("Opened pair.lts-scene.json: 2 things.")).toBeVisible();
  await expect(exported(page)).not.toHaveText(start);
  await expect(undo(page)).toBeEnabled();
  await undo(page).click();
  await expect(things(page)).toHaveCount(3);
  await expect(exported(page)).toHaveText(start);
  await expect(undo(page)).toBeDisabled();
});

test("a file that is not a scene, one that names what the library lacks, and one over the node cap are each refused with their issues and leave the document alone", async ({ page }) => {
  const start = await playgroundAt(page);
  await openInput(page).setInputFiles(sceneFile("broken.json", Buffer.from("{ not json")));
  await expect(problems(page)).toContainText("This is not a scene document");

  const ghost = await fileWith(page, (doc) => {
    const first = doc.nodes[0] as { asset: { id: string } };
    first.asset.id = "no-such-solid";
  });
  await openInput(page).setInputFiles(sceneFile("ghost.json", ghost));
  await expect(problems(page)).toContainText("nodes.0.asset.id: no primitive named");

  // Over the cap is refused by name, never cut down to fit.
  const many = await fileWith(page, (doc) => {
    doc.nodes = Array.from({ length: 9 }, (_, index) => ({ ...(doc.nodes[0] as object), id: `n-${String(index)}` }));
  });
  await openInput(page).setInputFiles(sceneFile("many.json", many));
  await expect(problems(page)).toContainText("at most 8 things, and this scene has 9");

  await expect(things(page)).toHaveCount(3);
  await expect(exported(page)).toHaveText(start);
  await expect(undo(page)).toBeDisabled();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("saving downloads the JSON export under the scene's name, and opening that file gives the same document", async ({ page }) => {
  const start = await playgroundAt(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("scene.lts-scene.json");
  const path = await saved.path();
  expect(await readFile(path, "utf8")).toBe(start);

  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(things(page)).toHaveCount(4);
  await openInput(page).setInputFiles(path);
  await expect(things(page)).toHaveCount(3);
  await expect(exported(page)).toHaveText(start);
});

test("a shared link opens an equal document in a new page, and the link is gone from the address once another view opens", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await playgroundAt(page);
  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(things(page)).toHaveCount(4);
  const shown = (await exported(page).textContent()) ?? "";
  await page.getByRole("button", { name: /^Copy: share link/ }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("?view=playground&scene=s1.");
  // One stage draws at a time: this page's is done with.
  await page.close();

  const other = await context.newPage();
  await other.bringToFront();
  await other.goto(link);
  await expect(things(other)).toHaveCount(4);
  await expect(exported(other)).toHaveText(shown);
  await other.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Effects", exact: true }).click();
  await expect(other).not.toHaveURL(/scene=/);
});

for (const [what, link] of [
  ["not base64url", "s1.@@@"],
  ["not deflate", "s1.zzzz"],
  ["not a link", "hello"],
] as const) {
  test(`a bad link (${what}) shows its issues over the starter scene`, async ({ page }) => {
    const start = await playgroundAt(page, `/?view=playground&scene=${link}`);
    await expect(problems(page)).toBeVisible();
    await expect(things(page)).toHaveCount(3);
    await expect(exported(page)).toHaveText(start);
  });
}

test("undo and redo buttons step back through an add, an effect and an ink, and the look and the add form are not steps", async ({ page }) => {
  await playgroundAt(page);
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeDisabled();
  // The add form and the look are not changes to the document.
  await page.getByLabel("Primitive", { exact: true }).selectOption("platonic-icosahedron");
  await page.getByLabel("Look").selectOption("hedronite");
  await expect(undo(page)).toBeDisabled();
  // The export shows the viewer's look, so the document to come back to is read in it.
  const start = (await exported(page).textContent()) ?? "";

  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(things(page)).toHaveCount(4);
  const added = (await exported(page).textContent()) ?? "";
  await page.getByRole("checkbox", { name: "Dither" }).check();
  await expect(exported(page)).not.toHaveText(added);
  const dithered = (await exported(page).textContent()) ?? "";
  await page.getByLabel("Ink", { exact: true }).selectOption("accent");
  await expect(exported(page)).not.toHaveText(dithered);

  await undo(page).click();
  await expect(exported(page)).toHaveText(dithered);
  await undo(page).click();
  await expect(exported(page)).toHaveText(added);
  await undo(page).click();
  await expect(exported(page)).toHaveText(start);
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeEnabled();
  await redo(page).click();
  await expect(exported(page)).toHaveText(added);
});

test("one run of key presses on the light slider is one step, a remove is a step, and undo takes both back", async ({ page }) => {
  const start = await playgroundAt(page);
  await page.getByRole("slider").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(exported(page)).not.toHaveText(start);
  const lit = (await exported(page).textContent()) ?? "";
  await page.getByRole("button", { name: /^Remove / }).first().click();
  await expect(things(page)).toHaveCount(2);

  await undo(page).click();
  await expect(things(page)).toHaveCount(3);
  await expect(exported(page)).toHaveText(lit);
  await undo(page).click();
  await expect(exported(page)).toHaveText(start);
  await expect(undo(page)).toBeDisabled();
});

test("Ctrl+Z, Shift+Ctrl+Z and Ctrl+Y undo and redo outside a text field, and a new change drops what was undone", async ({ page }) => {
  const start = await playgroundAt(page);
  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(things(page)).toHaveCount(4);
  const added = (await exported(page).textContent()) ?? "";
  await page.getByRole("checkbox", { name: "Dither" }).check();
  await expect(exported(page)).not.toHaveText(added);
  const end = (await exported(page).textContent()) ?? "";

  await page.keyboard.press("Control+z");
  await expect(exported(page)).toHaveText(added);
  await page.keyboard.press("Control+z");
  await expect(exported(page)).toHaveText(start);
  await page.keyboard.press("Control+Shift+Z");
  await expect(exported(page)).toHaveText(added);
  await page.keyboard.press("Control+y");
  await expect(exported(page)).toHaveText(end);
  await expect(redo(page)).toBeDisabled();

  await page.keyboard.press("Control+z");
  await expect(redo(page)).toBeEnabled();
  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(redo(page)).toBeDisabled();
});

test("Ctrl+Z in a field that takes text is the browser's own and leaves the document alone", async ({ page }) => {
  await playgroundAt(page);
  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(things(page)).toHaveCount(4);
  const kept = (await exported(page).textContent()) ?? "";
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "text";
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press("Control+z");
  // The key is handled, if it were, before the next frame; the document has not moved.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(things(page)).toHaveCount(4);
  await expect(exported(page)).toHaveText(kept);
});
