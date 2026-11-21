// The looks tool.
//   bun run looks                     regenerate packages/tokens/src/generated/looks.ts and packages/core/src/generated/lookCredits.ts from assets/src/looks
//   bun run looks:check               fail if either is stale
//   bun run looks:convert FILE [--id ID --name NAME --category omarchy]
//                                     print the look a colors.toml makes, and what was adjusted
// Needs @hedronite/lts-tokens built (bun run build): the converter uses its contrast math.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { hedronite, lookCategories, neutral, type LookCategoryId } from "@hedronite/lts-tokens";
import { z } from "zod";
import { convertOmarchy, pairLooks, type Conversion } from "./convert.js";
import { isFirstParty, lookCredit, type LookCredit } from "./credits.js";
import { parseFlatToml } from "./toml.js";

const root = resolve(import.meta.dirname, "../../..");
const sourceDir = join(root, "assets/src/looks");
const outFile = join(root, "packages/tokens/src/generated/looks.ts");
/** The credit of each look that is someone else's work, in the core package, so a scene's code can carry it without reading assets/. */
const creditsFile = join(root, "packages/core/src/generated/lookCredits.ts");

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const categoryId = z.custom<LookCategoryId>((value) => lookCategories.some((c) => c.id === value), "unknown look category");

const indexSchema = z
  .object({
    category: categoryId,
    source: z.string().min(1),
    license: z.string().min(1),
    looks: z.record(slug, z.object({ name: z.string().min(1).max(40), credit: z.string().min(1).optional(), note: z.string().min(1).optional() }).strict()),
    /** Two one-scheme themes of one family that become one look following the viewer's scheme. */
    pairs: z.record(slug, z.object({ name: z.string().min(1).max(40), dark: slug, light: slug, credit: z.string().min(1).optional() }).strict()).optional(),
  })
  .strict();

/** Every look under assets/src/looks, converted, in category order and then by id, and the credit of each that carries one. */
async function convertAll(): Promise<{ readonly looks: readonly Conversion[]; readonly credits: readonly LookCredit[] }> {
  const folders = (await readdir(sourceDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const indexes = await Promise.all(folders.map(async (folder) => ({ folder, index: indexSchema.parse(JSON.parse(await readFile(join(sourceDir, folder, "looks.json"), "utf8"))) })));
  const jobs = await Promise.all(
    indexes.map(async ({ folder, index }) => {
      const present = (await readdir(join(sourceDir, folder), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
      const listed = Object.keys(index.looks);
      const unlisted = present.filter((id) => !listed.includes(id));
      const missing = listed.filter((id) => !present.includes(id));
      if (unlisted.length > 0 || missing.length > 0) {
        throw new Error(`assets/src/looks/${folder}: folders without a looks.json entry: [${unlisted.join(", ")}]; entries without a folder: [${missing.join(", ")}]`);
      }
      const singles = await Promise.all(
        Object.entries(index.looks).map(async ([id, meta]) => {
          const toml = await readFile(join(sourceDir, folder, id, "colors.toml"), "utf8");
          try {
            return convertOmarchy(parseFlatToml(toml), { id, name: meta.name, category: index.category, ...(meta.credit === undefined ? {} : { credit: meta.credit }) });
          } catch (error: unknown) {
            throw new Error(`assets/src/looks/${folder}/${id}/colors.toml: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
          }
        }),
      );
      // A paired theme appears only inside its pair.
      const byId = new Map(singles.map((conversion) => [conversion.preset.id, conversion]));
      const paired = new Set<string>();
      const pairs = Object.entries(index.pairs ?? {}).map(([id, pair]) => {
        const dark = byId.get(pair.dark);
        const light = byId.get(pair.light);
        if (dark === undefined || light === undefined) throw new Error(`assets/src/looks/${folder}/looks.json: pair "${id}" names a look that isn't listed`);
        for (const member of [pair.dark, pair.light]) {
          if (paired.has(member)) throw new Error(`assets/src/looks/${folder}/looks.json: "${member}" is in two pairs`);
          paired.add(member);
        }
        return pairLooks(dark, light, { id, name: pair.name, category: index.category, ...(pair.credit === undefined ? {} : { credit: pair.credit }) });
      });
      const credits = isFirstParty(index.license)
        ? []
        : [
            ...Object.entries(index.looks).flatMap(([id, meta]) => (paired.has(id) || meta.credit === undefined ? [] : [lookCredit({ id, name: meta.name, credit: meta.credit, palette: id, source: index.source })])),
            ...Object.entries(index.pairs ?? {}).flatMap(([id, pair]) => (pair.credit === undefined ? [] : [lookCredit({ id, name: pair.name, credit: pair.credit, palette: pair.dark, source: index.source })])),
          ];
      return { looks: [...singles.filter((conversion) => !paired.has(conversion.preset.id)), ...pairs], credits };
    }),
  );
  const order = (id: LookCategoryId): number => lookCategories.findIndex((c) => c.id === id);
  const all = jobs.flatMap((job) => job.looks).sort((a, b) => order(a.preset.category) - order(b.preset.category) || a.preset.id.localeCompare(b.preset.id));
  const taken = new Set([neutral.id, hedronite.id]);
  for (const { preset } of all) {
    if (taken.has(preset.id)) throw new Error(`look id "${preset.id}" is used twice`);
    taken.add(preset.id);
  }
  return { looks: all, credits: jobs.flatMap((job) => job.credits).sort((a, b) => a.subject.localeCompare(b.subject)) };
}

function render(all: readonly Conversion[]): string {
  const lines = [
    "// Generated by tools/looks from assets/src/looks. Do not edit; run `bun run looks`.",
    "// Each look's colors come from its colors.toml; the notes say what the converter moved to pass WCAG contrast.",
    'import type { Preset } from "../types.js";',
    "",
    "export const generatedLooks: readonly Preset[] = [",
  ];
  for (const { preset, adjustments } of all) {
    for (const note of adjustments) lines.push(`  // ${preset.id}: ${note}`);
    lines.push(`  ${JSON.stringify(preset)},`);
  }
  lines.push("];", "");
  return lines.join("\n");
}

/** The credits module: a `Credit` for each credited look, by look id. */
function renderCredits(credits: readonly LookCredit[]): string {
  const byId = Object.fromEntries(credits.map((credit) => [credit.subject, credit]));
  return [
    "// Generated by tools/looks from the looks.json files beside the palettes. Do not edit; run `bun run looks`.",
    "// The credit of each look that is someone else's work, by look id. The project's own looks carry none.",
    'import type { Credit } from "../credits.js";',
    "",
    `export const lookCredits: Readonly<Record<string, Credit>> = ${JSON.stringify(byId, null, 2)};`,
    "",
  ].join("\n");
}

const [command = "", ...rest] = process.argv.slice(2);
if (command === "generate" || command === "check") {
  const { looks, credits } = await convertAll();
  const outputs = [
    [outFile, render(looks)],
    [creditsFile, renderCredits(credits)],
  ] as const;
  if (command === "check") {
    const stale = (await Promise.all(outputs.map(async ([file, output]) => ((await readFile(file, "utf8").catch(() => "")) === output ? undefined : file.slice(root.length + 1))))).filter((file) => file !== undefined);
    if (stale.length > 0) {
      console.error(`${stale.join(", ")} stale: run \`bun run looks\``);
      process.exit(1);
    }
    console.log("looks: up to date");
  } else {
    await mkdir(dirname(creditsFile), { recursive: true });
    await Promise.all(outputs.map(async ([file, output]) => writeFile(file, output)));
    console.log(`looks: wrote ${outputs.map(([file]) => file.slice(root.length + 1)).join(" and ")}`);
  }
} else if (command === "convert") {
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { id: { type: "string" }, name: { type: "string" }, category: { type: "string" } } });
  const file = positionals[0];
  if (file === undefined) {
    console.error("usage: bun run looks:convert FILE [--id ID --name NAME --category omarchy]");
    process.exit(2);
  }
  const id = slug.parse(values.id ?? basename(dirname(resolve(file))));
  const name = values.name ?? id.replace(/(^|-)([a-z0-9])/g, (_, dash: string, c: string) => `${dash === "" ? "" : " "}${c.toUpperCase()}`);
  const category = categoryId.parse(values.category ?? "omarchy");
  const result = convertOmarchy(parseFlatToml(await readFile(file, "utf8")), { id, name, category });
  console.log(JSON.stringify(result, null, 2));
} else {
  console.error("usage: bun src/looks.ts generate | check | convert FILE [--id --name --category]");
  process.exit(2);
}
