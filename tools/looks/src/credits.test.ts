import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isFirstParty, lookCredit } from "./credits.js";

const source = "https://github.com/basecamp/omarchy/tree/d76f364b41ccf01909b1d84ffcc6bd4fbb8cd91d/themes";

describe("lookCredit", () => {
  it("reads who and the license from the credit text, pins the source, and names the palette's file", () => {
    expect(lookCredit({ id: "gruvbox", name: "Gruvbox", credit: "Gruvbox by Pavel Pertsev (morhetz), MIT", palette: "gruvbox", source })).toEqual({
      subject: "gruvbox",
      kind: "look",
      relation: "ported",
      work: "Gruvbox color scheme",
      source: "https://github.com/basecamp/omarchy",
      pin: "d76f364b41ccf01909b1d84ffcc6bd4fbb8cd91d",
      license: "MIT",
      credit: "Gruvbox by Pavel Pertsev (morhetz)",
      path: "themes/gruvbox/colors.toml",
    });
  });

  it("keeps a note after the semicolon in the work, and takes the dark palette of a pair", () => {
    expect(lookCredit({ id: "catppuccin", name: "Catppuccin", credit: "Catppuccin (catppuccin.com), MIT; dark is Mocha, light is Latte", palette: "catppuccin", source })).toMatchObject({
      work: "Catppuccin color scheme; dark is Mocha, light is Latte",
      credit: "Catppuccin (catppuccin.com)",
      path: "themes/catppuccin/colors.toml",
    });
    expect(lookCredit({ id: "duo", name: "Duo", credit: "Someone, MIT", palette: "duo-dark", source }).path).toBe("themes/duo-dark/colors.toml");
  });

  it("throws, naming the look, for a credit with no license or a source that is not pinned", () => {
    expect(() => lookCredit({ id: "x", name: "X", credit: "Someone", palette: "x", source })).toThrow('look "x"');
    expect(() => lookCredit({ id: "x", name: "X", credit: "Someone, not a license!", palette: "x", source })).toThrow('look "x"');
    expect(() => lookCredit({ id: "x", name: "X", credit: "Someone, MIT", palette: "x", source: "https://github.com/basecamp/omarchy/tree/main/themes" })).toThrow('look "x"');
  });
});

describe("isFirstParty", () => {
  it("is true for a license line that starts First-party, and for no other", () => {
    expect(isFirstParty("First-party (VirtualMachinist); the Hedron themes")).toBe(true);
    expect(isFirstParty("MIT, Copyright (c) David Heinemeier Hansson")).toBe(false);
  });
});

describe("the looks folders", () => {
  const indexSchema = z.object({ license: z.string(), source: z.string(), looks: z.record(z.string(), z.object({ credit: z.string().optional() })) });
  const dir = resolve(import.meta.dirname, "../../../assets/src/looks");
  const folders = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  it.each(folders)("%s is first-party, or every look it credits reads as a credit", (folder) => {
    const index = indexSchema.parse(JSON.parse(readFileSync(join(dir, folder, "looks.json"), "utf8")));
    const credited = Object.entries(index.looks).flatMap(([id, meta]) => (meta.credit === undefined ? [] : [{ id, credit: meta.credit }]));
    const firstParty = isFirstParty(index.license);
    const made = firstParty ? [] : credited.map(({ id, credit }) => lookCredit({ id, name: id, credit, palette: id, source: index.source }).subject);
    expect(made).toEqual(firstParty ? [] : credited.map(({ id }) => id));
  });
});
