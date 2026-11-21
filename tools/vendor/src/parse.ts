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
export type Pin = { readonly kind: "commit"; readonly commit: string } | { readonly kind: "archive"; readonly version: string; readonly sha256: string };

/** A commit is written in backticks as 8 to 40 hex digits: `4df8e67a`. */
const commitPin = /`([0-9a-f]{8,40})`/g;
/** A release version, then the folder's hash in backticks: `v2.1, `sha256:` and 64 hex digits`. See assets/vendor/README.md. */
const archivePin = /\bv?(\d+(?:\.\d+)+)\b[^`\n]*`sha256:([0-9a-f]{64})`/g;

/** Every pin on a source line. A branch name, a bare tag, "latest" or a short hash is not a pin. */
export function sourcePins(source: string): readonly Pin[] {
  const commits = [...source.matchAll(commitPin)].map((m): Pin => ({ kind: "commit", commit: m[1] ?? "" }));
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

/** Pins as one string: a commit as written, an archive as `v<version> sha256:<hash>`, several joined by a comma and a space, in the order the source line gives them. */
export const pinText = (pins: readonly Pin[]): string => pins.map((pin) => (pin.kind === "commit" ? pin.commit : `v${pin.version} sha256:${pin.sha256}`)).join(", ");

/** One vendored folder's credit as the shipped package holds it (`VendorCredit` in packages/core): what, where, at which pin, under which terms, by whom. */
export interface VendorCreditLine {
  readonly work: string;
  readonly source: string;
  readonly pin: string;
  readonly license: string;
  readonly credit: string;
}

/** A folder's CREDIT.md as a `VendorCreditLine`. Throws, naming where, if the source line has no URL or no pin. */
export function vendorCreditLine(credit: Credit, where: string): VendorCreditLine {
  const source = firstUrl(credit.source);
  if (source === undefined) throw new Error(`${where}: the source line has no URL`);
  return { work: credit.what, source, pin: pinText(requirePin(credit.source, where)), license: credit.license, credit: credit.credit };
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
