import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { digestOf } from "./pin.js";
import { cacheDirFor, cacheHolds, holdsRaw, markerFile, resolveVendor } from "./resolve.js";

const scratch: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "lts-resolve-"));
  scratch.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const write = (dir: string, files: Readonly<Record<string, string>>): void => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
};

const commit = "0123456789abcdef0123456789abcdef01234567";

/** A repository with `assets/vendor/demo` (its CREDIT.md, a license and a pin) and a cache beside it. */
function world(options: { readonly kept?: boolean; readonly raw?: boolean; readonly cached?: boolean; readonly overlay?: boolean } = {}) {
  const base = temp();
  const vendorDir = join(base, "assets/vendor");
  const home = join(vendorDir, "demo");
  const cacheDir = join(base, ".vendor");
  write(home, { "CREDIT.md": "# Credit\n", LICENSE: "MIT\n" });
  if (options.raw === true) write(home, { "src/a.ts": "export const a = 1;\n" });
  if (options.overlay === true) write(home, { "README.md": "edited\n" });
  const content = temp();
  write(content, { "src/a.ts": "export const a = 1;\n", ...(options.overlay === true ? { "README.md": "edited\n" } : {}) });
  const contentHash = options.kept === true ? digestOf(home, true).hash : digestOf(content, false).hash;
  const pin =
    options.kept === true
      ? { schema: 1, kept: true, keptReason: "there is no repository to fetch from", source: "https://example.com/", contentHash }
      : { schema: 1, kept: false, sources: [{ source: "https://github.com/someone/demo", commit }], ...(options.overlay === true ? { overlay: ["README.md"] } : {}), contentHash };
  write(home, { "vendor.json": `${JSON.stringify(pin)}\n` });
  if (options.cached === true) {
    write(join(cacheDir, "demo"), { "src/a.ts": "export const a = 1;\n", LICENSE: "MIT\n" });
    write(cacheDir, { "demo.fetched.json": JSON.stringify({ schema: 1, folder: "demo", commits: [commit], contentHash }) });
  }
  return { base, vendorDir, home, cacheDir, contentHash, env: { LTS_VENDOR_CACHE: cacheDir } };
}

describe("resolveVendor", () => {
  it("gives the repository folder of a kept folder, cache or no cache", () => {
    const { vendorDir, home, env } = world({ kept: true });
    expect(resolveVendor("demo", { vendorDir, env })).toEqual({ ok: true, dir: home, via: "kept" });
  });

  it("gives the cache when it holds a copy verified against the pin, and prefers it to raw files in the repository", () => {
    const { vendorDir, cacheDir, env } = world({ raw: true, cached: true });
    expect(resolveVendor("demo", { vendorDir, env })).toEqual({ ok: true, dir: join(cacheDir, "demo"), via: "cache" });
  });

  it("gives the repository folder while raw files are still in it", () => {
    const { vendorDir, home, env } = world({ raw: true });
    expect(resolveVendor("demo", { vendorDir, env })).toEqual({ ok: true, dir: home, via: "repo" });
  });

  it("is `not_fetched`, naming the command, when there is no copy and no raw file", () => {
    const { vendorDir, env } = world({});
    const naming: unknown = expect.stringContaining("bun run vendor:fetch demo");
    expect(resolveVendor("demo", { vendorDir, env })).toMatchObject({ ok: false, kind: "not_fetched", error: naming });
  });

  it("does not count the folder's own files, its license files or its overlay as raw files", () => {
    const { vendorDir, home, env } = world({ overlay: true });
    expect(resolveVendor("demo", { vendorDir, env })).toMatchObject({ ok: false, kind: "not_fetched" });
    expect(holdsRaw(home, { schema: 1, kept: false, sources: [{ source: "https://github.com/someone/demo", commit }], overlay: ["README.md"], contentHash: "0".repeat(64) })).toBe(false);
    expect(holdsRaw(home, { schema: 1, kept: false, sources: [{ source: "https://github.com/someone/demo", commit }], contentHash: "0".repeat(64) })).toBe(true);
  });

  it("does not trust a copy with no marker, a marker for other commits, or a marker for another hash", () => {
    const withMarker = world({ cached: true });
    expect(resolveVendor("demo", { vendorDir: withMarker.vendorDir, env: withMarker.env })).toMatchObject({ ok: true, via: "cache" });
    rmSync(markerFile(withMarker.cacheDir, "demo"));
    expect(resolveVendor("demo", { vendorDir: withMarker.vendorDir, env: withMarker.env })).toMatchObject({ ok: false });
    const other = world({ cached: true });
    write(other.cacheDir, { "demo.fetched.json": JSON.stringify({ schema: 1, folder: "demo", commits: ["f".repeat(40)], contentHash: other.contentHash }) });
    expect(resolveVendor("demo", { vendorDir: other.vendorDir, env: other.env })).toMatchObject({ ok: false });
    write(other.cacheDir, { "demo.fetched.json": JSON.stringify({ schema: 1, folder: "demo", commits: [commit], contentHash: "e".repeat(64) }) });
    expect(resolveVendor("demo", { vendorDir: other.vendorDir, env: other.env })).toMatchObject({ ok: false });
    write(other.cacheDir, { "demo.fetched.json": "not json" });
    expect(resolveVendor("demo", { vendorDir: other.vendorDir, env: other.env })).toMatchObject({ ok: false });
  });

  it("treats a folder with no pin as a plain folder of the repository", () => {
    const base = temp();
    const vendorDir = join(base, "assets/vendor");
    write(join(vendorDir, "plain"), { "CREDIT.md": "x" });
    expect(resolveVendor("plain", { vendorDir, env: {} })).toEqual({ ok: true, dir: join(vendorDir, "plain"), via: "repo" });
  });
});

describe("the cache's place", () => {
  it("is $LTS_VENDOR_CACHE, else .vendor/ at the repository root", () => {
    const vendorDir = join("/r", "assets/vendor");
    expect(cacheDirFor({ vendorDir, env: { LTS_VENDOR_CACHE: "/c" } })).toBe("/c");
    expect(cacheDirFor({ vendorDir, env: {} })).toBe(join("/r", ".vendor"));
    expect(cacheDirFor({ vendorDir, env: { LTS_VENDOR_CACHE: "" } })).toBe(join("/r", ".vendor"));
    expect(cacheDirFor({ vendorDir })).toBe(join("/r", ".vendor"));
  });

  it("holds a folder only for the pin it was fetched for", () => {
    const { cacheDir, contentHash } = world({ cached: true });
    const pin = { schema: 1 as const, kept: false as const, sources: [{ source: "https://github.com/someone/demo", commit }], contentHash };
    expect(cacheHolds(cacheDir, "demo", pin)).toBe(true);
    expect(cacheHolds(cacheDir, "demo", { ...pin, contentHash: "1".repeat(64) })).toBe(false);
    expect(cacheHolds(cacheDir, "other", pin)).toBe(false);
  });
});
