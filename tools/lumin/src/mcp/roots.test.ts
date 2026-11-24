import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { locate, NO_ROOT, rootFiles, WRITE_NOT_ALLOWED, type WriteGuard } from "./roots.js";

const base = realpathSync.native(mkdtempSync(join(tmpdir(), "lts-w7-roots-")));
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

// A root with a document and a folder in it, and, beside it, a folder that is not a root, with a file and a folder in it.
const root = join(base, "root");
const beyond = join(base, "beyond");
mkdirSync(join(root, "docs"), { recursive: true });
mkdirSync(join(beyond, "inner"), { recursive: true });
writeFileSync(join(root, "a.json"), '{"a":1}');
writeFileSync(join(root, "docs/b.json"), '{"b":2}');
writeFileSync(join(beyond, "secret.json"), '{"secret":3}');
symlinkSync(join(beyond, "secret.json"), join(root, "link-file.json"));
symlinkSync(beyond, join(root, "link-dir"));
symlinkSync(join(beyond, "nothing-here.json"), join(root, "dangling.json"));
symlinkSync(join(root, "a.json"), join(root, "link-inside.json"));
const roots = [root];

const failureOf = (outcome: { readonly ok: boolean; readonly failure?: unknown }): unknown => (outcome.ok ? undefined : outcome.failure);

describe("a path under a root", () => {
  it("is read, relative to the first root or by its absolute path", () => {
    expect(rootFiles(roots, false).read("a.json")).toEqual({ ok: true, value: '{"a":1}' });
    expect(rootFiles(roots, false).read("docs/b.json")).toEqual({ ok: true, value: '{"b":2}' });
    expect(rootFiles(roots, false).read(join(root, "docs/b.json"))).toEqual({ ok: true, value: '{"b":2}' });
    expect(rootFiles(roots, false).read("docs/../a.json")).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("follows a link that stays inside", () => {
    expect(rootFiles(roots, false).read("link-inside.json")).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("that is not there is not_found, and says nothing of the path", () => {
    const outcome = rootFiles(roots, false).read("docs/missing-xyz.json");
    expect(outcome).toEqual({ ok: false, failure: { kind: "not_found", error: "no such file" } });
  });

  it("takes the second root's files by absolute path", () => {
    const second = join(base, "second");
    mkdirSync(second);
    writeFileSync(join(second, "c.json"), "{}");
    expect(rootFiles([root, second], false).read(join(second, "c.json"))).toEqual({ ok: true, value: "{}" });
    expect(rootFiles([root], false).read(join(second, "c.json"))).toEqual({ ok: false, failure: NO_ROOT });
  });
});

describe("a path outside the roots is the one fixed no_root, whether or not anything is there", () => {
  const outside: readonly (readonly [string, string])[] = [
    ["a parent path", "../beyond/secret.json"],
    ["a parent path to nothing", "../beyond/never-written.json"],
    ["a parent path deep in", "docs/../../beyond/secret.json"],
    ["an absolute path", join(beyond, "secret.json")],
    ["an absolute path to nothing", join(beyond, "never-written.json")],
    ["a system file", "/etc/passwd"],
    ["a link to a file outside", "link-file.json"],
    ["a path through a link to a folder outside", "link-dir/secret.json"],
    ["a path through a link to a folder outside, to nothing", "link-dir/never-written.json"],
    ["a NUL in the path", "a.json\0.png"],
    ["the empty path", ""],
  ];

  it.each(outside)("read: %s", (_label, path) => {
    expect(failureOf(rootFiles(roots, false).read(path))).toEqual(NO_ROOT);
  });

  it.each(outside.filter(([, path]) => path !== "link-file.json"))("write: %s", (_label, path) => {
    expect(failureOf(rootFiles(roots, true).write(path, "x", true))).toEqual(NO_ROOT);
  });

  it("never writes through a link that leads out, with force or without", () => {
    expect(failureOf(rootFiles(roots, true).write("link-file.json", "overwritten", true))).toEqual(NO_ROOT);
    expect(failureOf(rootFiles(roots, true).write("dangling.json", "planted", true))).toEqual(NO_ROOT);
    expect(readFileSync(join(beyond, "secret.json"), "utf8")).toBe('{"secret":3}');
    expect(() => readFileSync(join(beyond, "nothing-here.json"))).toThrow();
  });

  it("is the same words for every path, and names none", () => {
    for (const [, path] of outside) {
      const failure = failureOf(rootFiles(roots, false).read(path));
      expect(JSON.stringify(failure)).not.toContain("secret");
      expect(JSON.stringify(failure)).not.toContain(base);
    }
  });

  it("is what a server with no root says to every path", () => {
    expect(failureOf(rootFiles([], true).read("a.json"))).toEqual(NO_ROOT);
    expect(failureOf(rootFiles([], true).write("a.json", "x", true))).toEqual(NO_ROOT);
  });
});

describe("writing", () => {
  it("is refused whatever the path when the server was started without --allow-write", () => {
    expect(failureOf(rootFiles(roots, false).write("fresh.json", "x", false))).toEqual(WRITE_NOT_ALLOWED);
    expect(failureOf(rootFiles(roots, false).write("../beyond/fresh.json", "x", false))).toEqual(WRITE_NOT_ALLOWED);
    expect(() => readFileSync(join(root, "fresh.json"))).toThrow();
  });

  it("makes a new file, refuses one that is there, and replaces it only with force", () => {
    const files = rootFiles(roots, true);
    expect(files.write("docs/new.json", "one", false)).toEqual({ ok: true, value: 3 });
    expect(readFileSync(join(root, "docs/new.json"), "utf8")).toBe("one");
    expect(failureOf(files.write("docs/new.json", "two", false))).toMatchObject({ kind: "exists" });
    expect(files.write("docs/new.json", "three", true)).toEqual({ ok: true, value: 5 });
    expect(readFileSync(join(root, "docs/new.json"), "utf8")).toBe("three");
  });

  it("does not make a folder", () => {
    expect(failureOf(rootFiles(roots, true).write("no-such-folder/new.json", "x", false))).toEqual({ kind: "failed", error: "the folder for that file does not exist" });
  });

  it("does not make a folder for bytes either, new or forced (the command line does; a root's files never)", () => {
    const files = rootFiles(roots, true);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    expect(failureOf(files.writeBytes("no-such-folder/new.png", png, false))).toEqual({ kind: "failed", error: "the folder for that file does not exist" });
    expect(failureOf(files.writeBytes("no-such-folder/deeper/new.png", png, true))).toMatchObject({ kind: "failed" });
    expect(existsSync(join(root, "no-such-folder"))).toBe(false);
  });

  it("replaces, through a link that stays inside, the file it leads to", () => {
    expect(rootFiles(roots, true).write("link-inside.json", "through", true)).toEqual({ ok: true, value: 7 });
    expect(readFileSync(join(root, "a.json"), "utf8")).toBe("through");
  });
});

describe("writing bytes, and looking for a path, under a root", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const secret = (): string => readFileSync(join(beyond, "secret.json"), "utf8");

  it("writes nothing and looks at nothing without --allow-write", () => {
    expect(failureOf(rootFiles(roots, false).writeBytes("fresh.png", png, false))).toEqual(WRITE_NOT_ALLOWED);
    expect(failureOf(rootFiles(roots, false).exists("a.json"))).toEqual(WRITE_NOT_ALLOWED);
    expect(() => readFileSync(join(root, "fresh.png"))).toThrow();
  });

  it("makes a new file under a root, refuses one that is there, and replaces it only with force", () => {
    const files = rootFiles(roots, true);
    expect(files.writeBytes("docs/new.png", png, false)).toEqual({ ok: true, value: png.length });
    expect(readFileSync(join(root, "docs/new.png"))).toEqual(Buffer.from(png));
    expect(failureOf(files.writeBytes("docs/new.png", Uint8Array.from([1]), false))).toMatchObject({ kind: "exists" });
    expect(files.writeBytes(join(root, "docs/new.png"), Uint8Array.from([1, 2]), true)).toEqual({ ok: true, value: 2 });
    expect(readFileSync(join(root, "docs/new.png"))).toEqual(Buffer.from([1, 2]));
  });

  it("refuses a path out of every root, by `..`, through a link to a folder, or through a link to a file, and writes nothing there", () => {
    const files = rootFiles(roots, true);
    const paths = ["../beyond/out.png", "link-dir/out.png", "link-file.json", "dangling.json", join(beyond, "out.png")];
    expect(paths.map((path) => failureOf(files.writeBytes(path, png, true)))).toEqual(paths.map(() => NO_ROOT));
    expect(paths.map((path) => failureOf(files.writeBytes(path, png, false)))).toEqual(paths.map(() => NO_ROOT));
    expect(() => readFileSync(join(beyond, "out.png"))).toThrow();
    expect(secret()).toBe('{"secret":3}');
  });

  it("judges the path at the moment of writing: a link out of the root put at the path after it was looked at is refused, new or forced", () => {
    const files = rootFiles(roots, true);
    for (const force of [false, true]) {
      const name = force ? "late-forced.png" : "late.png";
      expect(files.exists(name)).toEqual({ ok: true, value: false });
      symlinkSync(join(beyond, "secret.json"), join(root, name));
      expect(failureOf(files.writeBytes(name, png, force))).toEqual(NO_ROOT);
      expect(secret()).toBe('{"secret":3}');
      rmSync(join(root, name));
    }
  });

  it("looks for a path under a root, and says nothing of one outside it", () => {
    const files = rootFiles(roots, true);
    expect(files.exists("a.json")).toEqual({ ok: true, value: true });
    expect(files.exists("docs/none.png")).toEqual({ ok: true, value: false });
    expect(failureOf(files.exists("../beyond/secret.json"))).toEqual(NO_ROOT);
    expect(failureOf(files.exists("link-file.json"))).toEqual(NO_ROOT);
    expect(failureOf(files.exists("no-such-folder/x.png"))).toEqual({ kind: "failed", error: "the folder for that file does not exist" });
  });
});

describe("where a path is shown", () => {
  it("as given when relative, and from its root when absolute", () => {
    const relative = locate(roots, "docs/new.json", "write");
    expect(relative.ok ? relative.value.display : "").toBe("docs/new.json");
    const absolute = locate(roots, join(root, "docs/fresh.json"), "write");
    expect(absolute.ok ? absolute.value.display : "").toBe("docs/fresh.json");
  });
});
// SPEC-wave10 G0, the parent-directory remainder of R16: a write is judged, and the folder it lands in can be swapped in a moment that is a
// race in the world and an ordinary event for a guard. What was judged is what is written, or nothing is, and what a write made is taken away
// again only when it can be shown to be its own.
describe("a write whose folder is swapped after the path was judged", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  /** A folder of its own under the root, and a guard that replaces it with `to` once, at the moment asked for. */
  const swapping = (name: string, to: string, moment: "before" | "during" | "after"): WriteGuard => {
    const folder = join(root, name);
    mkdirSync(folder, { recursive: true });
    let armed = true;
    const swap = (): void => {
      if (!armed) return;
      armed = false;
      rmSync(folder, { recursive: true, force: true });
      symlinkSync(to, folder);
    };
    return { [moment]: swap };
  };
  it("is refused when the folder becomes a link out of the roots before the write or while it is in flight, and nothing of it is left outside", () => {
    for (const moment of ["before", "after"] as const) {
      for (const force of [false, true]) {
        const name = `swapped-${moment}-${String(force)}`;
        expect(rootFiles(roots, true, swapping(name, beyond, moment)).writeBytes(`${name}/out.png`, png, force)).toEqual({ ok: false, failure: NO_ROOT });
        expect(rootFiles(roots, true, swapping(name, beyond, moment)).write(`${name}/out.json`, "{}", force)).toEqual({ ok: false, failure: NO_ROOT });
        expect(existsSync(join(beyond, "out.png"))).toBe(false);
        expect(existsSync(join(beyond, "out.json"))).toBe(false);
      }
    }
    expect(readFileSync(join(beyond, "secret.json"), "utf8")).toBe('{"secret":3}');
  });
  it("takes away a file it made outside the roots, and leaves one a forced write may have replaced", () => {
    // The swap lands between the folder being looked at and the write itself: the write lands where the folder went.
    const name = "swapped-during-bytes";
    expect(rootFiles(roots, true, swapping(name, beyond, "during")).writeBytes(`${name}/out.png`, png, false)).toEqual({ ok: false, failure: NO_ROOT });
    expect(existsSync(join(beyond, "out.png"))).toBe(false);
    // A forced write replaces what is at the path, so it cannot be shown to be the file's maker: what it wrote is left where it landed.
    const forced = "swapped-during-forced";
    expect(rootFiles(roots, true, swapping(forced, beyond, "during")).writeBytes(`${forced}/out.png`, png, true)).toEqual({ ok: false, failure: NO_ROOT });
    expect(readFileSync(join(beyond, "out.png"))).toEqual(Buffer.from(png));
    rmSync(join(beyond, "out.png"), { force: true });
  });
  it("leaves a file it did not make when the folder is swapped for a link out of the roots after the write", () => {
    // A file that was outside the roots before the write, at the place the swapped folder leads to.
    writeFileSync(join(beyond, "out.json"), "theirs");
    const name = "swapped-after-overwrite";
    expect(rootFiles(roots, true, swapping(name, beyond, "after")).write(`${name}/out.json`, "ours", true)).toEqual({ ok: false, failure: NO_ROOT });
    expect(readFileSync(join(beyond, "out.json"), "utf8")).toBe("theirs");
    rmSync(join(beyond, "out.json"), { force: true });
  });
  it("is refused when the folder becomes another folder inside the roots, so it is the folder judged that is written", () => {
    const other = join(root, "swapped-inside-target");
    mkdirSync(other, { recursive: true });
    const name = "swapped-inside";
    expect(rootFiles(roots, true, swapping(name, other, "before")).write(`${name}/out.json`, "{}", true)).toEqual({
      ok: false,
      failure: NO_ROOT,
    });
    expect(existsSync(join(other, "out.json"))).toBe(false);
  });
  it("is an ordinary write when the guard swaps nothing", () => {
    mkdirSync(join(root, "steady"), { recursive: true });
    const files = rootFiles(roots, true, { before: () => undefined, during: () => undefined, after: () => undefined });
    expect(files.write("steady/out.json", "{}", false)).toEqual({ ok: true, value: 2 });
    expect(files.writeBytes("steady/out.png", png, false)).toEqual({ ok: true, value: png.length });
  });
});
