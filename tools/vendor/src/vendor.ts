// The vendor tool: assets/vendor → the catalog's Open source view.
//   bun run vendor          regenerate apps/catalog/src/generated/vendor.ts, the preview images it names, and packages/core/src/generated/vendorCredits.ts
//   bun run vendor:check    fail if any is stale
// Every folder under assets/vendor must be listed in `folders` below, with its CREDIT.md, and the CREDIT.md source line must pin it:
// an upstream commit, or a release version with the sha256 of the folder as vendored (checked here).
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { verifyFolder } from "./fetch.js";
import { firstUrl, humanize, parseCredit, parseDemoReadme, parseFrontMatter, sourcePins, vendorCreditLine, type Credit, type VendorCreditLine } from "./parse.js";
import { digestOf, readPin, type Pin } from "./pin.js";
import { cacheDirFor, resolveVendor } from "./resolve.js";

const root = resolve(import.meta.dirname, "../../..");
const vendorDir = join(root, "assets/vendor");
const outFile = join(root, "apps/catalog/src/generated/vendor.ts");
/** Each folder's credit, in the core package: the credit data a scene's code carries, so it never reads assets/vendor. */
const creditsFile = join(root, "packages/core/src/generated/vendorCredits.ts");
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


/** A folder's raw files, through the resolver, and how it found them. */
function rawOf(id: string): { readonly dir: string; readonly via: "kept" | "cache" | "repo" } {
  const found = resolveVendor(id, { vendorDir, env: process.env });
  if (!found.ok) throw new Error(found.error);
  return { dir: found.dir, via: found.via };
}
/** The pin's hash, checked against what the folder holds: the fetched cache, the folder while raw files are still in i… */
function pinHashOf(id: string, pin: Pin, via: "kept" | "cache" | "repo"): string {
  const where = `assets/vendor/${id}`;
  if (pin.kept) {
    const actual = digestOf(join(vendorDir, id), true).hash;
    if (actual !== pin.contentHash) throw new Error(`${where}: the folder's sha256 is ${actual}, not the pinned ${pin.contentHash}`);
    return actual;
  }
  if (via === "cache") return verifyFolder(id, pin, vendorDir, cacheDirFor({ vendorDir, env: process.env })).contentHash;
  const actual = digestOf(join(vendorDir, id), false).hash;
  if (actual !== pin.contentHash) throw new Error(`${where}: the folder's sha256 is ${actual}, not the pinned ${pin.contentHash}`);
  return actual;
}
/** What disagrees between a pin and its folder's CREDIT.md, in words; empty when they agree. */
function creditProblems(id: string, pin: Pin, credit: Credit): readonly string[] {
  const where = `assets/vendor/${id}/CREDIT.md`;
  const pins = sourcePins(credit.source);
  const problems: string[] = [];
  if (pin.kept) {
    const archives = pins.flatMap((one) => (one.kind === "archive" ? [one.sha256] : []));
    if (archives.length !== 1) problems.push(`${where} pins ${String(archives.length)} archives, the pin names one kept folder`);
    else if (archives[0] !== pin.contentHash) problems.push(`${where} pins sha256 ${String(archives[0])}, the pin says ${pin.contentHash}`);
    return problems;
  }
  const commits = pins.flatMap((one) => (one.kind === "commit" ? [one.commit] : []));
  if (commits.length !== pin.sources.length) {
    problems.push(`${where} pins ${String(commits.length)} commits, the pin names ${String(pin.sources.length)}`);
  }
  for (const commit of commits) {
    if (!pin.sources.some((source) => source.commit.startsWith(commit))) problems.push(`${where}: ${commit} is no source's commit`);
  }
  return problems;
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
      const where = `assets/vendor/${id}/CREDIT.md`;
      const credit = parseCredit(await readFile(join(dir, "CREDIT.md"), "utf8"), where);
      const pin = readPin(vendorDir, id);
      if (pin === undefined) throw new Error(`assets/vendor/${id}: no vendor.json pin`);
      const disagreements = creditProblems(id, pin, credit);
      if (disagreements.length > 0) throw new Error(disagreements.join("; "));
      const raw = rawOf(id);
      pinHashOf(id, pin, raw.via);
      const sourceUrl = firstUrl(credit.source);
      if (sourceUrl === undefined) throw new Error(`assets/vendor/${id}/CREDIT.md: the source line has no URL`);
      // vendor.json is the folder's pin (tools/vendor/src/pin.ts), not one of its vendored files: it is in neither the hash nor the counts.
      // The raw files come through the resolver. CREDIT.md stays in the folder, so a cached folder counts it again;
      // a folder read from the repository already walks it.
      const files = (await walk(raw.dir)).filter((file) => relative(raw.dir, file) !== "vendor.json");
      const stays = raw.via === "cache" ? [join(dir, "CREDIT.md")] : [];
      const creditSize = stays.length === 0 ? 0 : (await stat(join(dir, "CREDIT.md"))).size;
      const sizes = await Promise.all(files.map(async (file) => (await stat(file)).size));
      const items =
        folder.kind === "skills"
          ? await skills(raw.dir)
          : folder.days !== undefined
            ? await days(raw.dir, folder.days)
            : folder.kind === "demos"
              ? await demos(raw.dir)
              : folder.docs === undefined
                ? []
                : [await docsItem(raw.dir, folder.docs)];
      const readme = await readmeOf(raw.dir);
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
        files: files.length + stays.length,
        bytes: sizes.reduce((a, b) => a + b, 0) + creditSize,
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
    folder.preview === undefined ? [] : [[join(rawOf(id).dir, folder.preview), join(publicDir, "vendor", `${id}-${basename(folder.preview)}`)] as const],
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

/** The credit of every vendored folder, by folder id, in the order of the ids. */
async function vendorCreditsOf(): Promise<Readonly<Record<string, VendorCreditLine>>> {
  const ids = (await readdir(vendorDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const lines = await Promise.all(
    ids.map(async (id): Promise<readonly [string, VendorCreditLine]> => {
      const where = `assets/vendor/${id}/CREDIT.md`;
      return [id, vendorCreditLine(parseCredit(await readFile(join(vendorDir, id, "CREDIT.md"), "utf8"), where), where)];
    }),
  );
  return Object.fromEntries(lines);
}

/** The credits module: one `VendorCredit` per folder, from its CREDIT.md. */
function renderCredits(credits: Readonly<Record<string, VendorCreditLine>>): string {
  return [
    "// Generated by tools/vendor from the CREDIT.md of each vendored folder. Do not edit; run `bun run vendor`.",
    "// The credit of each vendored folder, by folder id, so a scene's code can carry it without reading the vendor tree.",
    'import type { VendorCredit } from "../credits.js";',
    "",
    `export const vendorCredits: Readonly<Record<string, VendorCredit>> = ${JSON.stringify(credits, null, 2)};`,
    "",
  ].join("\n");
}

/** Every generated file: path → content. */
function renderAll(all: readonly Entry[], credits: Readonly<Record<string, VendorCreditLine>>): ReadonlyMap<string, string> {
  return new Map([
    [outFile, renderIndex(all)],
    [creditsFile, renderCredits(credits)],
    ...all.filter((entry) => pagesOf(entry).length > 0).map((entry): [string, string] => [join(pagesDir, `${entry.id}.ts`), renderPages(entry)]),
  ]);
}

const sameBytes = async (a: string, b: string): Promise<boolean> => {
  const [x, y] = await Promise.all([readFile(a), readFile(b).catch(() => undefined)]);
  return y !== undefined && x.equals(y);
};

const [command = ""] = process.argv.slice(2);
if (command === "generate" || command === "check") {
  let files: ReadonlyMap<string, string>;
  try {
    files = renderAll(await entries(), await vendorCreditsOf());
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
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
    await Promise.all([mkdir(join(publicDir, "vendor"), { recursive: true }), mkdir(pagesDir, { recursive: true }), mkdir(dirname(creditsFile), { recursive: true })]);
    await Promise.all(previews().map(async ([from, to]) => copyFile(from, to)));
    await Promise.all(leftover.map(async (path) => rm(path)));
    await Promise.all([...files].map(async ([path, content]) => writeFile(path, content)));
    console.log(`vendor: wrote ${relative(root, outFile)}, ${relative(root, creditsFile)} and ${String(files.size - 2)} page modules`);
  }
} else {
  console.error("usage: bun src/vendor.ts generate | check");
  process.exit(2);
}
