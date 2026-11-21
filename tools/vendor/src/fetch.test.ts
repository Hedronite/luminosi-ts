import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFolder, FetchError, readTar, verifyFolder, type Download } from "./fetch.js";
import { digestOf, parsePin, type FetchablePin } from "./pin.js";
import { markerFile, readMarker, resolveVendor } from "./resolve.js";

// No test here reaches the network: the archive is a fixture the test hands to the fetch, and the global `fetch` is made to throw.
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
  const dir = mkdtempSync(join(tmpdir(), "lts-fetch-"));
  scratch.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// ---- a tar writer, for fixtures --------------------------------------------------------------------------------------

interface Item {
  readonly path: string;
  readonly data?: string;
  readonly type?: "0" | "2" | "1" | "5" | "3";
  readonly mode?: number;
  readonly link?: string;
}

const field = (text: string, length: number): Buffer => {
  const out = Buffer.alloc(length);
  out.write(text.slice(0, length), "utf8");
  return out;
};
const octal = (value: number, length: number): Buffer => field(`${value.toString(8).padStart(length - 1, "0")}\0`, length);

/** One header block and the padded body. */
function entry(type: string, name: string, body: Buffer, mode = 0o644, link = ""): Buffer {
  const header = Buffer.alloc(512);
  field(name, 100).copy(header, 0);
  octal(mode, 8).copy(header, 100);
  octal(0, 8).copy(header, 108);
  octal(0, 8).copy(header, 116);
  octal(body.length, 12).copy(header, 124);
  octal(0, 12).copy(header, 136);
  header.fill(0x20, 148, 156);
  header.write(type, 156, "utf8");
  field(link, 100).copy(header, 157);
  header.write("ustar\0", 257, "utf8");
  header.write("00", 263, "utf8");
  let sum = 0;
  for (const byte of header) sum += byte;
  octal(sum, 7).copy(header, 148);
  header[155] = 0x20;
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}

const pax = (records: Readonly<Record<string, string>>): Buffer => {
  const lines = Object.entries(records).map(([key, value]) => {
    const rest = ` ${key}=${value}\n`;
    let length = Buffer.byteLength(rest) + 1;
    while (String(length).length + Buffer.byteLength(rest) !== length) length = String(length).length + Buffer.byteLength(rest);
    return `${String(length)}${rest}`;
  });
  return Buffer.from(lines.join(""));
};

interface Options {
  /** The commit GitHub writes into the global header. */
  readonly comment?: string;
  readonly end?: boolean;
}

/** A tar of items, under `top`, as GitHub makes one. */
function tarOf(top: string, items: readonly Item[], options: Options = {}): Buffer {
  const blocks: Buffer[] = [];
  if (options.comment !== undefined) blocks.push(entry("g", "pax_global_header", pax({ comment: options.comment })));
  blocks.push(entry("5", `${top}/`, Buffer.alloc(0), 0o755));
  for (const item of items) {
    const path = `${top}/${item.path}`;
    const body = Buffer.from(item.data ?? "");
    if (Buffer.byteLength(path) > 100) {
      blocks.push(entry("x", "pax", pax({ path })));
      blocks.push(entry(item.type ?? "0", "long", body, item.mode ?? 0o644, item.link ?? ""));
    } else blocks.push(entry(item.type ?? "0", path, item.type === "2" || item.type === "1" ? Buffer.alloc(0) : body, item.mode ?? 0o644, item.link ?? ""));
  }
  if (options.end !== false) blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

/** A download of a tar, in chunks of an awkward size, so no header lines up with a chunk. */
const serve = (tar: Buffer, size = 333, failAfter?: number): Download => () => {
  function* chunks(): Generator<Uint8Array> {
    for (let at = 0, count = 0; at < tar.length; at += size, count += 1) {
      if (failAfter !== undefined && count >= failAfter) throw new Error("the connection dropped");
      yield tar.subarray(at, at + size);
    }
  }
  return Promise.resolve(Readable.from(chunks()));
};

// ---- fixtures: a folder, its pin, and a download --------------------------------------------------------------------

const commit = "0123456789abcdef0123456789abcdef01234567";
const top = `demo-${commit}`;

const files: readonly Item[] = [
  { path: "src/a.ts", data: "export const a = 1;\n" },
  { path: "src/run.sh", data: "#!/bin/sh\n", mode: 0o755 },
  { path: "docs/guide.md", data: "# guide\n" },
  { path: "LICENSE", data: "MIT\n" },
  { path: ".github/ci.yml", data: "on: push\n" },
  { path: "media/big.bin", data: "x".repeat(2000) },
];

/** A vendored folder `demo` in a fresh repository folder, its cache directory, and a pin whose hash is of what the pin keeps of `files`. */
function setup(extra: { readonly include?: readonly string[]; readonly exclude?: readonly string[]; readonly overlay?: readonly string[]; readonly items?: readonly Item[]; readonly hash?: string } = {}) {
  const base = temp();
  const vendorDir = join(base, "assets/vendor");
  mkdirSync(join(vendorDir, "demo"), { recursive: true });
  writeFileSync(join(vendorDir, "demo/CREDIT.md"), "# Credit\n");
  const cacheDir = join(base, ".vendor");
  const source = {
    source: "https://github.com/someone/demo",
    commit,
    ...(extra.include === undefined ? {} : { include: [...extra.include] }),
    ...(extra.exclude === undefined ? {} : { exclude: [...extra.exclude] }),
  };
  // The hash the pin should hold: what the pin keeps, written out and hashed by the definition.
  const expected = temp();
  const kept = (extra.items ?? files).filter((item) => {
    const include = extra.include ?? ["**"];
    const exclude = extra.exclude ?? [];
    const matches = (pattern: string): boolean => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*")}${pattern.endsWith("/") ? ".*" : ""}$`).test(item.path);
    return include.some(matches) && !exclude.some(matches);
  });
  for (const item of kept) {
    mkdirSync(dirname(join(expected, item.path)), { recursive: true });
    writeFileSync(join(expected, item.path), item.data ?? "");
  }
  for (const path of extra.overlay ?? []) {
    mkdirSync(dirname(join(vendorDir, "demo", path)), { recursive: true });
    writeFileSync(join(vendorDir, "demo", path), "overlay\n");
    mkdirSync(dirname(join(expected, path)), { recursive: true });
    writeFileSync(join(expected, path), "overlay\n");
  }
  const pin = parsePin({ schema: 1, kept: false, sources: [source], ...(extra.overlay === undefined ? {} : { overlay: [...extra.overlay] }), contentHash: extra.hash ?? digestOf(expected, false).hash }, "demo");
  if (pin.kept) throw new Error("not a fetchable pin");
  writeFileSync(join(vendorDir, "demo/vendor.json"), `${JSON.stringify(pin)}\n`);
  return { base, vendorDir, cacheDir, pin, tar: tarOf(top, extra.items ?? files, { comment: commit }) };
}

const leftovers = (cacheDir: string): string[] => (existsSync(cacheDir) ? readdirSync(cacheDir).filter((name) => name.startsWith(".tmp-") || name.startsWith(".old-")) : []);

describe("fetching a folder", () => {
  it("writes what the pin keeps, verifies the hash, and leaves a marker beside the folder", async () => {
    const { vendorDir, cacheDir, pin, tar } = setup();
    const fetched = await fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar) });
    expect(fetched).toMatchObject({ folder: "demo", commits: [commit], files: 6, contentHash: pin.contentHash });
    expect(readFileSync(join(cacheDir, "demo/src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(readFileSync(join(cacheDir, "demo/LICENSE"), "utf8")).toBe("MIT\n");
    expect(statSync(join(cacheDir, "demo/src/run.sh")).mode & 0o111).not.toBe(0);
    expect(statSync(join(cacheDir, "demo/src/a.ts")).mode & 0o111).toBe(0);
    expect(readMarker(cacheDir, "demo")).toEqual({ schema: 1, folder: "demo", commits: [commit], contentHash: pin.contentHash });
    expect(leftovers(cacheDir)).toEqual([]);
    expect(resolveVendor("demo", { vendorDir, env: { LTS_VENDOR_CACHE: cacheDir } })).toMatchObject({ ok: true, via: "cache" });
  });

  it("writes only what `include` names and `exclude` leaves, and never extracts the rest", async () => {
    const { vendorDir, cacheDir, pin, tar } = setup({ include: ["src/**", "LICENSE", ".github/"], exclude: [".github/"] });
    await fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar) });
    expect(readdirSync(join(cacheDir, "demo")).sort()).toEqual(["LICENSE", "src"]);
    expect(existsSync(join(cacheDir, "demo/media"))).toBe(false);
    expect(existsSync(join(cacheDir, "demo/.github"))).toBe(false);
  });

  it("drops an excluded path: a tree with it hashes differently from the pin's, and the pin's tree is what is written", async () => {
    const { vendorDir, cacheDir, pin, tar } = setup({ exclude: ["media/", ".github/"] });
    await fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar) });
    expect(existsSync(join(cacheDir, "demo/media/big.bin"))).toBe(false);
    expect(existsSync(join(cacheDir, "demo/docs/guide.md"))).toBe(true);
  });

  it("lays the overlay over the fetched tree before the hash", async () => {
    const { vendorDir, cacheDir, pin, tar } = setup({ overlay: ["docs/guide.md"] });
    await fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar) });
    expect(readFileSync(join(cacheDir, "demo/docs/guide.md"), "utf8")).toBe("overlay\n");
  });

  it("refuses an overlay that is not a file in the repository", async () => {
    const { vendorDir, cacheDir, pin, tar } = setup({ overlay: ["docs/guide.md"] });
    rmSync(join(vendorDir, "demo/docs/guide.md"));
    await expect(fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar) })).rejects.toMatchObject({ kind: "bad_pin" });
    expect(existsSync(join(cacheDir, "demo"))).toBe(false);
  });

  it("reads a path longer than a header holds (pax), and an archive in tiny chunks", async () => {
    const long = `${"deep/".repeat(30)}file.ts`;
    const items: readonly Item[] = [...files, { path: long, data: "deep\n" }];
    const { vendorDir, cacheDir, pin, tar } = setup({ items });
    await fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar, 7) });
    expect(readFileSync(join(cacheDir, "demo", long), "utf8")).toBe("deep\n");
  });

  it("puts each source of a folder under its own `into`", async () => {
    const base = temp();
    const vendorDir = join(base, "assets/vendor");
    mkdirSync(join(vendorDir, "multi"), { recursive: true });
    const other = "fedcba9876543210fedcba9876543210fedcba98";
    const expected = temp();
    mkdirSync(join(expected, "one"), { recursive: true });
    mkdirSync(join(expected, "two"), { recursive: true });
    writeFileSync(join(expected, "one/a.txt"), "one\n");
    writeFileSync(join(expected, "two/b.txt"), "two\n");
    const pin = parsePin(
      { schema: 1, kept: false, sources: [{ source: "https://github.com/x/one", commit, into: "one" }, { source: "https://github.com/x/two", commit: other, into: "two" }], contentHash: digestOf(expected, false).hash },
      "multi",
    );
    if (pin.kept) throw new Error("not fetchable");
    const archives = new Map([
      ["one", tarOf(`one-${commit}`, [{ path: "a.txt", data: "one\n" }], { comment: commit })],
      ["two", tarOf(`two-${other}`, [{ path: "b.txt", data: "two\n" }], { comment: other })],
    ]);
    const download: Download = (url) => {
      const archive = [...archives].find(([name]) => url.includes(`/x/${name}/`))?.[1];
      if (archive === undefined) throw new Error(`no fixture for ${url}`);
      return serve(archive)(url);
    };
    const cacheDir = join(base, ".vendor");
    await fetchFolder("multi", pin, { vendorDir, cacheDir, download });
    expect(readFileSync(join(cacheDir, "multi/one/a.txt"), "utf8")).toBe("one\n");
    expect(readFileSync(join(cacheDir, "multi/two/b.txt"), "utf8")).toBe("two\n");
  });

  it("asks for the archive of the pinned commit at GitHub's address", async () => {
    const { vendorDir, cacheDir, pin, tar } = setup();
    const asked: string[] = [];
    await fetchFolder("demo", pin, { vendorDir, cacheDir, download: (url) => (asked.push(url), serve(tar)(url)) });
    expect(asked).toEqual([`https://codeload.github.com/someone/demo/tar.gz/${commit}`]);
  });
});

describe("a fetch that does not match", () => {
  it("is an error with both hashes and nothing in the cache", async () => {
    const wrong = "b".repeat(64);
    const { vendorDir, cacheDir, pin, tar } = setup({ hash: wrong });
    const result = fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar) });
    await expect(result).rejects.toBeInstanceOf(FetchError);
    const error: unknown = await result.catch((caught: unknown) => caught);
    if (!(error instanceof FetchError)) throw new Error("not a FetchError");
    expect(error.kind).toBe("hash_mismatch");
    expect(error.message).toContain(wrong);
    expect(error.data).toMatchObject({ expected: wrong });
    expect(String(error.data?.["actual"])).toMatch(/^[0-9a-f]{64}$/);
    expect(error.message).toContain(String(error.data?.["actual"]));
    expect(existsSync(join(cacheDir, "demo"))).toBe(false);
    expect(existsSync(markerFile(cacheDir, "demo"))).toBe(false);
    expect(leftovers(cacheDir)).toEqual([]);
  });

  it("leaves a copy the cache already holds as it was", async () => {
    const { vendorDir, cacheDir, pin, tar } = setup();
    await fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar) });
    const before = digestOf(join(cacheDir, "demo"), false).hash;
    const wrong: FetchablePin = { ...pin, contentHash: "c".repeat(64) };
    await expect(fetchFolder("demo", wrong, { vendorDir, cacheDir, download: serve(tar) })).rejects.toMatchObject({ kind: "hash_mismatch" });
    expect(digestOf(join(cacheDir, "demo"), false).hash).toBe(before);
    expect(readMarker(cacheDir, "demo")?.contentHash).toBe(pin.contentHash);
  });

  it("is not a hit for the pin that changed: the cache holds a copy of the old one", async () => {
    const { vendorDir, cacheDir, pin, tar } = setup();
    await fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar) });
    const moved = parsePin({ ...pin, contentHash: "d".repeat(64) }, "demo");
    expect(resolveVendor("demo", { vendorDir, env: { LTS_VENDOR_CACHE: cacheDir } })).toMatchObject({ ok: true, via: "cache" });
    mkdirSync(join(vendorDir, "demo"), { recursive: true });
    writeFileSync(join(vendorDir, "demo/vendor.json"), JSON.stringify(moved));
    expect(resolveVendor("demo", { vendorDir, env: { LTS_VENDOR_CACHE: cacheDir } })).toMatchObject({ ok: false, kind: "not_fetched" });
  });
});

describe("an archive that is not what it should be", () => {
  /** Fetches an archive made of `items` (with whatever pin keeps them all) and gives the error. */
  async function refused(items: readonly Item[], options: Options = { comment: commit }, extra: { readonly include?: readonly string[] } = {}): Promise<FetchError> {
    const good = setup({ items: items.filter((item) => item.path === "ok.txt" || item.path === "src/a.ts"), ...extra });
    const tar = tarOf(top, items, options);
    const result = await fetchFolder("demo", good.pin, { vendorDir: good.vendorDir, cacheDir: good.cacheDir, download: serve(tar) }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    if (!(result instanceof FetchError)) throw new Error("the fetch was not refused");
    expect(existsSync(join(good.cacheDir, "demo"))).toBe(false);
    expect(existsSync(join(good.base, "evil.txt")) || existsSync(join(good.cacheDir, "evil.txt")) || existsSync("/etc/evil.txt")).toBe(false);
    expect(leftovers(good.cacheDir)).toEqual([]);
    return result;
  }

  it.each([
    ["a path that climbs out of the folder", "../evil.txt"],
    ["a path that climbs out deeper down", "src/../../evil.txt"],
    ["an absolute path inside the folder", "/etc/evil.txt"],
    ["a path with an empty part", "src//a.ts"],
    ["a path with a backslash", "src\\a.ts"],
    ["a drive path", "C:evil.txt"],
  ])("refuses %s", async (_name, path) => {
    const error = await refused([{ path: "src/a.ts", data: "a" }, { path, data: "evil" }]);
    expect(error.kind).toBe("unsafe_path");
  });

  it.each([
    ["a symlink", "2"],
    ["a hard link", "1"],
    ["a device", "3"],
  ] as const)("refuses %s in what the pin keeps", async (_name, type) => {
    const error = await refused([{ path: "src/a.ts", data: "a" }, { path: "src/link.ts", type, link: "../../secret" }]);
    expect(error.kind).toBe("unsafe_path");
    expect(error.message).toContain("src/link.ts");
  });

  it("ignores a link in what the pin leaves out", async () => {
    const items: readonly Item[] = [{ path: "src/a.ts", data: "a" }, { path: "site/link", type: "2", link: "/etc" }];
    const { vendorDir, cacheDir, pin } = setup({ items: [{ path: "src/a.ts", data: "a" }], exclude: ["site/"] });
    await fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tarOf(top, items, { comment: commit })) });
    expect(readdirSync(join(cacheDir, "demo"))).toEqual(["src"]);
  });

  it("refuses two paths that differ only in case, and one that appears twice", async () => {
    expect((await refused([{ path: "src/a.ts", data: "a" }, { path: "SRC/A.ts", data: "b" }])).kind).toBe("unsafe_path");
    expect((await refused([{ path: "src/a.ts", data: "a" }, { path: "src/a.ts", data: "b" }])).kind).toBe("unsafe_path");
  });

  it("refuses the archive of another commit: by its folder, and by the commit in its header", async () => {
    const items: readonly Item[] = [{ path: "src/a.ts", data: "a" }];
    const { vendorDir, cacheDir, pin } = setup({ items });
    await expect(fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tarOf(`demo-${"9".repeat(40)}`, items, { comment: commit })) })).rejects.toMatchObject({ kind: "bad_archive" });
    await expect(fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tarOf(top, items, { comment: "9".repeat(40) })) })).rejects.toMatchObject({ kind: "bad_archive" });
    await expect(fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tarOf("elsewhere", items, { comment: commit })) })).rejects.toMatchObject({ kind: "bad_archive" });
    expect(existsSync(join(cacheDir, "demo"))).toBe(false);
  });

  it("refuses a damaged header and a truncated archive, and an interrupted download leaves nothing", async () => {
    const { vendorDir, cacheDir, pin, tar } = setup();
    const damaged = Buffer.from(tar);
    damaged[1030] = (damaged[1030] ?? 0) ^ 0xff;
    await expect(fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(damaged) })).rejects.toMatchObject({ kind: "bad_archive" });
    await expect(fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar.subarray(0, tar.length - 3000)) })).rejects.toMatchObject({ kind: "bad_archive" });
    await expect(fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar, 333, 5) })).rejects.toThrow(/connection dropped/);
    expect(existsSync(join(cacheDir, "demo"))).toBe(false);
    expect(existsSync(markerFile(cacheDir, "demo"))).toBe(false);
    expect(leftovers(cacheDir)).toEqual([]);
  });
});

describe("reading a tar", () => {
  it("gives each wanted file its bytes, in order, and skips the rest", async () => {
    const seen: string[] = [];
    await readTar(await serve(tarOf(top, files))("x"), {
      select: (item) => item.path.endsWith(".ts") || item.path.endsWith(".md"),
      accept: (item, data) => {
        seen.push(`${item.path}:${String(data.length)}`);
        return Promise.resolve();
      },
    });
    expect(seen).toEqual([`${top}/src/a.ts:20`, `${top}/docs/guide.md:8`]);
  });

  it("reports the commit in the global header", async () => {
    const facts = await readTar(await serve(tarOf(top, [], { comment: commit }))("x"), { select: () => false, accept: () => Promise.resolve() });
    expect(facts.comment).toBe(commit);
  });
});

describe("verifying a cached folder offline", () => {
  it("passes a fetched folder, then names a changed file's hash and a license that differs from the repository's", async () => {
    const { vendorDir, cacheDir, pin, tar } = setup();
    await fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar) });
    writeFileSync(join(vendorDir, "demo/LICENSE"), "MIT\n");
    expect(verifyFolder("demo", pin, vendorDir, cacheDir)).toMatchObject({ folder: "demo", contentHash: pin.contentHash, licenseDifferences: [] });
    writeFileSync(join(vendorDir, "demo/LICENSE"), "changed\n");
    expect(verifyFolder("demo", pin, vendorDir, cacheDir).licenseDifferences).toEqual(["LICENSE"]);
    writeFileSync(join(cacheDir, "demo/src/a.ts"), "tampered\n");
    const caught = ((): unknown => {
      try {
        return verifyFolder("demo", pin, vendorDir, cacheDir);
      } catch (error: unknown) {
        return error;
      }
    })();
    expect(caught).toMatchObject({ kind: "hash_mismatch", data: { expected: pin.contentHash } });
  });

  it("is the same hash a different way: the files hashed by hand", async () => {
    const { vendorDir, cacheDir, pin, tar } = setup({ include: ["src/**"] });
    await fetchFolder("demo", pin, { vendorDir, cacheDir, download: serve(tar) });
    const lines = ["src/a.ts", "src/run.sh"].map((path) => `${createHash("sha256").update(readFileSync(join(cacheDir, "demo", path))).digest("hex")}  ${path}\n`).join("");
    expect(createHash("sha256").update(lines).digest("hex")).toBe(pin.contentHash);
  });
});
