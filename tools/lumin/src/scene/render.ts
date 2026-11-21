// The code passed to page.evaluate and page.waitForFunction runs in the browser; DOM types for this file only.
/// <reference lib="dom" />
// `lumin scene render`: one scene document drawn to a PNG by the catalog's own still page (apps/catalog/src/sceneStill.ts, document mode), in headless
// Chromium, through `createScene`, the path that draws the playground. The page is the built catalog, served read-only on loopback; software GL is the default
// (so it runs anywhere) and `--gpu` asks for the machine's. The command waits on the page's own state (`data-still` and `data-frames`), never on a timer.
// It takes the document's JSON text: reading it, and checking it against the library, is the scene table's input step (`io.ts`).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import type { Browser } from "@playwright/test";
import { decodePng, type Picture } from "../../../stills/src/png.js";
import { toCanonicalJson } from "@hedronite/lts-scene/emit";
import { root } from "../commands.js";
import { fail, ok, type Envelope } from "../envelope.js";
import { failureEnvelope, loadDocument, type Context, type Source } from "./io.js";

/** The longest side a render may have, in pixels: the still page's own cap, asked here first so an oversized request never starts a browser. */
export const MAX_SIDE = 2048;
/** The side a render has when none is given: the still rig's square, the size the goldens are. */
const DEFAULT_SIDE = 512;

/** The still page's stage color, the neutral look's raised surface (#f5f5f5): a frame of nothing else has nothing in it. */
const BACKGROUND = 245;

/** What `render` is asked. `document` is the JSON text of a scene document that has already been read and checked. */
export interface RenderOptions {
  readonly document: string;
  readonly out: string;
  readonly width?: number;
  readonly height?: number;
  /** Draw on the machine's GPU instead of software GL. */
  readonly gpu?: boolean;
}

/** Where the built catalog is, and the name the envelope carries. */
export interface RenderPaths {
  readonly root: string;
  readonly command?: string;
}

/** Whether every pixel of a frame is the stage's color: the document drew nothing a viewer could see. */
export function isBlank(picture: Picture): boolean {
  const { rgba } = picture;
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at] !== BACKGROUND || rgba[at + 1] !== BACKGROUND || rgba[at + 2] !== BACKGROUND || rgba[at + 3] !== 255) return false;
  }
  return true;
}

/** A side as given: a whole number of pixels from 1 to `MAX_SIDE`, or the problem with it. */
export function checkSide(name: string, value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1) return `--${name} is a whole number of pixels, not ${String(value)}`;
  return value > MAX_SIDE ? `--${name} is at most ${String(MAX_SIDE)} pixels, and ${String(value)} was asked` : undefined;
}

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".hdr": "application/octet-stream",
};

/** Serves a built directory read-only on a loopback port the system picks. Nothing outside it is ever read. */
export async function serve(dist: string): Promise<{ readonly server: Server; readonly origin: string }> {
  const base = resolve(dist);
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
    const file = normalize(join(base, path === "/" ? "index.html" : path));
    if (!file.startsWith(base + sep) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the loopback server has no port");
  return { server, origin: `http://127.0.0.1:${String(address.port)}` };
}

const closeServer = (server: Server): Promise<void> =>
  new Promise((done) => {
    server.close(() => {
      done();
    });
  });

/** Chromium's flags for each path: ANGLE over SwiftShader (the software renderer CI draws with) or over Metal (the machine's GPU). */
const launchArgs = (gpu: boolean): readonly string[] => (gpu ? ["--enable-unsafe-webgpu", "--use-angle=metal"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]);

/** The renderer names that mean no GPU drew the frame. */
const SOFTWARE = /swiftshader|llvmpipe|software|fallback/i;

interface Stage {
  readonly still: string;
  readonly frames: number;
  readonly renderer: string;
  readonly error: string;
}

/** Draws the document and returns the PNG's bytes with what the page says about the draw, or the envelope that refuses it. */
async function draw(browser: Browser, origin: string, options: RenderOptions, size: { readonly width: number; readonly height: number }, command: string): Promise<{ readonly png: Buffer; readonly stage: Stage } | Envelope> {
  // The stage sits at the top left of the page at device pixel ratio 1; the viewport is never smaller than the rig's own, so the whole stage is on screen.
  const page = await browser.newPage({ viewport: { width: Math.max(size.width, 640), height: Math.max(size.height, 640) }, deviceScaleFactor: 1 });
  try {
    await page.goto(`${origin}/still.html?doc`);
    const stage = page.getByTestId("still");
    await page.locator('[data-testid="still"][data-still="waiting"]').waitFor({ timeout: 60_000 });
    // The page draws on its own schedule: this starts it and does not wait for it, and the waits below are on what it writes about itself.
    const loading = page.evaluate(async ({ json, width, height }) => {
      const offered: unknown = Reflect.get(window, "stillScene");
      if (typeof offered !== "object" || offered === null || !("load" in offered) || typeof offered.load !== "function") throw new Error("the still page offers no load");
      const drawn: unknown = Reflect.apply(offered.load, offered, [json, { width, height }]);
      await drawn;
    }, { json: options.document, ...size });
    loading.catch(() => undefined);
    await page.waitForFunction(
      () => {
        const host = document.querySelector('[data-testid="still"]');
        const state = host?.getAttribute("data-still");
        return state === "error" || (state === "ready" && Number(host?.getAttribute("data-frames")) > 0);
      },
      undefined,
      { timeout: 240_000 },
    );
    const read = async (attribute: string): Promise<string> => (await stage.getAttribute(attribute)) ?? "";
    const seen: Stage = { still: await read("data-still"), frames: Number(await read("data-frames")), renderer: await read("data-renderer"), error: await read("data-error") };
    if (seen.still === "error") {
      const first = seen.error.split("\n")[0] ?? "the page could not draw the document";
      return fail(command, first.startsWith("not a scene document") ? "invalid" : "failed", first);
    }
    if (options.gpu === true && SOFTWARE.test(seen.renderer)) return fail(command, "failed", `--gpu was asked and the page drew on a software renderer (${seen.renderer})`);
    return { png: await stage.screenshot({ animations: "disabled" }), stage: seen };
  } finally {
    await page.close();
  }
}

/** `lumin scene render`: the document as a PNG at `out`, or the envelope that says why not. Nothing is written for a frame that is refused. */
export async function renderScene(options: RenderOptions, paths: RenderPaths): Promise<Envelope> {
  const command = paths.command ?? "render";
  const problem = checkSide("width", options.width) ?? checkSide("height", options.height);
  if (problem !== undefined) return fail(command, "usage", problem);
  const dist = join(paths.root, "apps/catalog/dist");
  if (!existsSync(join(dist, "still.html"))) return fail(command, "not_built", "the catalog's still page is not built: run bun run build");
  const size = { width: options.width ?? DEFAULT_SIDE, height: options.height ?? DEFAULT_SIDE };
  const { server, origin } = await serve(dist);
  let browser: Browser | undefined;
  try {
    // Playwright is loaded when a render is asked for, so the other scene operations (and a server that lists them) never pay for it.
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ args: [...launchArgs(options.gpu === true)] });
    const drawn = await draw(browser, origin, options, size, command);
    if ("ok" in drawn) return drawn;
    const picture = decodePng(drawn.png);
    if (picture.width !== size.width || picture.height !== size.height) return fail(command, "failed", `the page drew ${String(picture.width)}x${String(picture.height)}, not the ${String(size.width)}x${String(size.height)} asked`);
    if (isBlank(picture)) return fail(command, "blank", "every pixel of the frame is the stage's background: the document shows nothing a viewer could see");
    const out = resolve(options.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, drawn.png);
    return ok(command, { out, ...size, sha256: createHash("sha256").update(drawn.png).digest("hex"), renderer: drawn.stage.renderer, frames: drawn.stage.frames });
  } catch (error: unknown) {
    return fail(command, "failed", error instanceof Error ? error.message : String(error));
  } finally {
    await browser?.close();
    await closeServer(server);
  }
}

/** What the table's `render` row is given: a document as every scene operation takes one, where to put the PNG, and the size and renderer. */
export interface RenderInput {
  readonly document: Source;
  readonly out: string;
  /** Pixels, as a number or as the digits a flag gives. */
  readonly width?: number | string | undefined;
  readonly height?: number | string | undefined;
  readonly gpu?: boolean | undefined;
}

/** A side as the row is given it: a number, or the digits of one from a flag. A text that is not digits stays as it is, for `checkSide` to name. */
const sideOf = (value: number | string | undefined): number | undefined => (typeof value === "string" ? Number(value) : value);

/**
 * `scene render`: the document is read, migrated and checked like every scene operation's (so a bad one is refused here, with its issues, before a
 * browser starts), then drawn by the still page. The PNG is written at `out`, replacing a file that is there: a picture is made again, not edited.
 */
export async function renderOperation(input: RenderInput, ctx: Context): Promise<Envelope> {
  const loaded = await loadDocument(input.document, ctx);
  if (!loaded.ok) return failureEnvelope("scene render", loaded.failure);
  const { width, height } = { width: sideOf(input.width), height: sideOf(input.height) };
  return renderScene({ document: toCanonicalJson(loaded.value.scene), out: input.out, ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }), gpu: input.gpu === true }, { root, command: "scene render" });
}
