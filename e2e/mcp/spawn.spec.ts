import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { ran } from "./spawn.js";

// The helper the MCP render spec reads every child it starts through (e2e/mcp/render.spec.ts): a spawn that did not run is an error that says why.
// Once a CI run died on `Cannot read properties of undefined (reading 'split')`, which named nothing.

test("a program that cannot start is an error naming its code and message, not an empty stdout", () => {
  const missing = ["lts-no-such", "program-here"].join("-");
  const done = spawnSync(missing, ["--version"], { encoding: "utf8" });
  expect(() => ran(done, `${missing} --version`)).toThrow(/did not run: ENOENT: .*lts-no-such-program-here/);
});

test("a child ended by a signal is an error naming the signal", () => {
  const done = spawnSync(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"], { encoding: "utf8" });
  expect(() => ran(done, "a child that kills itself")).toThrow(/was ended by the signal SIGTERM/);
});

test("a child that ran with its output thrown away has no stdout text: an error; and one that exits non-zero with output is a result", () => {
  const silent = spawnSync(process.execPath, ["-e", "1"], { encoding: "utf8", stdio: "ignore" });
  expect(() => ran(silent, "a silent child")).toThrow(/gave no output text/);
  const done = spawnSync(process.execPath, ["-e", "console.log('hello'); process.exit(3)"], { encoding: "utf8" });
  const result = ran(done, "node exiting 3");
  expect(result.status).toBe(3);
  expect(result.stdout.trim()).toBe("hello");
});
