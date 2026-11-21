import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { ringLayout } from "../packages/scene/src/layout.js";
import { builds, counted, effectBuilds, expect, expectRenderer, test } from "./fixtures.js";

/** How long a stage may take to draw: every wait below is on the stage's own counters, and this is only the ceiling that makes a stage that never draws fail. */
const STAGE_WAIT = 20_000;

/** How many reports of the stage's counters, one after another, must hold the same value before it is called settled. */
const QUIET_REPORTS = 4;

/**
 * A stage counter's value once it has settled: positive, and the same in each of its next few reports. The stage writes its counters on a timer
 * of its own and each write sets the attribute, so the wait is counted in those writes and not in milliseconds. Bounded: a stage that stops
 * reporting, or never settles, fails after `STAGE_WAIT` with a message that says so.
 */
async function settled(host: Locator, attribute: string): Promise<number> {
  const result = await host.evaluate(
    (element, { name, quiet, ceiling }) =>
      new Promise<{ readonly value: number; readonly settled: boolean; readonly reports: number }>((resolve) => {
        let last = -1;
        let held = 0;
        let reports = 0;
        const done = (ok: boolean): void => {
          observer.disconnect();
          clearTimeout(timer);
          resolve({ value: last, settled: ok, reports });
        };
        const observer = new MutationObserver(() => {
          reports += 1;
          const now = Number(element.getAttribute(name));
          held = now > 0 && now === last ? held + 1 : 0;
          last = now;
          if (held >= quiet) done(true);
        });
        const timer = setTimeout(() => {
          done(false);
        }, ceiling);
        observer.observe(element, { attributes: true, attributeFilter: [name] });
      }),
    { name: attribute, quiet: QUIET_REPORTS, ceiling: STAGE_WAIT },
  );
  expect(result.settled, `${attribute} did not settle: ${String(result.reports)} reports in ${String(STAGE_WAIT)} ms, the last of ${String(result.value)}`).toBe(true);
  return result.value;
}

test("the playground composes primitives and exports the scene", async ({ page }) => {
  await page.goto("/?view=playground");
  await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();
  const scene = page.getByRole("list", { name: "Scene" }).getByRole("listitem");
  // The count is read once the list has drawn its first item, so a slow machine does not read it empty.
  await expect(scene.first()).toBeVisible();
  const before = await scene.count();
  const viewport = page.getByTestId("playground-viewport");
  await expectRenderer(viewport.locator("canvas"));
  await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  const built = await settled(viewport, "data-builds");

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

/** The part of a scene document the file tests change: its nodes, each with the asset it draws. */
interface FileNode {
  id: string;
  asset: { id: string };
}
interface FileDoc {
  nodes: FileNode[];
}

const isFileDoc = (value: unknown): value is FileDoc => typeof value === "object" && value !== null && "nodes" in value && Array.isArray(value.nodes);

/** The page's JSON export as a document with `change` applied, as a file's bytes. */
async function fileWith(page: Page, change: (doc: FileDoc) => void): Promise<Buffer> {
  const doc: unknown = JSON.parse((await exported(page).textContent()) ?? "null");
  if (!isFileDoc(doc)) throw new Error("the JSON export is not a document with nodes");
  change(doc);
  return Buffer.from(JSON.stringify(doc), "utf8");
}

/** The first node of a document, which every starter scene has. */
function firstNode(doc: FileDoc): FileNode {
  const [first] = doc.nodes;
  if (first === undefined) throw new Error("the document has no nodes");
  return first;
}

const sceneFile = (name: string, buffer: Buffer): { name: string; mimeType: string; buffer: Buffer } => ({ name, mimeType: "application/json", buffer });

test("the stage stays in view while the controls scroll, since a stage out of view draws nothing", async ({ page }) => {
  await playgroundAt(page);
  const viewport = page.getByTestId("playground-viewport");
  await expectRenderer(viewport.locator("canvas"));
  await expect(viewport).toBeInViewport();
  await page.evaluate(() => {
    window.scrollTo(0, 600);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await expect(viewport).toBeInViewport({ ratio: 0.9 });
});

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
    firstNode(doc).asset.id = "no-such-solid";
  });
  await openInput(page).setInputFiles(sceneFile("ghost.json", ghost));
  await expect(problems(page)).toContainText("nodes.0.asset.id: no primitive named");

  // Over the cap is refused by name, never cut down to fit.
  const many = await fileWith(page, (doc) => {
    const template = firstNode(doc);
    doc.nodes = Array.from({ length: 9 }, (_, index) => ({ ...template, id: `n-${String(index)}` }));
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

// Free transforms: the Transform panel edits one node's nine numbers, as the document holds them.

/** One node of the document as these tests read it: where it is, how it is turned and how big it is, relative to its parent. */
type Triple = readonly [number, number, number];
interface Placed {
  readonly id: string;
  readonly parent: string | null;
  readonly position: Triple;
  readonly rotation: Triple;
  readonly scale: Triple;
}
const isTriple = (value: unknown): value is Triple => Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number");
const isPlaced = (value: unknown): value is Placed =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "parent" in value &&
  (value.parent === null || typeof value.parent === "string") &&
  "position" in value &&
  isTriple(value.position) &&
  "rotation" in value &&
  isTriple(value.rotation) &&
  "scale" in value &&
  isTriple(value.scale);

/**
 * The scene document the JSON export shows, read for its nodes. The package's own reader is not used: the container runs this file without the
 * package built, and the export is what the page shows, so a reader of the page's own text is the stricter test.
 */
async function documentOf(page: Page): Promise<{ readonly nodes: readonly Placed[] }> {
  const parsed: unknown = JSON.parse(await exported(page).innerText());
  if (typeof parsed === "object" && parsed !== null && "nodes" in parsed && Array.isArray(parsed.nodes) && parsed.nodes.every(isPlaced)) return { nodes: parsed.nodes };
  throw new Error("the JSON export is not a document whose nodes each have an id, a parent, a position, a rotation and a scale");
}

const panel = (page: Page): Locator => page.getByRole("region", { name: "Transform", exact: true });
const field = (page: Page, label: string): Locator => panel(page).getByLabel(label, { exact: true });
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Selects the node at `index` of the scene list for editing. */
async function select(page: Page, index: number): Promise<void> {
  await things(page).nth(index).getByRole("button", { name: /^Edit transform of / }).click();
  await expect(panel(page)).toBeVisible();
}

/** The `index`th node's transform, as the document has it now. */
async function nodeAt(page: Page, index: number): Promise<Placed> {
  const node = (await documentOf(page)).nodes[index];
  if (node === undefined) throw new Error(`the document has no node ${String(index)}`);
  return node;
}

/** The playground with its starter scene listed and its stage drawing: the stage. */
async function playgroundStage(page: Page): Promise<Locator> {
  await playgroundAt(page);
  const host = page.getByTestId("playground-viewport");
  await expectRenderer(host.locator("canvas"));
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  return host;
}

test.describe("free transforms", () => {
  test("a root node's nine fields set the document: position and scale as typed, rotation in degrees back to radians within 1e-9", async ({ page }) => {
    await playgroundStage(page);
    const before = await documentOf(page);
    await select(page, 0);
    const typed = { "Position X": 1.25, "Position Y": -0.5, "Position Z": 2, "Rotation X": 30, "Rotation Y": 45, "Rotation Z": -60, "Scale X": 1.5, "Scale Y": 0.75, "Scale Z": 2 } as const;
    for (const [label, value] of Object.entries(typed)) {
      // eslint-disable-next-line no-await-in-loop -- the fields are filled one after another, as a person would
      await field(page, label).fill(String(value));
    }
    await expect.poll(async () => (await nodeAt(page, 0)).scale[2], { message: "the last field reaches the document", timeout: STAGE_WAIT }).toBe(2);

    const node = await nodeAt(page, 0);
    expect(node.position).toEqual([1.25, -0.5, 2]);
    expect(node.scale).toEqual([1.5, 0.75, 2]);
    for (const [at, degrees] of [30, 45, -60].entries()) expect(Math.abs((node.rotation[at] ?? Number.NaN) - radians(degrees))).toBeLessThan(1e-9);
    // Nothing else moved: the other nodes, the id and the parent are as they were.
    const after = await documentOf(page);
    expect(after.nodes.slice(1)).toEqual(before.nodes.slice(1));
    expect([node.id, node.parent]).toEqual([before.nodes[0]?.id, before.nodes[0]?.parent]);
  });

  test("a nested node edits its transform relative to its parent, and says so", async ({ page }) => {
    await playgroundStage(page);
    await openInput(page).setInputFiles("packages/scene/fixtures/transform-hierarchy.json");
    await expect.poll(async () => (await documentOf(page)).nodes.some((node) => node.parent !== null), { timeout: STAGE_WAIT }).toBe(true);
    const opened = await documentOf(page);
    const childAt = opened.nodes.findIndex((node) => node.parent !== null);
    const child = opened.nodes[childAt];
    if (child === undefined || child.parent === null) throw new Error("the fixture has no nested node");

    await select(page, childAt);
    await expect(panel(page)).toContainText(`Relative to ${child.parent}`);
    await field(page, "Position Y").fill("3.5");
    await field(page, "Rotation Z").fill("90");
    await expect.poll(async () => (await nodeAt(page, childAt)).position[1], { timeout: STAGE_WAIT }).toBe(3.5);
    const edited = await nodeAt(page, childAt);
    expect(Math.abs(edited.rotation[2] - Math.PI / 2)).toBeLessThan(1e-9);
    // The relative numbers changed and the parent and the tree did not.
    expect(edited.parent).toBe(child.parent);
    expect(edited.position[0]).toBe(child.position[0]);
    expect((await documentOf(page)).nodes.map((node) => node.parent)).toEqual(opened.nodes.map((node) => node.parent));

    // A root node of the same document says nothing about a parent.
    const rootAt = opened.nodes.findIndex((node) => node.parent === null);
    await select(page, rootAt);
    await expect(panel(page)).not.toContainText("Relative to");
  });

  test("the arrow keys nudge the focused field: a tenth, ten times that with Shift, a tenth of that with Alt, a degree for a rotation", async ({ page }) => {
    await playgroundStage(page);
    await select(page, 0);
    const start = await nodeAt(page, 0);
    const x = field(page, "Position X");
    await x.focus();
    await page.keyboard.press("ArrowUp");
    await expect.poll(async () => (await nodeAt(page, 0)).position[0], { timeout: STAGE_WAIT }).toBeCloseTo(start.position[0] + 0.1, 9);
    await page.keyboard.press("Shift+ArrowUp");
    await expect.poll(async () => (await nodeAt(page, 0)).position[0], { timeout: STAGE_WAIT }).toBeCloseTo(start.position[0] + 1.1, 9);
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(async () => (await nodeAt(page, 0)).position[0], { timeout: STAGE_WAIT }).toBeCloseTo(start.position[0] + 1.09, 9);

    const turn = field(page, "Rotation Y");
    await turn.focus();
    await page.keyboard.press("ArrowUp");
    await expect.poll(async () => (await nodeAt(page, 0)).rotation[1], { timeout: STAGE_WAIT }).toBeCloseTo(start.rotation[1] + radians(1), 9);
    // The other two fields of each group kept the exact numbers they had.
    const nudged = await nodeAt(page, 0);
    expect([nudged.position[1], nudged.position[2], nudged.rotation[0], nudged.rotation[2], ...nudged.scale]).toEqual([start.position[1], start.position[2], start.rotation[0], start.rotation[2], ...start.scale]);
  });

  test("a new node starts on the next ring slot, and an edited scene is never put back on the ring", async ({ page }) => {
    await playgroundStage(page);
    await select(page, 0);
    await field(page, "Position X").fill("9");
    await field(page, "Scale X").fill("3");
    await expect.poll(async () => (await nodeAt(page, 0)).scale[0], { timeout: STAGE_WAIT }).toBe(3);
    const before = await documentOf(page);

    await page.getByRole("button", { name: "Add to scene" }).click();
    await expect.poll(async () => (await documentOf(page)).nodes.length, { timeout: STAGE_WAIT }).toBe(before.nodes.length + 1);
    const added = await documentOf(page);
    expect(added.nodes.slice(0, before.nodes.length)).toEqual(before.nodes);
    const slot = ringLayout(added.nodes.length)[before.nodes.length];
    const position = added.nodes.at(-1)?.position ?? [Number.NaN, Number.NaN, Number.NaN];
    for (const [at, expected] of (slot ?? [Number.NaN, Number.NaN, Number.NaN]).entries()) expect(Math.abs((position[at] ?? Number.NaN) - expected)).toBeLessThan(1e-9);

    // Taking a node away moves nobody either.
    await page.getByRole("button", { name: /^Remove / }).last().click();
    await expect.poll(async () => (await documentOf(page)).nodes.length, { timeout: STAGE_WAIT }).toBe(before.nodes.length);
    expect((await documentOf(page)).nodes).toEqual(before.nodes);
  });

  test("every field has a label, and the panel has no serious or critical accessibility violation", async ({ page }) => {
    await playgroundStage(page);
    await select(page, 0);
    await expect(panel(page).getByRole("spinbutton")).toHaveCount(9);
    const labels = ["Position", "Rotation", "Scale"].flatMap((group) => ["X", "Y", "Z"].map((axis) => `${group} ${axis}`));
    await Promise.all(labels.map((label) => expect(field(page, label)).toBeVisible()));
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  test("ten transform edits and an undo build nothing: builds, programs and effect builds stay flat while the frames rise", async ({ page }) => {
    const host = await playgroundStage(page);
    // An effect on, so the playground draws through a pipeline and its counter has something to hold flat.
    await page.getByRole("checkbox", { name: "Dither" }).check();
    await expect.poll(() => effectBuilds(host), { message: "the effect pipeline is built", timeout: STAGE_WAIT }).toBeGreaterThan(0);
    const built = await settled(host, "data-builds");
    const programs = await settled(host, "data-programs");
    const pipelines = await settled(host, "data-effect-builds");
    const frames = await counted(host, "data-frames");

    await select(page, 0);
    const edits = [
      ["Position X", "0.5"],
      ["Position Y", "0.25"],
      ["Position Z", "-1"],
      ["Rotation X", "20"],
      ["Rotation Y", "40"],
      ["Rotation Z", "60"],
      ["Scale X", "1.2"],
      ["Scale Y", "0.9"],
      ["Scale Z", "1.1"],
      ["Position X", "-0.5"],
    ] as const;
    for (const [label, value] of edits) {
      // eslint-disable-next-line no-await-in-loop -- one edit after another, each a gesture of its own
      await field(page, label).fill(value);
    }
    await expect.poll(async () => (await nodeAt(page, 0)).position[0], { message: "the last edit reaches the document", timeout: STAGE_WAIT }).toBe(-0.5);

    // Frames drawn after the edits, enough for a rebuild they caused to have landed and been counted.
    const after = await counted(host, "data-frames");
    await expect.poll(() => counted(host, "data-frames"), { message: "frames after ten edits", timeout: STAGE_WAIT }).toBeGreaterThan(Math.max(after, frames) + 5);
    expect(await counted(host, "data-builds"), "builds after ten transform edits").toBe(built);
    expect(await counted(host, "data-programs"), "programs after ten transform edits").toBe(programs);
    expect(await effectBuilds(host), "effect builds after ten transform edits").toBe(pipelines);

    // An undo is a transform written back: flat too, and the last edit is gone.
    const beforeUndo = await counted(host, "data-frames");
    await undo(page).click();
    await expect.poll(async () => (await nodeAt(page, 0)).position[0], { message: "the undo reaches the document", timeout: STAGE_WAIT }).toBe(0.5);
    await expect.poll(() => counted(host, "data-frames"), { message: "frames after the undo", timeout: STAGE_WAIT }).toBeGreaterThan(beforeUndo + 5);
    expect(await counted(host, "data-builds"), "builds after the undo").toBe(built);
    expect(await counted(host, "data-programs"), "programs after the undo").toBe(programs);
    expect(await effectBuilds(host), "effect builds after the undo").toBe(pipelines);
  });
});

test("the code the playground shows carries the credits of the work it uses once they have loaded, and the JSON has none", async ({ page }) => {
  await page.goto("/?view=playground");
  const react = page.getByRole("region", { name: "React export" }).locator("code");
  const vanilla = page.getByRole("region", { name: "Vanilla export" }).locator("code");
  const json = page.getByRole("region", { name: "JSON export" }).locator("code");
  // Our own look uses no one else's work: the code has no header, and it is shown only after the credits chunk has loaded.
  await expect(react).toContainText("<WebGPUCanvas camera=");
  await expect(vanilla).toContainText("createPolyhedronGeometry(");
  await expect(react).not.toContainText("the work of others");
  await expect(vanilla).not.toContainText("the work of others");
  // A look that is someone's work is credited in both, as comment lines and as data, and in neither is the JSON changed.
  await page.getByLabel("Look").selectOption("tokyo-night");
  await expect(react).toContainText("// This scene uses the work of others, credited here:");
  await expect(react).toContainText("// - tokyo-night (look)");
  await expect(react).toContainText("export const credits = [");
  await expect(vanilla).toContainText("// - tokyo-night (look)");
  await expect(vanilla).toContainText("export const credits = [");
  await expect(json).not.toContainText("the work of others");
  await page.getByLabel("Look").selectOption("hedronite");
  await expect(react).not.toContainText("the work of others");
});
