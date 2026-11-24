// The roots of `lumin mcp`: the only places a tool may read a document from or write a file to. A path is resolved on disk (symlinks
// followed) before it is judged, and what is judged is what is opened, so a link that leads out of a root is a path outside it. Whatever is
// wrong with a path outside every root, the answer is the one fixed `no_root`, the same for a file that is there and one that is not:
// it never echoes the path, and it tells nothing about what lies beyond the roots.
//
// A write is judged again at the moment it is made, and the folder it lands in is the one that was judged: a folder replaced, between the
// judging and the write, by a link out of the roots or by another folder, is `no_root`, and a file that lands outside every root is taken
// away again. What is left is the moment between that last check and the write's own system call, which Node cannot close without
// descriptor-relative calls (`openat`) it does not have (SPEC-wave9 R16's remainder, narrowed to that moment).
import { lstatSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { diskFiles, writeBytesInFolder, type Failure, type Files, type Outcome } from "../scene/io.js";

/** The one answer for a path that is not inside a root: the same words for every such path, and none of the path's. */
export const NO_ROOT: Failure = { kind: "no_root", error: "that path is not inside a root this server was started with (--root); a path is read and written under a root only" };

/** The answer for a file written when the server was started without `--allow-write`. */
export const WRITE_NOT_ALLOWED: Failure = { kind: "write_not_allowed", error: "this server was started without --allow-write, so it writes no file: leave out out and force to get the result in the reply" };

/** The answer for `-`: stdin carries the protocol, so a document never comes from it. */
export const NO_STDIN: Failure = { kind: "usage", error: '"-" (stdin) is not available over MCP: give the document inline, or as a path under a root' };

const bad = <T>(failure: Failure): Outcome<T> => ({ ok: false, failure });

/** Where a path is on disk, and how it is shown: as given when it was relative, and relative to its root when it was not. */
export interface Located {
  readonly real: string;
  readonly display: string;
}

type Resolved = { readonly kind: "real"; readonly path: string } | { readonly kind: "missing" } | { readonly kind: "error" };

/** A path with every link followed: what is there, nothing there (or a file where a folder should be), or some other trouble. */
function resolved(path: string): Resolved {
  try {
    return { kind: "real", path: realpathSync.native(path) };
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    return code === "ENOENT" || code === "ENOTDIR" ? { kind: "missing" } : { kind: "error" };
  }
}

/** The real path of the nearest folder above `path` that exists. */
function nearest(path: string): string | undefined {
  let at = path;
  for (;;) {
    const found = resolved(at);
    if (found.kind === "real") return found.path;
    if (found.kind === "error") return undefined;
    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
}

/** Whether a real path is a root or lies under one. */
const inside = (roots: readonly string[], real: string): boolean => roots.some((root) => real === root || real.startsWith(root.endsWith(sep) ? root : root + sep));

/** A folder as it is on disk: its real path, and what the system knows of it, so that the folder that is there now can be told from the one that was judged. */
interface Folder {
  readonly real: string;
  readonly dev: number;
  readonly ino: number;
}

/** The folder at a path, followed through its links, as it is now: nothing when it is not a folder that is there. */
function folderOf(path: string): Folder | undefined {
  const found = resolved(path);
  if (found.kind !== "real") return undefined;
  try {
    const stat = statSync(found.path);
    return { real: found.path, dev: stat.dev, ino: stat.ino };
  } catch {
    return undefined;
  }
}

/** A file at a path, as the system knows it, and nothing when it is not there: `dev` and `ino` tell one file from any other. */
function fileAt(path: string): { readonly dev: number; readonly ino: number } | undefined {
  try {
    const stat = lstatSync(path);
    return { dev: stat.dev, ino: stat.ino };
  } catch {
    return undefined;
  }
}

/** What `rootFiles` calls around a write: a test's way to swap the folder in that moment, which the server never does. */
export interface WriteGuard {
  /** After the path is judged and before the folder is looked at again: a folder swapped under the judgment. */
  readonly before?: () => void;
  /** After the folder is looked at again and before the write: a write that lands where the folder went. */
  readonly during?: () => void;
  /** After the write and before the check that follows it: a folder swapped while the write was in flight. */
  readonly after?: () => void;
}

/**
 * A write that lands in the folder that was judged, or none at all: the folder is looked at again just before the write, and once more after
 * it, and a write into a folder that is not the one judged is `no_root`.
 *
 * What the write made is taken away again when it can still be shown to be its own: the path must hold the very file, by device and inode,
 * that appeared there when the write ran, and the write must not have been a forced one. A forced write replaces what is at the path, and a
 * file this write may have replaced is left where it is: taking away a file this write did not make is the worse of the two. That is also
 * why a folder renamed after the write leaves the file inside the roots where the folder went: without a descriptor for the folder, Node
 * cannot say which path that was.
 */
function writeInJudgedFolder(
  roots: readonly string[],
  real: string,
  force: boolean,
  guard: WriteGuard,
  write: (path: string) => Outcome<number>,
): Outcome<number> {
  const judged = folderOf(dirname(real));
  if (judged === undefined) return bad(NO_ROOT);
  guard.before?.();
  const now = folderOf(dirname(real));
  if (now === undefined || now.real !== judged.real || now.dev !== judged.dev || now.ino !== judged.ino) return bad(NO_ROOT);
  const existed = fileAt(real) !== undefined;
  guard.during?.();
  const written = write(real);
  if (!written.ok) return written;
  const created = existed ? undefined : fileAt(real);
  guard.after?.();
  const after = folderOf(dirname(real));
  const placed = resolved(real);
  const outside = placed.kind === "real" && !inside(roots, placed.path);
  const moved = after === undefined || after.real !== judged.real || after.dev !== judged.dev || after.ino !== judged.ino;
  if (!moved && !outside) return written;
  const here = fileAt(real);
  if (!force && created !== undefined && here !== undefined && here.dev === created.dev && here.ino === created.ino) {
    try {
      rmSync(real, { force: true });
    } catch {
      // Nothing of ours is at the path any more: there is nothing to take away.
    }
  }
  return bad(NO_ROOT);
}

/**
 * The place on disk of a path the client gave. A relative path is taken from the first root; an absolute one must lie under some root.
 * For a read the path is the file; for a write it is the file to create, whose folder must exist. A path that lies outside every root, by
 * `..`, by an absolute path or through a link, is `no_root`, whether or not anything is there.
 */
export function locate(roots: readonly string[], given: string, mode: "read" | "write"): Outcome<Located> {
  const [first] = roots;
  if (first === undefined || given === "" || given.includes("\0")) return bad(NO_ROOT);
  const candidate = isAbsolute(given) ? normalize(given) : normalize(join(first, given));
  const target = mode === "read" ? candidate : dirname(candidate);
  const found = resolved(target);
  if (found.kind === "error") return bad(NO_ROOT);
  if (found.kind === "missing") {
    const above = nearest(target);
    if (above === undefined || !inside(roots, above)) return bad(NO_ROOT);
    return bad(mode === "read" ? { kind: "not_found", error: "no such file" } : { kind: "failed", error: "the folder for that file does not exist" });
  }
  if (!inside(roots, found.path)) return bad(NO_ROOT);
  let real = mode === "read" ? found.path : join(found.path, basename(candidate));
  if (mode === "write") {
    try {
      // A link in the last place is followed here, and the file written is the one it leads to, which must be inside a root as well.
      if (lstatSync(real).isSymbolicLink()) {
        const through = resolved(real);
        if (through.kind !== "real" || !inside(roots, through.path)) return bad(NO_ROOT);
        real = through.path;
      }
    } catch {
      // Nothing is there yet: the file is new.
    }
  }
  const root = roots.find((candidateRoot) => inside([candidateRoot], real)) ?? first;
  return { ok: true, value: { real, display: isAbsolute(given) ? relative(root, real) || "." : given } };
}

/** Files that stay inside the roots, and write nothing unless the server was started with `--allow-write`. What is read and written is the file on disk, by the same code as the command line's. */
export function rootFiles(roots: readonly string[], allowWrite: boolean, guard: WriteGuard = {}): Files {
  return {
    read(path) {
      const at = locate(roots, path, "read");
      return at.ok ? diskFiles.read(at.value.real) : at;
    },
    write(path, text, force) {
      if (!allowWrite) return bad(WRITE_NOT_ALLOWED);
      const at = locate(roots, path, "write");
      return at.ok ? writeInJudgedFolder(roots, at.value.real, force, guard, (target) => diskFiles.write(target, text, force)) : at;
    },
    // Judged again at the moment of writing, whatever was judged before: a path that was inside a root when a tool was called and is a link out of it now is `no_root`.
    // What is opened is then the resolved file, without following a link, so a link put there between the judging and the opening is refused too.
    writeBytes(path, bytes, force) {
      if (!allowWrite) return bad(WRITE_NOT_ALLOWED);
      const at = locate(roots, path, "write");
      return at.ok ? writeInJudgedFolder(roots, at.value.real, force, guard, (target) => writeBytesInFolder(target, bytes, force)) : at;
    },
    exists(path) {
      if (!allowWrite) return bad(WRITE_NOT_ALLOWED);
      const at = locate(roots, path, "write");
      return at.ok ? diskFiles.exists(at.value.real) : at;
    },
  };
}
