import type { Locator, Page } from "@playwright/test";
import { expect, expectRenderer, test } from "./fixtures.js";

/**
 * The scene element (`<lts-scene>`, `@hedronite/lts-scene/element`) on its test page, element.html. `?only=` loads one case on its own.
 * It runs on software GL in the default run (the renderer says `webgl2`) and on the WebGPU lane (it must say `webgpu`): `expectRenderer` holds each to its own list.
 */

interface LogRow {
  readonly state: string | null;
  readonly canvas: string | null;
  readonly frames: string | null;
}
interface ErrorRow {
  readonly id: string;
  readonly detail: unknown;
}
declare global {
  interface Window {
    __elementLog?: LogRow[];
    __elementErrors?: ErrorRow[];
    /** How many animation frames the element's own code asked for (three's renderer keeps a heartbeat of its own, which does not draw). */
    __elementRafs?: number;
  }
}

/** Files the page loads for the element before it is about to be seen: the element's own chunk. */
const bootstrapFile = /\/assets\/element-[\w-]+\.js$/;
const scripts = (urls: readonly string[]): string[] => urls.filter((url) => new URL(url).pathname.endsWith(".js"));

/** The canvas the element draws on, inside its shadow root. */
const canvasOf = (host: Locator): Locator => host.locator("canvas");

const ready = (host: Locator): Promise<void> => expect(host).toHaveAttribute("data-state", "ready", { timeout: 30_000 });

/** A counter the element publishes, as a number. */
const count = async (host: Locator, name: string): Promise<number> => Number(await host.getAttribute(`data-${name}`, { timeout: 1_000 }));

/** How many distinct colours (4 bits a channel) the canvas shows: a cleared or blank canvas shows one or two. */
const coloursOn = async (page: Page, canvas: Locator): Promise<number> => {
  const png = await canvas.screenshot();
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = surface.getContext("2d");
    if (context === null) return 0;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const seen = new Set<number>();
    for (let at = 0; at < data.length; at += 4) seen.add(((data[at] ?? 0) >> 4) * 256 + ((data[at + 1] ?? 0) >> 4) * 16 + ((data[at + 2] ?? 0) >> 4));
    return seen.size;
  }, png.toString("base64"));
};

/** The frame counter holds across `ms`: nothing drew. */
const holdsStill = async (host: Locator, ms: number): Promise<void> => {
  const before = await count(host, "frames");
  await host.page().waitForTimeout(ms);
  expect(await count(host, "frames"), "frames drawn while the element should be still").toBe(before);
};

const field = (value: unknown, name: string): unknown => (typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined);

test("a page with one element far down loads no three, no builder and no zod before it is in view, shows the poster, then builds on scrolling", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  await page.goto("/element.html?only=far");
  const host = page.locator("#far");
  await expect(host).toHaveAttribute("data-state", "poster");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const before = scripts(urls);
  expect(before.length, "the trace saw the page's own scripts").toBeGreaterThan(0);
  expect(before.filter((url) => !bootstrapFile.test(url)), "scripts other than the bootstrap, before the element is near").toEqual([]);
  expect(urls.filter((url) => url.endsWith("solids.json")), "the document is not fetched before it is needed").toEqual([]);
  // The poster is the first paint: an image that has loaded, with no canvas yet.
  expect(await host.locator("img").evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(canvasOf(host)).toHaveCount(0);
  await host.scrollIntoViewIfNeeded();
  await ready(host);
  expect(
    scripts(urls).some((url) => /three\.webgpu-/.test(url)),
    "scrolling brought in three",
  ).toBe(true);
  expect(urls.some((url) => url.endsWith("solids.json"))).toBe(true);
});

test("an inline document and a src document each reach ready on the backend this run allows, with a picture on the canvas and the counters the island has", async ({ page }) => {
  await page.goto("/element.html?only=inline,src");
  await Promise.all(
    ["inline", "src"].map(async (id) => {
      const host = page.locator(`#${id}`);
      await ready(host);
      await expectRenderer(canvasOf(host));
      expect(await coloursOn(page, canvasOf(host)), `distinct colours on #${id}`).toBeGreaterThan(8);
      await expect(host).toHaveAttribute("role", "img");
      const names = ["frames", "builds", "geometries", "textures", "targets", "programs"];
      const counters = await Promise.all(names.map((name) => count(host, name)));
      names.forEach((name, at) => expect(Number.isInteger(counters[at]), `data-${name} on #${id}`).toBe(true));
      expect(await count(host, "builds")).toBeGreaterThan(0);
      expect(await count(host, "frames")).toBeGreaterThan(0);
    }),
  );
  await expect(page.getByRole("img", { name: "Three solids, document from src" })).toBeVisible();
});

test("the canvas replaces the poster only after the first frame is drawn", async ({ page }) => {
  await page.addInitScript(() => {
    const log: LogRow[] = [];
    window.__elementLog = log;
    new MutationObserver(() => {
      const host = document.querySelector("lts-scene");
      if (host === null) return;
      log.push({ state: host.getAttribute("data-state"), canvas: host.shadowRoot?.querySelector("canvas")?.style.visibility ?? null, frames: host.getAttribute("data-frames") });
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
  });
  await page.goto("/element.html?only=src");
  await ready(page.locator("#src"));
  const rows = await page.evaluate(() => window.__elementLog ?? []);
  const states = rows.map((row) => row.state);
  expect(states).toContain("loading");
  expect(states[states.length - 1]).toBe("ready");
  const last = rows[rows.length - 1];
  expect(last?.canvas).toBe("visible");
  expect(Number(last?.frames), "frames drawn when the canvas was shown").toBeGreaterThan(0);
  expect(rows.slice(0, -1).filter((row) => row.canvas === "visible"), "a canvas shown before ready").toEqual([]);
});

test("under reduced motion it draws the rest pose once and asks for no animation frames, and follows the setting live", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.__elementRafs = 0;
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      // Three's renderer keeps a heartbeat of its own that draws nothing; the element's loop is the calls made from its own chunk.
      if (String(new Error().stack).includes("/assets/draw-")) window.__elementRafs = (window.__elementRafs ?? 0) + 1;
      return original(callback);
    };
  });
  await page.goto("/element.html?only=src");
  const host = page.locator("#src");
  await ready(host);
  await expectRenderer(canvasOf(host));
  const rafs = (): Promise<number> => page.evaluate(() => window.__elementRafs ?? -1);
  await page.waitForTimeout(300);
  const frames = await count(host, "frames");
  const calls = await rafs();
  expect(frames).toBeGreaterThan(0);
  expect(calls).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(1_200);
  expect(await count(host, "frames")).toBe(frames);
  expect(await rafs(), "animation frames the element asked for under reduced motion").toBe(calls);
  // Motion allowed: the loop starts, and the counter sees it. Reduced again: it stops.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => count(host, "frames")).toBeGreaterThan(frames + 5);
  expect(await rafs(), "the element's loop is seen by the counter").toBeGreaterThan(calls);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(300);
  await holdsStill(host, 800);
});

test("a change of look recolours in place: the same builds and the same programs, and a different picture", async ({ page }) => {
  await page.goto("/element.html?only=src");
  const host = page.locator("#src");
  await ready(host);
  await page.waitForTimeout(600);
  const builds = await count(host, "builds");
  const programs = await count(host, "programs");
  expect(programs, "the renderer reports its programs").toBeGreaterThan(0);
  const before = await canvasOf(host).screenshot();
  await host.evaluate((element) => {
    element.setAttribute("look", "hedronite");
  });
  await page.waitForTimeout(800);
  const after = await canvasOf(host).screenshot();
  expect(after.equals(before), "the picture after a new look").toBe(false);
  expect(await count(host, "builds")).toBe(builds);
  expect(await count(host, "programs")).toBe(programs);
  // A look that is not one is refused and the scene stays as it was.
  await host.evaluate((element) => {
    element.setAttribute("look", "no-such-look");
  });
  await page.waitForTimeout(300);
  await expect(host).toHaveAttribute("data-state", "ready");
  expect(await count(host, "builds")).toBe(builds);
});

test("a document that is not valid, and one that is not there, keep the poster, set the error state and dispatch an error event with the issues", async ({ page }) => {
  await page.route("**/element/not-there.json", (route) => route.fulfill({ status: 404, body: "not found" }));
  await page.addInitScript(() => {
    const errors: ErrorRow[] = [];
    window.__elementErrors = errors;
    // The event does not bubble: the capture phase sees it on its way down.
    document.addEventListener(
      "error",
      (event) => {
        if (event instanceof CustomEvent && event.target instanceof Element) errors.push({ id: event.target.id, detail: event.detail });
      },
      true,
    );
  });
  await page.goto("/element.html?only=bad,missing");
  await Promise.all(
    ["bad", "missing"].map(async (id) => {
      const host = page.locator(`#${id}`);
      await expect(host).toHaveAttribute("data-state", "error", { timeout: 30_000 });
      await expect(canvasOf(host), "a canvas shown for a scene that did not load").toHaveCount(0);
      expect(await host.locator("img").evaluate((image) => image instanceof HTMLImageElement && image.complete && getComputedStyle(image).visibility !== "hidden")).toBe(true);
    }),
  );
  const errors = await page.evaluate(() => window.__elementErrors ?? []);
  const issuesOf = (id: string): unknown[] => {
    const detail = errors.find((row) => row.id === id)?.detail;
    expect(field(detail, "ok"), `ok of the ${id} detail`).toBe(false);
    const issues = field(detail, "issues");
    return Array.isArray(issues) ? issues : [];
  };
  const bad = issuesOf("bad");
  expect(bad.length).toBeGreaterThan(0);
  for (const issue of bad) expect(typeof issue === "object" && issue !== null ? Object.keys(issue).sort() : []).toEqual(["code", "message", "path"]);
  expect(bad.map((issue) => field(issue, "code"))).toContain("missing-field");
  expect(issuesOf("missing").map((issue) => field(issue, "code"))).toEqual(["fetch-failed"]);
});

test("loading eager builds at once, out of view, and lazy waits for the viewport", async ({ page }) => {
  await page.goto("/element.html?only=far");
  const host = page.locator("#far");
  await expect(host).toHaveAttribute("data-state", "poster");
  await host.evaluate((element) => {
    element.setAttribute("loading", "eager");
  });
  await ready(host);
  await expectRenderer(canvasOf(host));
});

test("it draws no frames while fully out of view, and draws again when it returns", async ({ page }) => {
  await page.goto("/element.html?only=src");
  const host = page.locator("#src");
  await ready(host);
  await expect.poll(() => count(host, "frames")).toBeGreaterThan(5);
  await page.evaluate(() => {
    window.scrollTo(0, 2_500);
  });
  await page.waitForTimeout(500);
  await holdsStill(host, 800);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const frames = await count(host, "frames");
  await expect.poll(() => count(host, "frames")).toBeGreaterThan(frames + 5);
});

test("twenty cycles of disconnecting and connecting leave the renderer holding what an empty scene leaves, and each connection builds the scene again", async ({ page }) => {
  // Each connection starts a renderer and builds the scene: twenty of them on software GL take their time.
  test.setTimeout(180_000);
  await page.goto("/element.html?only=empty,inline");
  await Promise.all(["empty", "inline"].map((id) => ready(page.locator(`#${id}`))));
  const cycles = await page.evaluate(async () => {
    /** Takes an element out of the page and puts it back where it was; says what the renderer held when its scene was freed and what state the element was in. */
    const cycle = async (id: string): Promise<{ leftovers: string | null; state: string | null }> => {
      const element = document.querySelector(`#${id}`);
      const parent = element?.parentElement;
      if (element === null || element === undefined || parent === null || parent === undefined) throw new Error(`no element #${id}`);
      const next = element.nextSibling;
      element.remove();
      const left = { leftovers: element.getAttribute("data-leftovers"), state: element.getAttribute("data-state") };
      parent.insertBefore(element, next);
      await new Promise<void>((resolve) => {
        const check = (): void => {
          if (element.getAttribute("data-state") === "ready") resolve();
          else setTimeout(check, 50);
        };
        check();
      });
      return left;
    };
    const empty = await cycle("empty");
    const seen: { leftovers: string | null; state: string | null }[] = [];
    for (let n = 0; n < 20; n += 1) {
      // eslint-disable-next-line no-await-in-loop -- one cycle after the other: each connection is built before the next is taken down
      seen.push(await cycle("inline"));
    }
    return { empty, seen };
  });
  expect(cycles.seen.every((row) => row.state === "poster"), "an element taken out of the page shows its poster").toBe(true);
  // An empty scene leaves the renderer's own things (its environment, a quad, its targets). A scene that frees all it built leaves the same; one that does not leaves more.
  expect(cycles.empty.leftovers).not.toBeNull();
  expect(cycles.seen.map((row) => row.leftovers)).toEqual(Array.from({ length: 20 }, () => cycles.empty.leftovers));
  await ready(page.locator("#inline"));
  await expectRenderer(canvasOf(page.locator("#inline")));
  // Connected again, each time, it built the scene again: its builds never went down and rose with every cycle.
  expect(await count(page.locator("#inline"), "builds")).toBeGreaterThan(20);
});
