// Makes the gallery posters from the still-frame rig's frames: `bun run --filter tool-assets posters -- --frames DIR`.
// DIR holds one PNG per 3D asset, named `<id>.png`, as `bun run stills` writes them. Each becomes a WebP of the poster size under
// assets/posters/, and the manifest the catalog and `validate` read is written again in full. Run where the rig runs (the WebGPU lane), never in CI.
// Posters are made by this script and committed; nobody edits one by hand.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadDescriptors } from "@hedronite/lts-registry";
import sharp from "sharp";
import { hasPoster, manifestPath, manifestSource, posterDir, posterEdge, posterInputHash, rigVersion, type PosterManifest } from "./posters.js";

const root = resolve(import.meta.dirname, "../../..");
const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};

const frames = flag("frames");
if (frames === undefined) {
  console.error("posters: pass --frames DIR, the folder the still-frame rig wrote (<id>.png for every 3D asset)");
  process.exit(2);
}
const quality = Number(flag("quality") ?? 80);
if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
  console.error("posters: --quality is a whole number from 1 to 100");
  process.exit(2);
}
const rig = rigVersion(root);
if (rig === undefined) {
  console.error("posters: no rig version; the still-frame rig's package has none yet");
  process.exit(2);
}

const registry = await loadDescriptors();
const assets = registry.list().filter((descriptor) => hasPoster(descriptor.meta));
await mkdir(join(root, posterDir), { recursive: true });
const made = await Promise.all(
  assets.map(async ({ meta, defaults }) => {
    const frame = join(resolve(frames), `${meta.id}.png`);
    if (!existsSync(frame)) return { id: meta.id, problem: `${meta.id}: no frame ${frame}` };
    const path = `${posterDir}/${meta.id}.webp`;
    // Lanczos down to the poster edge; the frame is square, so nothing is cropped.
    const webp = await sharp(await readFile(frame)).resize(posterEdge, posterEdge, { fit: "cover", kernel: "lanczos3" }).webp({ quality, effort: 6 }).toBuffer();
    await writeFile(join(root, path), webp);
    return { id: meta.id, entry: { path, size: posterEdge, hash: posterInputHash({ id: meta.id, defaults, rig }) } };
  }),
);
const problems = made.flatMap((each) => ("problem" in each ? [each.problem] : []));
if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
const manifest: Record<string, PosterManifest[string]> = Object.fromEntries(made.flatMap((each) => ("entry" in each ? [[each.id, each.entry] as const] : [])));
// A poster whose asset is gone goes with it.
const kept = new Set(Object.values(manifest).map((entry) => entry.path.slice(posterDir.length + 1)));
await Promise.all((await readdir(join(root, posterDir))).filter((name) => name.endsWith(".webp") && !kept.has(name)).map((name) => rm(join(root, posterDir, name))));
await writeFile(join(root, manifestPath), manifestSource(manifest));
console.log(`posters: ${String(Object.keys(manifest).length)} written to ${posterDir} (${String(posterEdge)}x${String(posterEdge)}, quality ${String(quality)}, rig ${rig})`);
