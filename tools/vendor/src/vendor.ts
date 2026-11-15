// The vendor tool: assets/vendor → the catalog's Open source view.
//   bun run vendor          regenerate apps/catalog/src/generated/vendor.ts and the preview images it names
//   bun run vendor:check    fail if either is stale
// Every folder under assets/vendor must be listed in `folders` below, with its CREDIT.md.
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { firstUrl, humanize, parseCredit, parseDemoReadme, parseFrontMatter } from "./parse.js";

const root = resolve(import.meta.dirname, "../../..");
const vendorDir = join(root, "assets/vendor");
const outFile = join(root, "apps/catalog/src/generated/vendor.ts");
const publicDir = join(root, "apps/catalog/public");

type Kind = "icons" | "components" | "demos" | "skills";

interface Folder {
  readonly name: string;
  readonly kind: Kind;
  /** Icon packs made from this set: the pack id, or ids starting with it and a dash. */
  readonly packPrefix?: string;
  /** An image in the folder to show on its card, copied into the catalog's public files. */
  readonly preview?: string;
  /** Where the work can be seen, when that isn't the source. */
  readonly link?: string;
}

const folders: Readonly<Record<string, Folder>> = {
  lucide: { name: "Lucide", kind: "icons", packPrefix: "lucide" },
  famicons: { name: "Famicons", kind: "icons", packPrefix: "famicons" },
  "coreui-icons": { name: "CoreUI Icons", kind: "icons", packPrefix: "coreui" },
  "stash-icons": { name: "Stash icons", kind: "icons", packPrefix: "stash" },
  isocons: { name: "Isometric Icons", kind: "icons", packPrefix: "isocons" },
  threeui: { name: "ThreeUI Community", kind: "components", preview: "assets/preview.jpg", link: "https://threeui.com" },
  techartist: { name: "Techartist demos", kind: "demos" },
  "ai-design-skills": { name: "AI design skills", kind: "skills" },
  "jakubkrehel-skills": { name: "Interface skills", kind: "skills" },
};

const KIND_ORDER: readonly Kind[] = ["icons", "components", "demos", "skills"];

interface Page {
  readonly path: string;
  readonly title: string;
  readonly markdown: string;
}

interface Item {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly link?: string;
  readonly pages: readonly Page[];
}

async function walk(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])));
  return nested.flat();
}

const pageTitle = (markdown: string, path: string): string => /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? humanize(basename(path).replace(/\.md$/i, ""));

/** A page: Markdown with its path inside the vendored folder, so the catalog can resolve relative links. */
async function page(folderDir: string, file: string, markdown?: string): Promise<Page> {
  const text = markdown ?? (await readFile(file, "utf8"));
  const path = relative(folderDir, file).split("\\").join("/");
  return { path, title: pageTitle(text, path), markdown: text.trim() };
}

async function skills(folderDir: string): Promise<readonly Item[]> {
  const skillsDir = join(folderDir, "skills");
  const ids = (await readdir(skillsDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  return Promise.all(
    ids.map(async (id) => {
      const dir = join(skillsDir, id);
      const skillFile = join(dir, "SKILL.md");
      const { fields, body } = parseFrontMatter(await readFile(skillFile, "utf8"));
      const description = fields.get("description");
      if (description === undefined || description === "") throw new Error(`${relative(root, skillFile)}: no description in its front matter`);
      const others = (await walk(dir)).filter((file) => file.endsWith(".md") && file !== skillFile).sort();
      const pages = [await page(folderDir, skillFile, body), ...(await Promise.all(others.map(async (file) => page(folderDir, file))))];
      return { id, name: fields.get("name") ?? id, description, pages };
    }),
  );
}

async function demos(folderDir: string): Promise<readonly Item[]> {
  const ids = (await readdir(folderDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  return Promise.all(
    ids.map(async (id) => {
      const readmeFile = join(folderDir, id, "README.md");
      const readme = await readFile(readmeFile, "utf8");
      const { description, live } = parseDemoReadme(readme);
      return { id, name: humanize(id), description, ...(live === undefined ? {} : { link: live }), pages: [] };
    }),
  );
}

async function readmeOf(folderDir: string): Promise<Page | undefined> {
  const names = await readdir(folderDir);
  const name = names.find((n) => n.toLowerCase() === "readme.md");
  return name === undefined ? undefined : page(folderDir, join(folderDir, name));
}

async function entries() {
  const present = (await readdir(vendorDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const unlisted = present.filter((id) => folders[id] === undefined);
  const missing = Object.keys(folders).filter((id) => !present.includes(id));
  if (unlisted.length > 0 || missing.length > 0) {
    throw new Error(`assets/vendor: folders not listed in tools/vendor: [${unlisted.join(", ")}]; listed but absent: [${missing.join(", ")}]`);
  }
  const all = await Promise.all(
    present.map(async (id) => {
      const folder = folders[id];
      if (folder === undefined) throw new Error(`assets/vendor/${id}: not listed`);
      const dir = join(vendorDir, id);
      const credit = parseCredit(await readFile(join(dir, "CREDIT.md"), "utf8"), `assets/vendor/${id}/CREDIT.md`);
      const sourceUrl = firstUrl(credit.source);
      if (sourceUrl === undefined) throw new Error(`assets/vendor/${id}/CREDIT.md: the source line has no URL`);
      const files = await walk(dir);
      const sizes = await Promise.all(files.map(async (file) => (await stat(file)).size));
      const items = folder.kind === "skills" ? await skills(dir) : folder.kind === "demos" ? await demos(dir) : [];
      const readme = await readmeOf(dir);
      return {
        id,
        name: folder.name,
        kind: folder.kind,
        ...credit,
        sourceUrl,
        ...(sourceUrl.startsWith("https://github.com/") ? { repo: sourceUrl.replace(/\/$/, "") } : {}),
        ...(folder.link === undefined ? {} : { link: folder.link }),
        ...(folder.packPrefix === undefined ? {} : { packPrefix: folder.packPrefix }),
        ...(folder.preview === undefined ? {} : { preview: `vendor/${id}-${basename(folder.preview)}` }),
        files: files.length,
        bytes: sizes.reduce((a, b) => a + b, 0),
        ...(readme === undefined ? {} : { readme }),
        items,
      };
    }),
  );
  return all.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
}

/** Preview images: source in assets/vendor → destination in the catalog's public files. */
const previews = (): readonly (readonly [string, string])[] =>
  Object.entries(folders).flatMap(([id, folder]) =>
    folder.preview === undefined ? [] : [[join(vendorDir, id, folder.preview), join(publicDir, "vendor", `${id}-${basename(folder.preview)}`)] as const],
  );

function render(all: Awaited<ReturnType<typeof entries>>): string {
  return [
    "// Generated by tools/vendor from assets/vendor. Do not edit; run `bun run vendor`.",
    "// Each entry's credit and license come from its folder's CREDIT.md; its pages are the folder's own Markdown.",
    'import type { VendorEntry } from "../vendored";',
    "",
    `export const vendored: readonly VendorEntry[] = ${JSON.stringify(all, null, 2)};`,
    "",
  ].join("\n");
}

const sameBytes = async (a: string, b: string): Promise<boolean> => {
  const [x, y] = await Promise.all([readFile(a), readFile(b).catch(() => undefined)]);
  return y !== undefined && x.equals(y);
};

const [command = ""] = process.argv.slice(2);
if (command === "generate" || command === "check") {
  const output = render(await entries());
  if (command === "check") {
    const current = await readFile(outFile, "utf8").catch(() => "");
    const stale = await Promise.all(previews().map(async ([from, to]) => ((await sameBytes(from, to)) ? undefined : relative(root, to))));
    const problems = [...(current === output ? [] : [relative(root, outFile)]), ...stale.filter((path) => path !== undefined)];
    if (problems.length > 0) {
      console.error(`stale: ${problems.join(", ")}: run \`bun run vendor\``);
      process.exit(1);
    }
    console.log("vendor: up to date");
  } else {
    await Promise.all([mkdir(join(publicDir, "vendor"), { recursive: true }), mkdir(dirname(outFile), { recursive: true })]);
    await Promise.all(previews().map(async ([from, to]) => copyFile(from, to)));
    await writeFile(outFile, output);
    console.log(`vendor: wrote ${relative(root, outFile)}`);
  }
} else {
  console.error("usage: bun src/vendor.ts generate | check");
  process.exit(2);
}
