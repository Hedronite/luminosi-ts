/**
 * The TOML Omarchy's `colors.toml` uses, and nothing more: comments, blank lines and
 * `key = "string"` pairs. Anything else (tables, arrays, numbers, multi-line strings) is refused
 * with its line number, so a file that needs a real TOML parser is noticed, not misread.
 */
export function parseFlatToml(text: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(line);
    if (match === null) throw new SyntaxError(`line ${String(index + 1)}: expected key = "value", got: ${line.slice(0, 80)}`);
    const [, key = "", value = ""] = match;
    if (Object.hasOwn(out, key)) throw new SyntaxError(`line ${String(index + 1)}: "${key}" is set twice`);
    out[key] = value.replace(/\\(["\\])/g, "$1");
  });
  return out;
}
