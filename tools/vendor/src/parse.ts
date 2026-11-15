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

/** The first URL in a string (a credit's source line may add a version or commit after it). */
export function firstUrl(text: string): string | undefined {
  return /https?:\/\/[^\s)`'"]+/.exec(text)?.[0];
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
