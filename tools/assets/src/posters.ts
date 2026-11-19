// Posters: one WebP still per 3D asset, shown by the gallery before anything is built. The rig (G1) writes a frame per asset;
// `posterize.ts` turns the frames into posters and a light manifest; this file is the part both it and `validate` share.
//
//   assets/posters/<id>.webp                 the poster, twice the gallery tile (so it is sharp on a 2x screen)
//   apps/catalog/src/generated/posters.ts    the manifest: id to path, pixel size and an input hash
//
// The input hash says what a poster was made from: the asset id, its default parameters, the look and the rig version. When any
// of them changes, the poster is stale until it is made again. Nothing here edits a poster by hand.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AssetKind, AssetMeta } from "@hedronite/lts-core";
import { neutral } from "@hedronite/lts-tokens";
import type { Budgets } from "./budgets.js";

/** The kinds of asset that are drawn in 3D, so the kinds that have a poster. Icons are drawn as vectors. */
export const posterKinds = ["primitive", "material", "object", "shader", "effect", "scene"] as const satisfies readonly AssetKind[];

export function hasPoster(meta: AssetMeta): boolean {
  return posterKinds.some((kind) => kind === meta.kind);
}

/** The edge of a gallery tile's picture, in CSS pixels (`App.tsx` draws it at this size). */
export const galleryTile = 56;
/** The edge of a poster, in pixels: twice the tile. */
export const posterEdge = galleryTile * 2;

export const posterDir = "assets/posters";
export const manifestPath = "apps/catalog/src/generated/posters.ts";
/** The rig's version is the version of its package: whoever changes what a frame looks like bumps it. */
export const rigPackage = "tools/stills/package.json";

export interface PosterEntry {
  /** Relative to the repo root, forward slashes. */
  readonly path: string;
  /** The edge of the square image, in pixels. */
  readonly size: number;
  /** The input hash the poster was made from. */
  readonly hash: string;
}

export type PosterManifest = Readonly<Record<string, PosterEntry>>;

/** Keys in order, so the same values always make the same text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, each]) => `${JSON.stringify(key)}:${stable(each)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface PosterInput {
  readonly id: string;
  /** The asset's default parameters. */
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly rig: string;
}

/** What a poster was made from, as 16 hex digits. The look is the neutral one every still is taken in (its scene colors are part of the hash). */
export function posterInputHash({ id, defaults, rig }: PosterInput): string {
  const text = stable({ id, defaults, look: { id: neutral.id, scene: neutral.scene }, rig, edge: posterEdge });
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** The rig's version, or undefined while there is no rig. */
export function rigVersion(root: string): string | undefined {
  const file = join(root, rigPackage);
  if (!existsSync(file)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string" ? parsed.version : undefined;
}

/** The width and height of a WebP file (lossy, lossless or extended), or undefined if the bytes are not one. */
export function webpSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 30 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return undefined;
  const kind = tag(12);
  if (kind === "VP8X") return { width: 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16)), height: 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16)) };
  if (kind === "VP8L") {
    if (view.getUint8(20) !== 0x2f) return undefined;
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8 ") {
    if (view.getUint8(23) !== 0x9d || view.getUint8(24) !== 0x01 || view.getUint8(25) !== 0x2a) return undefined;
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  return undefined;
}

/** Writes the manifest module the catalog imports and `validate` reads. */
export function manifestSource(manifest: PosterManifest): string {
  const rows = Object.entries(manifest)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, { path, size, hash }]) => `  ${JSON.stringify(id)}: { path: ${JSON.stringify(path)}, size: ${String(size)}, hash: ${JSON.stringify(hash)} },`);
  return `// Generated by \`bun run --filter tool-assets posters\` from the still-frame rig. Do not edit by hand.
export interface Poster {
  /** Relative to the repo root. */
  readonly path: string;
  /** The edge of the square image, in pixels. */
  readonly size: number;
  /** What the poster was made from (asset id, default parameters, look, rig version). */
  readonly hash: string;
}

export const posters: Readonly<Record<string, Poster>> = {${rows.length === 0 ? "" : `\n${rows.join("\n")}\n`}};
`;
}

/** The manifest as committed, or undefined when there is none yet. */
export async function loadPosterManifest(root: string): Promise<PosterManifest | undefined> {
  const file = join(root, manifestPath);
  if (!existsSync(file)) return undefined;
  const loaded: unknown = await import(pathToFileURL(file).href);
  if (typeof loaded !== "object" || loaded === null || !("posters" in loaded) || typeof loaded.posters !== "object" || loaded.posters === null) return undefined;
  return Object.fromEntries(Object.entries(loaded.posters).flatMap(([id, entry]) => (isEntry(entry) ? [[id, entry] as const] : [])));
}

function isEntry(value: unknown): value is PosterEntry {
  return typeof value === "object" && value !== null && "path" in value && typeof value.path === "string" && "size" in value && typeof value.size === "number" && "hash" in value && typeof value.hash === "string";
}

export interface PosterAsset {
  readonly meta: AssetMeta;
  readonly defaults: Readonly<Record<string, unknown>>;
}

export interface PosterReport {
  readonly problems: readonly string[];
  readonly count: number;
  readonly totalBytes: number;
  readonly largest: { readonly id: string; readonly bytes: number } | undefined;
}

/**
 * Checks the posters against the assets, the manifest and the budget: every 3D asset has a poster the manifest names, the file is
 * there, is a WebP of the ruled size, is within its byte line, and was made from what the asset is now (the input hash); no poster
 * is left for an asset that is gone; all of them together are within the total. An asset with no poster is a problem here, so a new
 * asset passes `validate` only once its poster is made, in the same change.
 */
export function checkPosters(root: string, assets: readonly PosterAsset[], manifest: PosterManifest | undefined, budgets: Budgets["posters"], rig: string | undefined): PosterReport {
  const problems: string[] = [];
  if (budgets === undefined) problems.push("posters: no budget in assets/budgets.json");
  if (rig === undefined) problems.push(`posters: no rig version (${rigPackage})`);
  if (manifest === undefined) problems.push(`posters: no manifest (${manifestPath}); run \`bun run --filter tool-assets posters\``);
  let totalBytes = 0;
  let count = 0;
  let largest: PosterReport["largest"];
  const wanted = new Set<string>();
  for (const { meta, defaults } of assets) {
    if (!hasPoster(meta)) continue;
    wanted.add(meta.id);
    const entry = manifest?.[meta.id];
    if (manifest === undefined) continue;
    if (entry === undefined) {
      problems.push(`${meta.id}: no poster in the manifest`);
      continue;
    }
    const file = join(root, entry.path);
    if (!existsSync(file)) {
      problems.push(`${meta.id}: poster ${entry.path} is missing`);
      continue;
    }
    const bytes = statSync(file).size;
    count += 1;
    totalBytes += bytes;
    if (largest === undefined || bytes > largest.bytes) largest = { id: meta.id, bytes };
    if (budgets !== undefined && bytes > budgets.perPosterBytes) problems.push(`${meta.id}: poster is ${String(bytes)} bytes, over the ${String(budgets.perPosterBytes)} limit`);
    const size = webpSize(readFileSync(file));
    if (size === undefined) problems.push(`${meta.id}: ${entry.path} is not a WebP`);
    else if (size.width !== posterEdge || size.height !== posterEdge || entry.size !== posterEdge) problems.push(`${meta.id}: poster is ${String(size.width)}x${String(size.height)} (manifest ${String(entry.size)}), expected ${String(posterEdge)}x${String(posterEdge)}`);
    if (rig !== undefined && entry.hash !== posterInputHash({ id: meta.id, defaults, rig })) problems.push(`${meta.id}: poster is stale (the asset, its defaults, the look or the rig changed); make it again`);
  }
  if (manifest !== undefined) {
    for (const id of Object.keys(manifest)) if (!wanted.has(id)) problems.push(`${id}: a poster in the manifest for an asset that has none`);
  }
  if (budgets !== undefined && totalBytes > budgets.totalBytes) problems.push(`posters: ${String(totalBytes)} bytes in all, over the ${String(budgets.totalBytes)} limit`);
  return { problems, count, totalBytes, largest };
}
