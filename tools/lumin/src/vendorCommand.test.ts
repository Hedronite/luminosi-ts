import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { digestOf } from "tool-vendor/pin";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vendorCommand } from "./vendorCommand.js";

// Nothing here reaches the network: the archives are fixtures given to the command, and the global `fetch` throws.
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("a test opened a network connection");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const scratch: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "lumin-vendor-"));
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

/** A tar of regular files under `top`: the least an archive is. */
function tarOf(top: string, files: Readonly<Record<string, string>>): Buffer {
  const octal = (value: number, length: number): string => `${value.toString(8).padStart(length - 1, "0")}\0`;
  const block = (name: string, body: Buffer): Buffer => {
    const header = Buffer.alloc(512);
    header.write(name, 0, "utf8");
    header.write(octal(0o644, 8), 100, "ascii");
    header.write(octal(0, 8), 108, "ascii");
    header.write(octal(0, 8), 116, "ascii");
    header.write(octal(body.length, 12), 124, "ascii");
    header.write(octal(0, 12), 136, "ascii");
    header.fill(0x20, 148, 156);
    header.write("0", 156, "ascii");
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(octal(sum, 7), 148, "ascii");
    header[155] = 0x20;
    return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
  };
  const parts = Object.entries(files).map(([path, text]) => block(`${top}/${path}`, Buffer.from(text)));
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

const commit = "0123456789abcdef0123456789abcdef01234567";
const upstream = { "src/a.ts": "export const a = 1;\n", LICENSE: "MIT\n" };

/** A repository with a fetchable folder `demo` and a kept folder `kept`, a cache of its own, and a download that counts its calls. */
function world() {
  const base = temp();
  const vendorDir = join(base, "assets/vendor");
  const cacheDir = join(base, "cache");
  const content = temp();
  write(content, upstream);
  write(join(vendorDir, "demo"), { "CREDIT.md": "# Credit\n", LICENSE: "MIT\n", "vendor.json": `${JSON.stringify({ schema: 1, kept: false, sources: [{ source: "https://github.com/someone/demo", commit }], contentHash: digestOf(content, false).hash })}\n` });
  write(join(vendorDir, "kept"), { "CREDIT.md": "# Credit\n", LICENSE: "CC\n", "icons/a.svg": "<svg/>\n" });
  write(join(vendorDir, "kept"), { "vendor.json": `${JSON.stringify({ schema: 1, kept: true, keptReason: "there is no repository to fetch from", source: "https://example.com/", contentHash: digestOf(join(vendorDir, "kept"), true).hash })}\n` });
  const calls: string[] = [];
  const download = (url: string): Promise<AsyncIterable<Uint8Array>> => {
    calls.push(url);
    const tar = tarOf(`demo-${commit}`, upstream);
    return Promise.resolve(Readable.from([tar.subarray(0, 700), tar.subarray(700)]));
  };
  return { base, vendorDir, cacheDir, calls, context: { vendorDir, env: { LTS_VENDOR_CACHE: cacheDir }, download } };
}

describe("lumin vendor fetch", () => {
  it("fetches every pinned folder into the cache, names a kept folder as kept, and writes nothing in the repository", async () => {
    const { vendorDir, cacheDir, calls, context } = world();
    const result = await vendorCommand("fetch", [], { force: false }, context);
    expect(result).toMatchObject({ ok: true, command: "vendor fetch", data: { cache: cacheDir, folders: [{ folder: "demo", status: "fetched", commits: [commit], files: 2 }, { folder: "kept", status: "kept" }] } });
    expect(calls).toEqual([`https://codeload.github.com/someone/demo/tar.gz/${commit}`]);
    expect(readFileSync(join(cacheDir, "demo/src/a.ts"), "utf8")).toBe(upstream["src/a.ts"]);
    expect(digestOf(join(vendorDir, "demo"), false).files).toBe(0);
  });

  it("does not fetch again what the cache holds for the pin, unless --force", async () => {
    const { calls, context } = world();
    await vendorCommand("fetch", ["demo"], { force: false }, context);
    expect(await vendorCommand("fetch", ["demo"], { force: false }, context)).toMatchObject({ ok: true, data: { folders: [{ folder: "demo", status: "cached" }] } });
    expect(calls).toHaveLength(1);
    expect(await vendorCommand("fetch", ["demo"], { force: true }, context)).toMatchObject({ ok: true, data: { folders: [{ folder: "demo", status: "fetched" }] } });
    expect(calls).toHaveLength(2);
  });

  it("is a hash_mismatch envelope with both hashes when the archive is not the pin's, and a usage or unknown_vendor envelope for a bad ask", async () => {
    const { vendorDir, cacheDir, context } = world();
    write(join(vendorDir, "demo"), { "vendor.json": `${JSON.stringify({ schema: 1, kept: false, sources: [{ source: "https://github.com/someone/demo", commit }], contentHash: "f".repeat(64) })}\n` });
    const bad = await vendorCommand("fetch", ["demo"], { force: false }, context);
    const naming: unknown = expect.stringContaining("f".repeat(64));
    expect(bad).toMatchObject({ ok: false, kind: "hash_mismatch", exit: 1, data: { expected: "f".repeat(64), folder: "demo" }, error: naming });
    expect(() => readFileSync(join(cacheDir, "demo/src/a.ts"))).toThrow();
    expect(await vendorCommand("fetch", ["nope"], { force: false }, context)).toMatchObject({ ok: false, kind: "unknown_vendor", exit: 1 });
    expect(await vendorCommand("sync", [], { force: false }, context)).toMatchObject({ ok: false, kind: "usage", exit: 2 });
    expect(await vendorCommand("", [], { force: false }, context)).toMatchObject({ ok: false, kind: "usage", exit: 2 });
  });
});

describe("lumin vendor verify", () => {
  it("recomputes the hashes of what is cached, offline, and the kept folder's", async () => {
    const { context, calls } = world();
    await vendorCommand("fetch", [], { force: false }, context);
    const before = calls.length;
    const result = await vendorCommand("verify", [], { force: false }, context);
    expect(result).toMatchObject({ ok: true, data: { folders: [{ folder: "demo", status: "verified", files: 1 }, { folder: "kept", status: "kept" }], notFetched: [] } });
    expect(calls).toHaveLength(before);
  });

  it("is not_fetched for a folder asked for that the cache lacks, and for nothing fetched at all", async () => {
    const { context } = world();
    expect(await vendorCommand("verify", ["demo"], { force: false }, context)).toMatchObject({ ok: false, kind: "not_fetched", exit: 1 });
    // Only the kept folder is there to verify: that is a pass of one folder, and `notFetched` says what was not.
    expect(await vendorCommand("verify", [], { force: false }, context)).toMatchObject({ ok: true, data: { folders: [{ folder: "kept", status: "kept" }], notFetched: ["demo"] } });
  });

  it("names a cached file that was changed, a license that differs from the repository's, and a kept folder that was edited", async () => {
    const { vendorDir, cacheDir, context } = world();
    await vendorCommand("fetch", [], { force: false }, context);
    write(join(vendorDir, "demo"), { LICENSE: "changed\n" });
    expect(await vendorCommand("verify", ["demo"], { force: false }, context)).toMatchObject({ ok: false, kind: "license_changed", data: { differences: ["LICENSE"] } });
    write(join(vendorDir, "demo"), { LICENSE: "MIT\n" });
    write(cacheDir, { "demo/src/a.ts": "tampered\n" });
    expect(await vendorCommand("verify", ["demo"], { force: false }, context)).toMatchObject({ ok: false, kind: "hash_mismatch" });
    write(cacheDir, { "demo/src/a.ts": upstream["src/a.ts"] });
    write(join(vendorDir, "kept"), { "icons/a.svg": "<svg id='x'/>\n" });
    expect(await vendorCommand("verify", ["kept"], { force: false }, context)).toMatchObject({ ok: false, kind: "hash_mismatch" });
  });
});
