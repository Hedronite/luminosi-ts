import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Picture } from "../../../stills/src/png.js";
import { sceneCommand } from "./command.js";
import { deflateSync } from "node:zlib";
import { ok } from "../envelope.js";
import { diskFiles, nodeContext, type Files } from "./io.js";
import { checkSide, isBlank, MAX_SIDE, renderScene, serve, type DrawFrame, type Stage } from "./render.js";
import { rootFiles } from "../mcp/roots.js";
import { operationNamed } from "./table.js";

const scratch = mkdtempSync(join(tmpdir(), "lts-render-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A picture of one color, with `plant` pixels (index to RGBA) set to another. */
function picture(width: number, height: number, color: readonly [number, number, number, number], plant: ReadonlyMap<number, readonly [number, number, number, number]> = new Map()): Picture {
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) rgba.set(plant.get(pixel) ?? color, pixel * 4);
  return { width, height, rgba };
}

const background = [245, 245, 245, 255] as const;

describe("isBlank", () => {
  it("is true for a frame of the stage's color and nothing else", () => {
    expect(isBlank(picture(8, 8, background))).toBe(true);
  });

  it("is false when one pixel, in any channel, is not the background", () => {
    expect(isBlank(picture(8, 8, background, new Map([[63, [245, 245, 244, 255]]])))).toBe(false);
    expect(isBlank(picture(8, 8, background, new Map([[0, [0, 0, 0, 255]]])))).toBe(false);
    expect(isBlank(picture(8, 8, background, new Map([[31, [245, 245, 245, 254]]])))).toBe(false);
  });

  it("is false for a frame that is another flat color: it is blank only against the stage's own", () => {
    expect(isBlank(picture(8, 8, [10, 10, 10, 255]))).toBe(false);
  });
});

describe("checkSide", () => {
  it("takes a side that is left out, and a whole number up to the cap", () => {
    expect(checkSide("width", undefined)).toBeUndefined();
    expect(checkSide("width", 1)).toBeUndefined();
    expect(checkSide("height", MAX_SIDE)).toBeUndefined();
  });

  it("names a side that is over the cap, under 1, or not a whole number", () => {
    expect(checkSide("width", MAX_SIDE + 1)).toBe("--width is at most 2048 pixels, and 2049 was asked");
    expect(checkSide("height", 0)).toBe("--height is a whole number of pixels, not 0");
    expect(checkSide("height", 100.5)).toBe("--height is a whole number of pixels, not 100.5");
    expect(checkSide("width", Number.NaN)).toBe("--width is a whole number of pixels, not NaN");
  });
});

describe("renderScene before any browser starts", () => {
  const paths = { root: scratch, command: "render" };
  const options = { document: "{}", out: join(scratch, "out.png") };

  it("refuses a side over the cap as a usage error, and says so before it looks for a build", async () => {
    expect(await renderScene({ ...options, width: 4096 }, paths, diskFiles)).toMatchObject({ ok: false, kind: "usage", exit: 2 });
    expect(await renderScene({ ...options, height: 4096 }, paths, diskFiles)).toMatchObject({ ok: false, kind: "usage", exit: 2 });
  });

  it("says not_built when the catalog has no still page", async () => {
    expect(await renderScene(options, paths, diskFiles)).toMatchObject({ ok: false, kind: "not_built", exit: 1 });
    mkdirSync(join(scratch, "apps/catalog/dist"), { recursive: true });
    expect(await renderScene(options, paths, diskFiles)).toMatchObject({ ok: false, kind: "not_built" });
  });
});

describe("renderScene and a path that is there", () => {
  const paths = { root: scratch, command: "render" };
  const taken = join(scratch, "taken.png");
  writeFileSync(taken, "a picture");

  it("refuses it as exists before anything is drawn, and leaves it as it was", async () => {
    expect(await renderScene({ document: "{}", out: taken }, paths, diskFiles)).toMatchObject({ ok: false, kind: "exists", exit: 1, error: "that file exists; name a new path, or pass --force to replace it" });
    expect(await renderScene({ document: "{}", out: taken, force: false }, paths, diskFiles)).toMatchObject({ ok: false, kind: "exists" });
    expect(readFileSync(taken, "utf8")).toBe("a picture");
  });

  it("goes on when force is set (here as far as the missing build), and when the path is new", async () => {
    expect(await renderScene({ document: "{}", out: taken, force: true }, paths, diskFiles)).toMatchObject({ ok: false, kind: "not_built" });
    expect(await renderScene({ document: "{}", out: join(scratch, "new.png") }, paths, diskFiles)).toMatchObject({ ok: false, kind: "not_built" });
  });
});

describe("serve", () => {
  it("serves a file of the built directory, refuses a path out of it, and answers 404 for a missing one", async () => {
    const dist = join(scratch, "served");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "still.html"), "<p>still</p>");
    writeFileSync(join(scratch, "secret.txt"), "outside");
    const { server, origin } = await serve(dist);
    try {
      const page = await fetch(`${origin}/still.html?doc`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await page.text()).toBe("<p>still</p>");
      expect((await fetch(`${origin}/nothing.js`)).status).toBe(404);
      expect((await fetch(`${origin}/..%2fsecret.txt`)).status).toBe(404);
      expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await new Promise<void>((done) => {
        server.close(() => {
          done();
        });
      });
    }
  });
});

describe("the render row of the scene table", () => {
  const fixture = join(import.meta.dirname, "../../../../packages/scene/fixtures/v1.json");
  const out = join(scratch, "row.png");

  it("is a row that needs the render browser, writes a file, and takes the document first", () => {
    const row = operationNamed("render");
    expect(row).toMatchObject({ name: "render", needs: "render", readOnly: false, positional: ["document"] });
  });

  it("reads the document like every scene operation does, so a bad one is refused with its place before any browser starts", async () => {
    const bad = join(scratch, "bad.json");
    writeFileSync(bad, '{ "format": ');
    expect(await sceneCommand(["render", bad, "--out", out])).toMatchObject({ ok: false, kind: "invalid", exit: 1, command: "scene render" });
    expect(await sceneCommand(["render", join(scratch, "missing.json"), "--out", out])).toMatchObject({ ok: false, command: "scene render" });
  });

  it("answers a side that is not digits, or not a side, and a path that is there without force, from the flag or the field", async () => {
    expect(await sceneCommand(["render", fixture, "--out", out, "--width", "wide"])).toMatchObject({ ok: false, kind: "usage", exit: 2, command: "scene render" });
    expect(await sceneCommand(["render", fixture, "--out", out, "--width", "4096"])).toMatchObject({ ok: false, kind: "usage", exit: 2 });
    expect(await sceneCommand(["render", fixture])).toMatchObject({ ok: false, kind: "usage", error: "out is required" });
    const taken = join(scratch, "row-taken.png");
    writeFileSync(taken, "a picture");
    expect(await sceneCommand(["render", fixture, "--out", taken])).toMatchObject({ ok: false, kind: "exists", exit: 1, command: "scene render" });
    expect(readFileSync(taken, "utf8")).toBe("a picture");
    const row = operationNamed("render");
    const ctx = await nodeContext();
    expect(await row?.run({ document: fixture, out, height: 4096 }, ctx)).toMatchObject({ ok: false, kind: "usage", exit: 2 });
    expect(await row?.run({ document: fixture, out, height: 0 }, ctx)).toMatchObject({ ok: false, kind: "usage" });
    expect(await row?.run({ document: fixture, out, depth: 1 }, ctx)).toMatchObject({ ok: false, kind: "usage" });
  });
});

// ---- the write goes through the files it is given -----------------------------------------------------------------------------

/** The CRC-32 a PNG chunk carries. */
const crcTable = Array.from({ length: 256 }, (_unused, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, body: Buffer): Buffer => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
};
/** An RGBA PNG of one color, the stage's background but for its first pixel, so it is a frame with something in it. */
function pngOf(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rows.set(x === 0 && y === 0 ? [200, 10, 10, 255] : background, y * (width * 4 + 1) + 1 + x * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

describe("renderScene writes through the files it is given", () => {
  const stage: Stage = { still: "ready", frames: 2, renderer: "a test renderer", error: "" };
  const drawnAs: DrawFrame = (_options, _paths, size) => Promise.resolve({ png: pngOf(size.width, size.height), stage });
  const world = () => {
    const base = realpathSync.native(mkdtempSync(join(scratch, "world-")));
    mkdirSync(join(base, "apps/catalog/dist"), { recursive: true });
    writeFileSync(join(base, "apps/catalog/dist/still.html"), "<!doctype html>");
    return { base, paths: { root: base, command: "render" } };
  };
  /** The files a render is given, with every call they are given written down. */
  const watched = (inner: Files): { readonly files: Files; readonly calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      files: {
        read: (path) => inner.read(path),
        write: (path, text, force) => inner.write(path, text, force),
        writeBytes: (path, bytes, force) => {
          calls.push(`writeBytes force=${String(force)} ${String(bytes.length)} bytes`);
          return inner.writeBytes(path, bytes, force);
        },
        exists: (path) => {
          calls.push("exists");
          return inner.exists(path);
        },
      },
    };
  };

  it("asks whether the path is there, draws, and writes the PNG once through writeBytes, with the bytes it drew", async () => {
    const { base, paths } = world();
    const { files, calls } = watched(diskFiles);
    const out = join(base, "frame.png");
    const result = await renderScene({ document: "{}", out, width: 16, height: 12 }, paths, files, drawnAs);
    expect(result).toMatchObject({ ok: true, data: { out, width: 16, height: 12, renderer: "a test renderer", frames: 2 } });
    expect(calls).toEqual(["exists", `writeBytes force=false ${String(pngOf(16, 12).length)} bytes`]);
    expect(readFileSync(out)).toEqual(pngOf(16, 12));
  });

  it("on the command line makes the nested folder --out is in, and answers with the envelope main answered with", async () => {
    const { base, paths } = world();
    const out = join(base, "frames", "2026", "frame.png");
    const result = await renderScene({ document: "{}", out, width: 16, height: 12 }, paths, diskFiles, drawnAs);
    const png = pngOf(16, 12);
    // The envelope as it was before the write went through the files: the same fields, in the same order.
    const before = ok("render", { out: resolve(out), width: 16, height: 12, sha256: createHash("sha256").update(png).digest("hex"), renderer: "a test renderer", frames: 2 });
    expect(JSON.stringify(result)).toBe(JSON.stringify(before));
    expect(readFileSync(out)).toEqual(png);
  });

  it("an MCP root's files refuse a folder that is not there, and make none", async () => {
    const { base, paths } = world();
    const root = join(base, "root");
    mkdirSync(root);
    const result = await renderScene({ document: "{}", out: join(root, "frames", "frame.png"), width: 16, height: 12 }, paths, rootFiles([root], true), drawnAs);
    expect(result).toMatchObject({ ok: false, kind: "failed" });
    expect(() => readFileSync(join(root, "frames", "frame.png"))).toThrow();
    expect(() => readFileSync(join(root, "frames"))).toThrow();
  });

  it("with force does not ask, and writes with force", async () => {
    const { base, paths } = world();
    const { files, calls } = watched(diskFiles);
    const out = join(base, "frame.png");
    writeFileSync(out, "old");
    expect(await renderScene({ document: "{}", out, width: 16, height: 12, force: true }, paths, files, drawnAs)).toMatchObject({ ok: true });
    expect(calls).toEqual([`writeBytes force=true ${String(pngOf(16, 12).length)} bytes`]);
    expect(readFileSync(out)).toEqual(pngOf(16, 12));
  });

  it("writes nothing itself: files that refuse the write leave nothing at the path, and their failure is the answer", async () => {
    const { base, paths } = world();
    const refusing: Files = { ...diskFiles, writeBytes: () => ({ ok: false, failure: { kind: "no_root", error: "not under a root" } }) };
    const out = join(base, "frame.png");
    expect(await renderScene({ document: "{}", out, width: 16, height: 12 }, paths, refusing, drawnAs)).toMatchObject({ ok: false, kind: "no_root", error: "not under a root" });
    expect(() => readFileSync(out)).toThrow();
  });

  it("writes no frame that was refused, and does not ask the files for it", async () => {
    const { base, paths } = world();
    const { files, calls } = watched(diskFiles);
    const blank: DrawFrame = (_options, _paths, size) => Promise.resolve({ png: pngOf(size.width + 1, size.height), stage });
    expect(await renderScene({ document: "{}", out: join(base, "frame.png"), width: 16, height: 12 }, paths, files, blank)).toMatchObject({ ok: false, kind: "failed" });
    expect(calls).toEqual(["exists"]);
  });

  it("with the files of an MCP root: a path that becomes a link out of the root while the browser draws is refused, forced or not, and the file it leads to is untouched", async () => {
    for (const force of [false, true]) {
      const { base, paths } = world();
      const root = join(base, "root");
      mkdirSync(root);
      const outside = join(base, "outside.txt");
      writeFileSync(outside, "untouched");
      const out = join(root, "frame.png");
      const swapping: DrawFrame = (options, drawPaths, size, command) => {
        symlinkSync(outside, out);
        return drawnAs(options, drawPaths, size, command);
      };
      // eslint-disable-next-line no-await-in-loop -- one world per case
      const result = await renderScene({ document: "{}", out, width: 16, height: 12, force }, paths, rootFiles([root], true), swapping);
      expect(result).toMatchObject({ ok: false, kind: "no_root" });
      expect(readFileSync(outside, "utf8")).toBe("untouched");
    }
  });
});
