import type { SpawnSyncReturns } from "node:child_process";

/**
 * A finished `spawnSync` that really ran: an error to start it (no such program, no process left to make), a signal that ended it or an output that is
 * not text is thrown, naming the code and the message, instead of being read as an empty or missing `stdout`. A child that exits non-zero is a result, not an error here.
 */
export function ran(done: SpawnSyncReturns<string>, what: string): SpawnSyncReturns<string> & { readonly stdout: string } {
  if (done.error !== undefined) {
    const code = "code" in done.error && typeof done.error.code === "string" ? done.error.code : "no code";
    throw new Error(`${what} did not run: ${code}: ${done.error.message}`);
  }
  if (done.signal !== null) throw new Error(`${what} was ended by the signal ${done.signal}`);
  if (typeof done.stdout !== "string") throw new Error(`${what} ran and gave no output text (stdout is ${typeof done.stdout}, status ${String(done.status)})`);
  return { ...done, stdout: done.stdout };
}
