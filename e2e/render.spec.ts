// `lumin scene render` (tools/lumin/src/scene/render.ts), run for real: each scene fixture is drawn to a PNG by the still page in headless Chromium, on software
// WebGL as everything in the default project is, and the frame is held against the fixture's golden the way the scenes-loose project holds the same page's frame:
// the golden check's loose metrics and bar (e2e/golden/metrics.ts), because the goldens were drawn on a GPU. It starts its own browser and its own loopback
// server, so it needs the catalog built (bun run build) and nothing else.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeScene, encodeScene, parseScene, SHARE_LIMITS } from "@hedronite/lts-scene";
import { expect, test, type Page } from "@playwright/test";
import { isBlank, renderScene } from "../tools/lumin/src/scene/render.js";
import { decodePng, type Picture } from "../tools/stills/src/png.js";
import { looseDistance, looseRatio, MARGIN, strictDistance } from "./golden/metrics.js";
import { goldenPath } from "./scenes/emitted.js";
import { roundTrip, type Fixture } from "./scenes/fixtures.js";

const root = join(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "lts-render-spec-"));
test.afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The text of a scene fixture, as `packages/scene/fixtures` has it. */
const fixtureText = (name: string): string => readFileSync(join(root, "packages/scene/fixtures", `${name}.json`), "utf8");

interface Rendered {
  readonly out: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly renderer: string;
  readonly frames: number;
}

const isRendered = (data: unknown): data is Rendered =>
  typeof data === "object" && data !== null && "out" in data && typeof data.out === "string" && "width" in data && typeof data.width === "number" && "height" in data && typeof data.height === "number" && "sha256" in data && typeof data.sha256 === "string" && "renderer" in data && typeof data.renderer === "string" && "frames" in data && typeof data.frames === "number";

/** Renders a document into a file of this run's scratch directory, and returns what the command says. */
async function render(document: string, file: string, size: { readonly width?: number; readonly height?: number } = {}): Promise<Awaited<ReturnType<typeof renderScene>>> {
  return renderScene({ document, out: join(scratch, file), ...size }, { root, command: "render" });
}

async function rendered(document: string, file: string): Promise<Rendered> {
  const envelope = await render(document, file);
  if (!envelope.ok) throw new Error(`render failed: ${JSON.stringify(envelope)}`);
  if (!isRendered(envelope.data)) throw new Error(`render returned ${JSON.stringify(envelope.data)}`);
  return envelope.data;
}

for (const name of roundTrip) {
  test(`${name} renders to a PNG that is its golden, within the golden check's loose bar`, async () => {
    // Software WebGL draws the effects slowly, and the page steps sixty frames: a long test, as the scene round trip's is.
    test.setTimeout(300_000);
    const result = await rendered(fixtureText(name), `${name}.png`);
    const bytes = readFileSync(result.out);
    expect([result.width, result.height, result.frames > 0]).toEqual([512, 512, true]);
    expect(result.sha256, "the digest is of the file written").toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(result.renderer, "the default path is software").toMatch(/swiftshader/i);
    const clean = looseDistance(decodePng(bytes), decodePng(readFileSync(goldenPath(name))));
    expect(looseRatio(clean, `scene-${name}`) <= 1 / MARGIN, `${name} is further from its golden than its bar allows: ${JSON.stringify(clean)}`).toBe(true);
  });
}

test("two renders of one fixture are the same picture, and say whether they are the same bytes", async () => {
  test.setTimeout(300_000);
  const testInfo = test.info();
  const name: Fixture = "transform-hierarchy";
  const first = await rendered(fixtureText(name), "again-1.png");
  const second = await rendered(fixtureText(name), "again-2.png");
  const identical = readFileSync(first.out).equals(readFileSync(second.out));
  const distance = strictDistance(decodePng(readFileSync(first.out)), decodePng(readFileSync(second.out)));
  const said = identical ? "byte-identical" : `not byte-identical: ${JSON.stringify(distance)}`;
  testInfo.annotations.push({ type: "repeatability", description: said });
  console.log(`repeatability of ${name}: ${said}`);
  expect(first.sha256 === second.sha256, "the digests agree exactly when the bytes do").toBe(identical);
  if (!identical) expect(looseRatio(looseDistance(decodePng(readFileSync(first.out)), decodePng(readFileSync(second.out))), `scene-${name}`) <= 1 / MARGIN, "two renders differ by more than the loose bar").toBe(true);
});

test("a size is honoured, and the page draws the document at it", async () => {
  test.setTimeout(300_000);
  const envelope = await render(fixtureText("transform-hierarchy"), "wide.png", { width: 320, height: 192 });
  expect(envelope).toMatchObject({ ok: true, data: { width: 320, height: 192 } });
  const picture = decodePng(readFileSync(join(scratch, "wide.png")));
  expect([picture.width, picture.height]).toEqual([320, 192]);
});

test("a document with nothing in it is refused as blank and writes no file; a side over the cap is a usage error; a document that does not read is invalid", async () => {
  test.setTimeout(300_000);
  const parsed: unknown = JSON.parse(fixtureText("transform-hierarchy"));
  if (typeof parsed !== "object" || parsed === null) throw new Error("the fixture is not an object");
  const empty = JSON.stringify({ ...parsed, nodes: [], effects: [] });
  expect(await render(empty, "empty.png")).toMatchObject({ ok: false, kind: "blank", exit: 1 });
  expect(() => readFileSync(join(scratch, "empty.png"))).toThrow(/ENOENT/);
  expect(await render(fixtureText("transform-hierarchy"), "huge.png", { width: 4096 })).toMatchObject({ ok: false, kind: "usage", exit: 2 });
  expect(await render("{ not json", "bad.png")).toMatchObject({ ok: false, kind: "invalid", exit: 1 });
});

/** The still page's own frame of a document at an address, read once the page says it is done. */
async function pageFrame(page: Page, address: string): Promise<Picture> {
  await page.goto(address);
  const stage = page.getByTestId("still");
  await expect(stage).toHaveAttribute("data-still", /^(ready|error)$/, { timeout: 120_000 });
  expect(await stage.getAttribute("data-error")).toBeNull();
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/);
  return decodePng(await stage.screenshot({ animations: "disabled" }));
}

test("the still page draws a document from a link, as the command draws it from the file", async ({ page }) => {
  test.setTimeout(300_000);
  const name: Fixture = "framed-solid-shader";
  const read = parseScene(fixtureText(name));
  if (!read.ok) throw new Error(`the fixture does not read: ${JSON.stringify(read.issues)}`);
  const link = await encodeScene(read.scene);
  const fromLink = await pageFrame(page, `/still.html?doc=${encodeURIComponent(link)}`);
  const result = await rendered(fixtureText(name), "link.png");
  const fromCommand = decodePng(readFileSync(result.out));
  expect([fromLink.width, fromLink.height]).toEqual([512, 512]);
  const distance = strictDistance(fromLink, fromCommand);
  test.info().annotations.push({ type: "link-versus-command", description: JSON.stringify(distance) });
  expect(looseRatio(looseDistance(fromLink, fromCommand), `scene-${name}`) <= 1 / MARGIN, `the link's frame is further from the command's than the loose bar allows: ${JSON.stringify(distance)}`).toBe(true);
});

test("a document too big for a link is drawn through load, by the page and by the command", async ({ page }) => {
  test.setTimeout(300_000);
  const read = parseScene(fixtureText("transform-hierarchy"));
  if (!read.ok) throw new Error(`the fixture does not read: ${JSON.stringify(read.issues)}`);
  const [template] = read.scene.nodes;
  if (template === undefined) throw new Error("the fixture has no node");
  // A scatter of cubes with unrelated positions: each is a node of its own, and the document does not deflate into a link.
  let seed = 7;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const triple = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
  const nodes = Array.from({ length: 400 }, (_, index) => ({
    ...template,
    id: `cube-${String(index)}`,
    parent: null,
    position: triple((next() - 0.5) * 4, (next() - 0.5) * 3, (next() - 0.5) * 2),
    rotation: triple(next() * 3, next() * 3, next() * 3),
    scale: triple(0.05 + next() * 0.05, 0.05 + next() * 0.05, 0.05 + next() * 0.05),
  }));
  const big = JSON.stringify({ ...read.scene, nodes });
  const link = await encodeScene({ ...read.scene, nodes });
  expect(link.length, "the scene must not fit a link, or this test is not about load").toBeGreaterThan(SHARE_LIMITS.link);
  expect((await decodeScene(link)).ok).toBe(false);
  expect(Buffer.byteLength(big)).toBeLessThan(SHARE_LIMITS.document);

  const result = await rendered(big, "big.png");
  const fromCommand = decodePng(readFileSync(result.out));
  await page.goto("/still.html?doc");
  await expect(page.getByTestId("still")).toHaveAttribute("data-still", "waiting");
  await page.evaluate(async (json) => {
    const offered: unknown = Reflect.get(window, "stillScene");
    if (typeof offered !== "object" || offered === null || !("load" in offered) || typeof offered.load !== "function") throw new Error("the page offers no load");
    const drawn: unknown = Reflect.apply(offered.load, offered, [json]);
    await drawn;
  }, big);
  const stage = page.getByTestId("still");
  await expect(stage).toHaveAttribute("data-still", "ready");
  const fromLoad = decodePng(await stage.screenshot({ animations: "disabled" }));
  expect(isBlank(fromCommand), "the scatter is on the page").toBe(false);
  expect(strictDistance(fromLoad, fromCommand), "load draws what the command wrote").toMatchObject({ changedPixels: 0 });
});
