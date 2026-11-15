import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { parseObjectSpec, type ObjectSpec } from "@hedronite/lts-objects";
import { chromium } from "@playwright/test";
import { z } from "zod";

/**
 * The image-to-object review loop: render an ObjectSpec the way the reference photo frames its
 * subject, then score the render against the photo with the forge's own deterministic review tools.
 *
 * 1. Measure the photo with the forge's foreground mask (`review/reference_box.py`): its size, the
 *    subject's box and the background color.
 * 2. Render the spec on the catalog's embed page in headless Chromium, same size and background,
 *    the object fitted into that box at one scale (so proportion errors still show), plus a
 *    three-quarter view for a human or agent to look at.
 * 3. Build the forge's side-by-side sheet (`make_comparison_sheet.py`) and score with its Divine Eye
 *    (`divine_eye.py`: silhouette IoU and scale as hard gates, then structure, edges, tone and more).
 *
 * Everything goes in `out`: `render.png`, `three-quarter.png`, `sheet.png`, `scores.json` and
 * `review.json`. Upstream's rule stands: a reconstruction is accepted on the saved images read back
 * and compared, not on the numbers alone.
 */

const tool = resolve(import.meta.dirname, "..");
const repo = resolve(tool, "../..");
const forge = join(tool, "upstream", "forge");

export interface ReviewOptions {
  /** An ObjectSpec JSON file. */
  readonly spec: string;
  /** The reference photo (PNG or JPEG). */
  readonly reference: string;
  /** Where the review's files go. Created if missing. */
  readonly out: string;
  /** A token preset id. Default "neutral". */
  readonly look?: string;
  /** The reference's camera orbit, degrees. Default 0, 0: straight on. */
  readonly yaw?: number;
  readonly pitch?: number;
  /** The built catalog (it holds embed.html). Default apps/catalog/dist. */
  readonly catalogDist?: string;
  /** The render's longest side, in pixels. Default 1024, or the photo's own size if smaller. */
  readonly maxSide?: number;
}

const referenceSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  background: z.string().regex(/^#[0-9a-f]{6}$/),
  warnings: z.array(z.string()),
});

export type ReferenceMeasure = z.output<typeof referenceSchema>;

export interface ReviewResult {
  readonly spec: { readonly id: string; readonly name: string; readonly parts: number };
  readonly reference: ReferenceMeasure & { readonly path: string };
  readonly look: string;
  readonly view: { readonly yaw: number; readonly pitch: number };
  readonly files: { readonly render: string; readonly threeQuarter: string; readonly sheet: string; readonly scores: string; readonly review: string };
  /** The Divine Eye's verdict, as it reported it. */
  readonly scores: unknown;
}

/**
 * Runs a forge script. `verdictExit`: the script reports its verdict through the exit code (the
 * Divine Eye exits non-zero on anything short of a pass), so a non-zero exit with JSON on stdout is
 * a result, not a failure.
 */
function python(script: string, args: readonly string[], { verdictExit = false } = {}): string {
  const result = spawnSync("python3", ["-I", script, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) throw new Error(`could not run python3: ${result.error.message}`, { cause: result.error });
  const reported = verdictExit && result.stdout.trimStart().startsWith("{");
  if (result.status !== 0 && !reported) throw new Error(`${script.slice(tool.length + 1)} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout;
}

/** The photo's size, subject box and background, from the forge's own mask. */
export function measureReference(path: string): ReferenceMeasure {
  const parsed: unknown = JSON.parse(python(join(tool, "review", "reference_box.py"), [path]));
  return referenceSchema.parse(parsed);
}

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
};

/** Serves the built catalog read-only, plus the spec under review at /__review/spec.json. */
async function serve(dist: string, spec: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
    if (path === "/__review/spec.json") {
      response.writeHead(200, { "content-type": "application/json" }).end(spec);
      return;
    }
    const file = normalize(join(dist, path === "/" ? "index.html" : path));
    if (!file.startsWith(dist + sep) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = z.object({ port: z.number() }).parse(server.address());
  return { server, origin: `http://127.0.0.1:${String(port)}` };
}

interface View {
  readonly file: string;
  readonly yaw: number;
  readonly pitch: number;
  readonly fit?: ReferenceMeasure["box"];
}

async function render(origin: string, views: readonly View[], size: { width: number; height: number }, look: string, background: string): Promise<void> {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    // One page per view, side by side: each draws one frame and is screenshotted.
    await Promise.all(
      views.map(async (view) => {
        const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
        const query = new URLSearchParams({
          spec: "/__review/spec.json",
          look,
          width: String(size.width),
          height: String(size.height),
          bg: background,
          yaw: String(view.yaw),
          pitch: String(view.pitch),
          ...(view.fit === undefined ? {} : { fit: view.fit.join(",") }),
        });
        await page.goto(`${origin}/embed.html?${query.toString()}`);
        // The page sets __ltsEmbed to "drawn" or "error" once it is done (see apps/catalog/src/embed.ts).
        const status = await page.waitForFunction(
          () => {
            const state: unknown = Reflect.get(globalThis, "__ltsEmbed");
            if (typeof state !== "object" || state === null || !("status" in state) || state.status === "loading") return false;
            return "error" in state ? `error: ${String(state.error)}` : String(state.status);
          },
          undefined,
          { timeout: 60_000 },
        );
        const current: unknown = await status.jsonValue();
        if (current !== "drawn") throw new Error(`the embed page did not draw ${view.file}: ${String(current)}`);
        await page.locator("canvas").screenshot({ path: view.file });
      }),
    );
  } finally {
    await browser.close();
  }
}

/** Renders `options.spec` framed like `options.reference`, builds the comparison sheet and scores it. */
export async function reviewObject(options: ReviewOptions): Promise<ReviewResult> {
  const specText = readFileSync(options.spec, "utf8");
  const parsedSpec: unknown = JSON.parse(specText);
  const spec: ObjectSpec = parseObjectSpec(parsedSpec);
  const reference = resolve(options.reference);
  if (!existsSync(reference)) throw new Error(`no reference image at ${reference}`);
  const dist = resolve(options.catalogDist ?? join(repo, "apps", "catalog", "dist"));
  if (!existsSync(join(dist, "embed.html"))) throw new Error(`no embed page in ${dist}; run bun run build first`);
  const look = options.look ?? "neutral";
  const yaw = options.yaw ?? 0;
  const pitch = options.pitch ?? 0;

  const measure = measureReference(reference);
  const scale = Math.min(1, (options.maxSide ?? 1024) / Math.max(measure.width, measure.height));
  const size = { width: Math.max(16, Math.round(measure.width * scale)), height: Math.max(16, Math.round(measure.height * scale)) };

  const out = resolve(options.out);
  mkdirSync(out, { recursive: true });
  const files = {
    render: join(out, "render.png"),
    threeQuarter: join(out, "three-quarter.png"),
    sheet: join(out, "sheet.png"),
    scores: join(out, "scores.json"),
    review: join(out, "review.json"),
  };

  const { server, origin } = await serve(dist, specText);
  try {
    await render(
      origin,
      [
        { file: files.render, yaw, pitch, fit: measure.box },
        { file: files.threeQuarter, yaw: yaw + 35, pitch: Math.min(89, pitch + 15) },
      ],
      size,
      look,
      measure.background,
    );
  } finally {
    await new Promise<void>((done) => server.close(() => {
      done();
    }));
  }

  python(join(forge, "stage4_review", "make_comparison_sheet.py"), ["--reference", reference, "--render", files.render, "--out", files.sheet, "--json"]);
  const scores: unknown = JSON.parse(python(join(forge, "stage4_review", "divine_eye.py"), ["--reference", reference, "--render", files.render, "--json"], { verdictExit: true }));
  writeFileSync(files.scores, `${JSON.stringify(scores, null, 2)}\n`);

  const result: ReviewResult = {
    spec: { id: spec.id, name: spec.name, parts: spec.parts.length },
    reference: { ...measure, path: reference },
    look,
    view: { yaw, pitch },
    files,
    scores,
  };
  writeFileSync(files.review, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
