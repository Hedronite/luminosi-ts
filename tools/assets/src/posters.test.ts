import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssetMeta } from "@hedronite/lts-core";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkPosters, hasPoster, loadPosterManifest, manifestSource, posterEdge, posterInputHash, webpSize, type PosterAsset, type PosterManifest } from "./posters.js";

const meta = (id: string, kind: AssetMeta["kind"]): AssetMeta => ({ id, kind, name: id, tags: [], version: "0.0.0", package: "@hedronite/lts-materials", added: "2026-11-18" });
const assets: readonly PosterAsset[] = [
  { meta: meta("matte", "material"), defaults: { roughness: 1 } },
  { meta: meta("hologram", "shader"), defaults: {} },
  { meta: meta("arrow", "icon"), defaults: {} },
];
const budget = { perPosterBytes: 20_000, totalBytes: 30_000 };
const rig = "1.0.0";

const root = mkdtempSync(join(tmpdir(), "posters-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

let good: PosterManifest;
let bytes: Buffer;
beforeAll(async () => {
  mkdirSync(join(root, "assets/posters"), { recursive: true });
  bytes = await sharp({ create: { width: posterEdge, height: posterEdge, channels: 3, background: "#3366cc" } }).webp({ quality: 80 }).toBuffer();
  good = Object.fromEntries(
    assets
      .filter(({ meta: m }) => hasPoster(m))
      .map(({ meta: m, defaults }) => {
        writeFileSync(join(root, `assets/posters/${m.id}.webp`), bytes);
        return [m.id, { path: `assets/posters/${m.id}.webp`, size: posterEdge, hash: posterInputHash({ id: m.id, defaults, rig }) }] as const;
      }),
  );
});

describe("posterInputHash", () => {
  const base = { id: "matte", defaults: { roughness: 1, color: "#fff" }, rig };
  it("is the same for the same input, whatever the order of the defaults", () => {
    expect(posterInputHash(base)).toBe(posterInputHash({ ...base, defaults: { color: "#fff", roughness: 1 } }));
    expect(posterInputHash(base)).toMatch(/^[0-9a-f]{16}$/);
  });
  it.each([
    ["the id", { ...base, id: "satin" }],
    ["a default", { ...base, defaults: { roughness: 0.5, color: "#fff" } }],
    ["the rig version", { ...base, rig: "1.0.1" }],
  ])("changes with %s", (_name, changed) => {
    expect(posterInputHash(changed)).not.toBe(posterInputHash(base));
  });
});

describe("webpSize", () => {
  it("reads the size of a lossy, a lossless and a transparent WebP", async () => {
    expect(webpSize(bytes)).toEqual({ width: posterEdge, height: posterEdge });
    const lossless = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#000" } }).webp({ lossless: true }).toBuffer();
    expect(webpSize(lossless)).toEqual({ width: 30, height: 20 });
    const alpha = await sharp({ create: { width: 17, height: 9, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).webp({ quality: 80 }).toBuffer();
    expect(webpSize(alpha)).toEqual({ width: 17, height: 9 });
  });
  it("says nothing of other bytes", () => {
    expect(webpSize(new Uint8Array(64))).toBeUndefined();
    expect(webpSize(new TextEncoder().encode("not a picture, and not long enough either"))).toBeUndefined();
  });
});

describe("checkPosters", () => {
  const check = (manifest: PosterManifest | undefined, budgets: typeof budget | undefined = budget, version: string | undefined = rig) => checkPosters(root, assets, manifest, budgets, version);

  it("passes when every 3D asset has a poster made from what it is, and counts them (icons need none)", () => {
    const report = check(good);
    expect(report.problems).toEqual([]);
    expect(report.count).toBe(2);
    expect(report.totalBytes).toBe(2 * bytes.length);
  });

  it("fails a poster missing from the manifest, and one whose file is gone", () => {
    expect(check(Object.fromEntries(Object.entries(good).filter(([id]) => id === "matte"))).problems).toEqual(["hologram: no poster in the manifest"]);
    const gone: PosterManifest = { ...good, hologram: { path: "assets/posters/nowhere.webp", size: posterEdge, hash: good["hologram"]?.hash ?? "" } };
    expect(check(gone).problems).toEqual(["hologram: poster assets/posters/nowhere.webp is missing"]);
  });

  it("fails a poster over its byte line, and all of them over the total", () => {
    expect(check(good, { perPosterBytes: bytes.length - 1, totalBytes: 1e9 }).problems).toEqual([`matte: poster is ${String(bytes.length)} bytes, over the ${String(bytes.length - 1)} limit`, `hologram: poster is ${String(bytes.length)} bytes, over the ${String(bytes.length - 1)} limit`]);
    expect(check(good, { perPosterBytes: 1e9, totalBytes: 2 * bytes.length - 1 }).problems).toEqual([`posters: ${String(2 * bytes.length)} bytes in all, over the ${String(2 * bytes.length - 1)} limit`]);
  });

  it("fails a stale poster: a default, the rig or the look moved on since it was made", () => {
    const stale = assets.map((asset) => (asset.meta.id === "matte" ? { ...asset, defaults: { roughness: 0.2 } } : asset));
    expect(checkPosters(root, stale, good, budget, rig).problems).toEqual(["matte: poster is stale (the asset, its defaults, the look or the rig changed); make it again"]);
    expect(check(good, budget, "2.0.0").problems).toHaveLength(2);
  });

  it("fails a poster of the wrong size or not a WebP", async () => {
    const small = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#000" } }).webp().toBuffer();
    writeFileSync(join(root, "assets/posters/small.webp"), small);
    writeFileSync(join(root, "assets/posters/png.webp"), new Uint8Array(100));
    const wrong: PosterManifest = {
      matte: { path: "assets/posters/small.webp", size: posterEdge, hash: good["matte"]?.hash ?? "" },
      hologram: { path: "assets/posters/png.webp", size: posterEdge, hash: good["hologram"]?.hash ?? "" },
    };
    expect(check(wrong).problems).toEqual([`matte: poster is 64x64 (manifest ${String(posterEdge)}), expected ${String(posterEdge)}x${String(posterEdge)}`, "hologram: assets/posters/png.webp is not a WebP"]);
  });

  it("fails a poster left for an asset that is gone, and a missing manifest, budget or rig", () => {
    expect(check({ ...good, gone: { path: "assets/posters/matte.webp", size: posterEdge, hash: "0" } }).problems).toEqual(["gone: a poster in the manifest for an asset that has none"]);
    expect(checkPosters(root, assets, undefined, undefined, undefined).problems).toEqual(["posters: no budget in assets/budgets.json", "posters: no rig version (tools/stills/package.json)", "posters: no manifest (assets/posters/manifest.json); run `bun run --filter tool-assets posters`"]);
  });
});

describe("manifestSource", () => {
  it("lists the posters by id, in order, as JSON the validate step reads back", () => {
    const text = manifestSource({ b: { path: "assets/posters/b.webp", size: 112, hash: "bb" }, a: { path: "assets/posters/a.webp", size: 112, hash: "aa" } });
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"b"'));
    expect(text.endsWith("\n")).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "manifest-"));
    mkdirSync(join(dir, "assets/posters"), { recursive: true });
    writeFileSync(join(dir, "assets/posters/manifest.json"), text);
    expect(loadPosterManifest(dir)).toEqual({ a: { path: "assets/posters/a.webp", size: 112, hash: "aa" }, b: { path: "assets/posters/b.webp", size: 112, hash: "bb" } });
    expect(loadPosterManifest(join(dir, "nowhere"))).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});
