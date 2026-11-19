// assets/budgets.json, read and checked once for everything that uses it: the asset pipeline (`build.ts`), the
// post-build size check (`sizes.ts`) and `bun run validate`.
//
//   models   glTF files the pipeline writes: triangles, draw calls and brotli bytes of the .glb
//   bundles  JavaScript the apps ship: gzip -9 bytes of an entry's page-load set, or of the 3D chunk set
//   objects  what the catalog shows for each object: draw calls and triangles of the built hierarchy
//   goldens  the golden images of e2e/golden: their total bytes and the largest one's
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const count = z.number().int().nonnegative();

const budgetsSchema = z.strictObject({
  models: z.record(z.string(), z.strictObject({ triangles: count, drawCalls: count, brotliBytes: count })),
  bundles: z.record(z.string(), z.strictObject({ gzipBytes: count })),
  objects: z.record(z.string(), z.strictObject({ drawCalls: count, triangles: count })),
  goldens: z.record(z.string(), z.strictObject({ bytes: count, perImageBytes: count })),
});

export type Budgets = z.infer<typeof budgetsSchema>;

export async function loadBudgets(root: string): Promise<Budgets> {
  return budgetsSchema.parse(JSON.parse(await readFile(join(root, "assets/budgets.json"), "utf8")));
}
