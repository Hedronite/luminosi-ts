import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCredit, requirePin } from "./parse.js";

const vendorDir = resolve(import.meta.dirname, "../../../assets/vendor");
const folders = readdirSync(vendorDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

describe("assets/vendor credits", () => {
  it("has a folder to check", () => {
    expect(folders.length).toBeGreaterThanOrEqual(11);
  });

  it.each(folders)("%s is pinned to a commit, or a version and a hash", (folder) => {
    const where = `assets/vendor/${folder}/CREDIT.md`;
    const credit = parseCredit(readFileSync(join(vendorDir, folder, "CREDIT.md"), "utf8"), where);
    expect(requirePin(credit.source, where).length).toBeGreaterThan(0);
  });
});
