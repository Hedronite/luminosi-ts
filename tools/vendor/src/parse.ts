// Pure readers for the vendored folders' own files: CREDIT.md, a skill's front matter, a demo's README.

export interface Credit {
  readonly what: string;
  readonly source: string;
  readonly license: string;
  readonly credit: string;
  readonly pulled: string;
}

type Field = keyof Credit;

/** Reads the `- **Field:** value` bullets every CREDIT.md carries. Throws, naming the field, if one is missing. */
export function parseCredit(markdown: string, where: string): Credit {
  const found = new Map<string, string>();
  for (const match of markdown.matchAll(/^- \*\*(\w+):\*\* (.+)$/gm)) {
    const [, key = "", value = ""] = match;
    found.set(key.toLowerCase(), value.trim());
  }
  const get = (field: Field): string => {
    const value = found.get(field);
    if (value === undefined || value === "") throw new Error(`${where}: no "${field}" line`);
    return value;
  };
  return { what: get("what"), source: get("source"), license: get("license"), credit: get("credit"), pulled: get("pulled") };
}

/** What a source line pins a folder to: an upstream commit, or a release version with the hash of the folder as vendored. */
export type Pin = { readonly kind: "commit"; readonly commit: string; readonly repo?: string } | { readonly kind: "archive"; readonly version: string; readonly sha256: string };

/** A commit is written in backticks as 8 to 40 hex digits: `4df8e67a`. */
const commitPin = /`([0-9a-f]{8,40})`/g;
/** A source that holds several repositories names each one before its commit: `demo` at `da187f63`, or `demo` (repository `Demo-Repo`) at `da187f63`. */
const namedCommit = /`([\w.-]+)`(?: \(repository `([\w.-]+)`\))? at `([0-9a-f]{8,40})`/g;
/** A release version, then the folder's hash in backticks: `v2.1, `sha256:` and 64 hex digits`. See assets/vendor/README.md. */
const archivePin = /\bv?(\d+(?:\.\d+)+)\b[^`\n]*`sha256:([0-9a-f]{64})`/g;

/** Every pin on a source line: the commits in the order the line gives them, then the archives. A commit carries the repository the line names for it. A branch name, a bare tag, "latest" or a short hash is not a pin. */
export function sourcePins(source: string): readonly Pin[] {
  const repos = new Map([...source.matchAll(namedCommit)].map((m) => [m[3] ?? "", m[2] ?? m[1] ?? ""] as const));
  const commits = [...source.matchAll(commitPin)].map((m): Pin => {
    const commit = m[1] ?? "";
    const repo = repos.get(commit);
    return repo === undefined ? { kind: "commit", commit } : { kind: "commit", commit, repo };
  });
  const archives = [...source.matchAll(archivePin)].map((m): Pin => ({ kind: "archive", version: m[1] ?? "", sha256: m[2] ?? "" }));
  return [...commits, ...archives];
}

/** The pins on a source line; throws, naming where, when there is none. */
export function requirePin(source: string, where: string): readonly Pin[] {
  const pins = sourcePins(source);
  if (pins.length === 0) {
    throw new Error(`${where}: the source line has no pin: give the upstream commit in backticks (8 to 40 hex digits), or a release version and the folder's backticked sha256:<64 hex> hash`);
  }
  return pins;
}

/** The first URL in a string (a credit's source line may add a version or commit after it). */
export function firstUrl(text: string): string | undefined {
  return /https?:\/\/[^\s)`'"]+/.exec(text)?.[0];
}

/** Pins as one string, in the order of `sourcePins`: a commit as written, or `repository: commit` when the source names its repository; an archive as `v<version> sha256:<hash>`. Several are joined by a comma and a space. */
export const pinText = (pins: readonly Pin[]): string =>
  pins.map((pin) => (pin.kind === "archive" ? `v${pin.version} sha256:${pin.sha256}` : pin.repo === undefined ? pin.commit : `${pin.repo}: ${pin.commit}`)).join(", ");

/** Spellings in a CREDIT.md license line and the SPDX id each stands for. */
const spdxIds: readonly (readonly [RegExp, string])[] = [
  [/\bCC BY 4\.0\b/g, "CC-BY-4.0"],
  [/\bSIL OFL 1\.1\b/g, "OFL-1.1"],
];

/** The page of a license that asks for a link. */
const licensePages: readonly (readonly [RegExp, string])[] = [[/\bCC-BY-4\.0\b/, "https://creativecommons.org/licenses/by/4.0/"]];

/**
 * A license line as plain text: the files it points to in the vendored folder (a backticked name in parentheses, as in "MIT (`LICENSE`)") are left out,
 * and the licenses it names take their SPDX id where they have one. A line that still has backticks after that names a file or code in the folder
 * and throws, naming where: it is the CREDIT.md that is to be written in plain text.
 */
export function plainLicense(license: string, where: string): string {
  const named = spdxIds.reduce((text, [spelling, id]) => text.replace(spelling, id), license.replace(/\s*\(`[^`]*`\)/g, "")).trim();
  if (named.includes("`")) throw new Error(`${where}: the license line names a file or code in backticks: write it as plain text, with no reference to a file of the folder`);
  return named;
}

/** One vendored folder's credit as the shipped package holds it (`VendorCredit` in packages/core): what, where, at which pin, under which terms, by whom. */
export interface VendorCreditLine {
  readonly work: string;
  readonly source: string;
  readonly pin: string;
  readonly license: string;
  readonly licenseUrl?: string;
  readonly credit: string;
}

/**
 * A folder's CREDIT.md as a `VendorCreditLine`. Throws, naming where, if the source line has no https address or no pin, if a source with several
 * commits does not name the repository of each, or if the license line is not plain text.
 */
export function vendorCreditLine(credit: Credit, where: string): VendorCreditLine {
  const source = firstUrl(credit.source);
  if (source === undefined) throw new Error(`${where}: the source line has no URL`);
  if (!source.startsWith("https://")) throw new Error(`${where}: the source line's address is not https`);
  const pins = requirePin(credit.source, where);
  const commits = pins.flatMap((pin) => (pin.kind === "commit" ? [pin] : []));
  if (commits.length > 1 && commits.some((pin) => pin.repo === undefined)) {
    throw new Error(`${where}: the source line has several commits and does not name the repository of each: write \`repository\` at \`commit\``);
  }
  const license = plainLicense(credit.license, where);
  const page = licensePages.find(([spelling]) => spelling.test(license))?.[1];
  return { work: credit.what, source, pin: pinText(pins), license, ...(page === undefined ? {} : { licenseUrl: page }), credit: credit.credit };
}

export interface FrontMatter {
  readonly fields: ReadonlyMap<string, string>;
  /** The Markdown after the front matter. */
  readonly body: string;
}

/** Splits `---`-fenced front matter of one-line `key: value` fields from the body. Quoted values are unquoted. */
export function parseFrontMatter(markdown: string): FrontMatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (match === null) return { fields: new Map(), body: markdown };
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0 || /^\s/.test(line)) continue;
    const value = line.slice(colon + 1).trim();
    fields.set(line.slice(0, colon).trim(), value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"));
  }
  return { fields, body: markdown.slice(match[0].length) };
}

/** A demo README: its description, without the "live demo: URL" line, and that URL. */
export function parseDemoReadme(markdown: string): { readonly description: string; readonly live: string | undefined } {
  const lines = markdown.split(/\r?\n/);
  const liveLine = lines.find((line) => /^\s*live demo\s*:/i.test(line));
  const description = lines
    .filter((line) => line !== liveLine)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { description, live: liveLine === undefined ? undefined : firstUrl(liveLine) };
}

/** "geometry-in-flux" → "Geometry in flux". */
export const humanize = (id: string): string => id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
