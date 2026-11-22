import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { freemem, loadavg } from "node:os";

/** What was true of the machine and the call when a spawn did not run, in one line: enough to tell a missing program from a missing folder from a machine out of memory or processes. */
function surroundings(done: SpawnSyncReturns<string>, options: SpawnSyncOptions): string {
  const error: NodeJS.ErrnoException | undefined = done.error;
  const cwd = typeof options.cwd === "string" ? (existsSync(options.cwd) ? "the folder is there" : "the folder is MISSING") : "no folder asked for";
  return [`errno ${String(error?.errno)}`, `syscall ${String(error?.syscall)}`, `pid ${String(done.pid)}`, `status ${String(done.status)}`, `signal ${String(done.signal)}`, cwd, `${String(Math.round(freemem() / 1048576))} MiB free`, `load ${loadavg().map((load) => load.toFixed(1)).join(" ")}`].join(", ");
}

/**
 * A finished `spawnSync` that really ran: an error to start it (no such program, no such folder to start in, no process or memory left to make one), a signal that
 * ended it or an output that is not text is thrown, naming the code, the message and the state of the machine, instead of being read as an empty or missing `stdout`.
 * A child that exits non-zero is a result, not an error here. `options` are the ones the child was started with.
 */
export function ran(done: SpawnSyncReturns<string>, what: string, options: SpawnSyncOptions = {}): SpawnSyncReturns<string> & { readonly stdout: string } {
  if (done.error !== undefined) {
    const code = "code" in done.error && typeof done.error.code === "string" ? done.error.code : "no code";
    throw new Error(`${what} did not run: ${code}: ${done.error.message} (${surroundings(done, options)})`);
  }
  if (done.signal !== null) throw new Error(`${what} was ended by the signal ${done.signal} (${surroundings(done, options)})`);
  if (typeof done.stdout !== "string") throw new Error(`${what} ran and gave no output text (stdout is ${typeof done.stdout}; ${surroundings(done, options)})`);
  return { ...done, stdout: done.stdout };
}
