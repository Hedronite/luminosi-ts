// The roots of `lumin mcp`: the only places a tool may read a document from or write a file to. A path is resolved on disk (symlinks
// followed) before it is judged, and what is judged is what is opened, so a link that leads out of a root is a path outside it. Whatever is
// wrong with a path outside every root, the answer is the one fixed `no_root`, the same for a file that is there and one that is not:
// it never echoes the path, and it tells nothing about what lies beyond the roots.
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { diskFiles, type Failure, type Files, type Outcome } from "../scene/io.js";

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
export function rootFiles(roots: readonly string[], allowWrite: boolean): Files {
  return {
    read(path) {
      const at = locate(roots, path, "read");
      return at.ok ? diskFiles.read(at.value.real) : at;
    },
    write(path, text, force) {
      if (!allowWrite) return bad(WRITE_NOT_ALLOWED);
      const at = locate(roots, path, "write");
      return at.ok ? diskFiles.write(at.value.real, text, force) : at;
    },
    // Judged again at the moment of writing, whatever was judged before: a path that was inside a root when a tool was called and is a link out of it now is `no_root`.
    // What is opened is then the resolved file, without following a link, so a link put there between the judging and the opening is refused too.
    writeBytes(path, bytes, force) {
      if (!allowWrite) return bad(WRITE_NOT_ALLOWED);
      const at = locate(roots, path, "write");
      return at.ok ? diskFiles.writeBytes(at.value.real, bytes, force) : at;
    },
    exists(path) {
      if (!allowWrite) return bad(WRITE_NOT_ALLOWED);
      const at = locate(roots, path, "write");
      return at.ok ? diskFiles.exists(at.value.real) : at;
    },
  };
}
