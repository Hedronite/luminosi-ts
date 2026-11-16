// The vendor tool: assets/vendor → the catalog's Open source view.
//   bun run vendor          regenerate apps/catalog/src/generated/vendor.ts and the preview images it names
//   bun run vendor:check    fail if either is stale
// Every folder under assets/vendor must be listed in `folders` below, with its CREDIT.md.
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { firstUrl, humanize, parseCredit, parseDemoReadme, parseFrontMatter } from "./parse.js";

const root = resolve(import.meta.dirname, "../../..");
const vendorDir = join(root, "assets/vendor");
const outFile = join(root, "apps/catalog/src/generated/vendor.ts");
/** Each folder's pages in their own module, so the catalog loads one folder's Markdown at a time. */
const pagesDir = join(root, "apps/catalog/src/generated/vendor-pages");
const publicDir = join(root, "apps/catalog/public");

type Kind = "icons" | "components" | "demos" | "engines" | "skills";

interface Folder {
  readonly name: string;
  readonly kind: Kind;
  /** Icon packs made from this set: the pack id, or ids starting with it and a dash. */
  readonly packPrefix?: string;
  /** An image in the folder to show on its card, copied into the catalog's public files. */
  readonly preview?: string;
  /** Where the work can be seen, when that isn't the source. */
  readonly link?: string;
  /** Demos in numbered day folders, each live at this URL with {id} for the folder. */
  readonly days?: string;
  /** A folder of Markdown docs to read as one item. */
  readonly docs?: { readonly path: string; readonly description: string };
}

const folders: Readonly<Record<string, Folder>> = {
  lucide: { name: "Lucide", kind: "icons", packPrefix: "lucide" },
  famicons: { name: "Famicons", kind: "icons", packPrefix: "famicons" },
  "coreui-icons": { name: "CoreUI Icons", kind: "icons", packPrefix: "coreui" },
  "stash-icons": { name: "Stash icons", kind: "icons", packPrefix: "stash" },
  isocons: { name: "Isometric Icons", kind: "icons", packPrefix: "isocons" },
  threeui: { name: "ThreeUI Community", kind: "components", preview: "assets/preview.jpg", link: "https://threeui.com" },
  techartist: { name: "Techartist demos", kind: "demos" },
  "codevember-2026": { name: "Codevember 2026", kind: "demos", days: "https://ttillberg.github.io/codevember-2026/{id}/", link: "https://ttillberg.github.io/codevember-2026/" },
  threert: {
    name: "ThreeRT",
    kind: "engines",
    link: "https://threert.dev",
    docs: { path: "docs", description: "How the path tracer is built: architecture, runtime, material functions, parity with three.js, the voxel engine and the roadmap." },
  },
  "ai-design-skills": { name: "AI design skills", kind: "skills" },
  "jakubkrehel-skills": { name: "Interface skills", kind: "skills" },
};

const KIND_ORDER: readonly Kind[] = ["icons", "components", "demos", "engines", "skills"];

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

/** Numbered day folders (01 to 30), each a demo with its README and notes as pages and a live link. */
async function days(folderDir: string, live: string): Promise<readonly Item[]> {
  const ids = (await readdir(folderDir, { withFileTypes: true })).filter((e) => e.isDirectory() && /^\d{2}$/.test(e.name)).map((e) => e.name).sort();
  return Promise.all(
    ids.map(async (id) => {
      const dir = join(folderDir, id);
      const readmeFile = join(dir, "README.md");
      const readme = await readFile(readmeFile, "utf8");
      const title = /^#\s+(.+)$/m.exec(readme)?.[1]?.trim() ?? id;
      // The first paragraph that isn't the title or the date line.
      const description =
        readme
          .split(/\n\s*\n/)
          .map((block) => block.trim())
          .find((block) => block !== "" && !block.startsWith("#") && !/^\d{4}-\d{2}-\d{2}$/.test(block)) ?? "";
      const others = (await walk(dir)).filter((file) => file.endsWith(".md") && file !== readmeFile && !file.includes("/node_modules/")).sort();
      const pages = [await page(folderDir, readmeFile), ...(await Promise.all(others.map(async (file) => page(folderDir, file))))];
      return { id, name: title, description: description.replace(/\s+/g, " "), link: live.replace("{id}", id), pages };
    }),
  );
}

/** A folder of docs as one item, its Markdown files as pages. */
async function docsItem(folderDir: string, docs: { readonly path: string; readonly description: string }): Promise<Item> {
  const dir = join(folderDir, docs.path);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
  const pages = await Promise.all(files.map(async (name) => page(folderDir, join(dir, name))));
  return { id: "docs", name: "Documentation", description: docs.description, pages };
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
      const items =
        folder.kind === "skills"
          ? await skills(dir)
          : folder.days !== undefined
            ? await days(dir, folder.days)
            : folder.kind === "demos"
              ? await demos(dir)
              : folder.docs === undefined
                ? []
                : [await docsItem(dir, folder.docs)];
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

type Entry = Awaited<ReturnType<typeof entries>>[number];

/** Every page of a folder (its README and its items' pages), by path. */
const pagesOf = (entry: Entry): readonly Page[] => [...(entry.readme === undefined ? [] : [entry.readme]), ...entry.items.flatMap((item) => item.pages)];

const titleOnly = ({ path, title }: Page): { readonly path: string; readonly title: string } => ({ path, title });

/** The index: every folder with its credit and items, pages by path and title only. */
function renderIndex(all: readonly Entry[]): string {
  const index = all.map((entry) => ({
    ...entry,
    ...(entry.readme === undefined ? {} : { readme: titleOnly(entry.readme) }),
    items: entry.items.map((item) => ({ ...item, pages: item.pages.map(titleOnly) })),
  }));
  return [
    "// Generated by tools/vendor from assets/vendor. Do not edit; run `bun run vendor`.",
    "// Each entry's credit and license come from its folder's CREDIT.md. The pages' Markdown is in vendor-pages/<id>.ts.",
    'import type { VendorEntry } from "../vendored";',
    "",
    `export const vendored: readonly VendorEntry[] = ${JSON.stringify(index, null, 2)};`,
    "",
  ].join("\n");
}

/** One folder's Markdown, by page path. */
function renderPages(entry: Entry): string {
  const markdown = Object.fromEntries(pagesOf(entry).map((page) => [page.path, page.markdown]));
  return [
    "// Generated by tools/vendor from assets/vendor. Do not edit; run `bun run vendor`.",
    `// The Markdown of assets/vendor/${entry.id}, by path inside that folder.`,
    "",
    `export const markdown: Readonly<Record<string, string>> = ${JSON.stringify(markdown, null, 2)};`,
    "",
  ].join("\n");
}

/** Every generated file: path → content. */
function renderAll(all: readonly Entry[]): ReadonlyMap<string, string> {
  return new Map([[outFile, renderIndex(all)], ...all.filter((entry) => pagesOf(entry).length > 0).map((entry): [string, string] => [join(pagesDir, `${entry.id}.ts`), renderPages(entry)])]);
}

const sameBytes = async (a: string, b: string): Promise<boolean> => {
  const [x, y] = await Promise.all([readFile(a), readFile(b).catch(() => undefined)]);
  return y !== undefined && x.equals(y);
};

const [command = ""] = process.argv.slice(2);
if (command === "generate" || command === "check") {
  const files = renderAll(await entries());
  const existing = (await readdir(pagesDir).catch(() => [])).map((name) => join(pagesDir, name));
  const leftover = existing.filter((path) => !files.has(path));
  if (command === "check") {
    const differing = await Promise.all([...files].map(async ([path, content]) => ((await readFile(path, "utf8").catch(() => "")) === content ? undefined : relative(root, path))));
    const stale = await Promise.all(previews().map(async ([from, to]) => ((await sameBytes(from, to)) ? undefined : relative(root, to))));
    const problems = [...differing, ...stale, ...leftover.map((path) => `${relative(root, path)} (no longer generated)`)].filter((path) => path !== undefined);
    if (problems.length > 0) {
      console.error(`stale: ${problems.join(", ")}: run \`bun run vendor\``);
      process.exit(1);
    }
    console.log("vendor: up to date");
  } else {
    await Promise.all([mkdir(join(publicDir, "vendor"), { recursive: true }), mkdir(pagesDir, { recursive: true })]);
    await Promise.all(previews().map(async ([from, to]) => copyFile(from, to)));
    await Promise.all(leftover.map(async (path) => rm(path)));
    await Promise.all([...files].map(async ([path, content]) => writeFile(path, content)));
    console.log(`vendor: wrote ${relative(root, outFile)} and ${String(files.size - 1)} page modules`);
  }
} else {
  console.error("usage: bun src/vendor.ts generate | check");
  process.exit(2);
}
