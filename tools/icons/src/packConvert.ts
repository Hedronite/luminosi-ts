// SVG (or a React component's inline SVG) → pack icon data: paths with their own paint, every
// black recolored to currentColor. Pure: no files, so it can be tested on samples.
import { optimize } from "svgo";

export type Paint = Partial<Record<PaintKey, string>>;

interface ConvertedPath extends Paint {
  readonly d: string;
}

export interface ConvertedIcon {
  readonly viewBox: string;
  readonly paint: Paint;
  readonly paths: readonly ConvertedPath[];
}

const attributeToKey = {
  fill: "fill",
  stroke: "stroke",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  opacity: "opacity",
  "fill-opacity": "fillOpacity",
  "stroke-opacity": "strokeOpacity",
  transform: "transform",
} as const;

type PaintAttribute = keyof typeof attributeToKey;
type PaintKey = (typeof attributeToKey)[PaintAttribute];

const isPaintAttribute = (name: string): name is PaintAttribute => Object.hasOwn(attributeToKey, name);

/** Attributes whose values must come from a closed set (React's SVG types enforce the same). */
const allowed: Partial<Record<PaintKey, readonly string[]>> = {
  strokeLinecap: ["butt", "round", "square"],
  strokeLinejoin: ["miter", "round", "bevel"],
  fillRule: ["nonzero", "evenodd"],
  clipRule: ["nonzero", "evenodd"],
};

/** Black, currentcolor and CSS-variable fallbacks to currentcolor all mean "the text color". */
export function normalizeColor(value: string): string {
  const v = value.trim();
  if (/^(black|#000|#000000|currentcolor)$/i.test(v)) return "currentColor";
  if (/^var\(--[\w-]+,\s*currentcolor\s*\)$/i.test(v)) return "currentColor";
  return v;
}

/**
 * A tag's attributes, with any inline `style` declarations folded in. In SVG an inline style beats a
 * presentation attribute, so style values win; CSS lengths in px become plain numbers.
 */
function parseAttributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of tag.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) {
    const [, name = "", value = ""] = match;
    out.set(name, value);
  }
  const style = out.get("style");
  if (style !== undefined) {
    out.delete("style");
    for (const declaration of style.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim().replace(/^(-?[\d.]+)px$/, "$1");
      if (name !== "" && value !== "") out.set(name, value);
    }
  }
  return out;
}

function toPaint(attributes: Map<string, string>, where: string): Paint {
  const paint: Paint = {};
  for (const [name, raw] of attributes) {
    if (!isPaintAttribute(name)) continue;
    const key = attributeToKey[name];
    const value = key === "fill" || key === "stroke" ? normalizeColor(raw) : raw.trim();
    const options = allowed[key];
    if (options !== undefined && !options.includes(value)) throw new Error(`${where}: ${name}="${raw}" is not one of ${options.join(", ")}`);
    paint[key] = value;
  }
  return paint;
}

/** SVGO leaves rounded rects alone, so turn `<rect rx>` into an arc path first (as the core icons do). */
function roundedRectsToPaths(svg: string): string {
  const num = (attrs: string, name: string): number => {
    // Anchored on whitespace: a bare \b would find "width" inside "stroke-width".
    const match = new RegExp(`(?:^|\\s)${name}="([\\d.]+)"`).exec(attrs);
    return match === null ? 0 : Number(match[1]);
  };
  return svg.replace(/<rect\b([^>]*)\/>/g, (whole, attrs: string) => {
    const r = num(attrs, "rx") || num(attrs, "ry");
    if (r === 0) return whole;
    const [x, y, w, h] = [num(attrs, "x"), num(attrs, "y"), num(attrs, "width"), num(attrs, "height")];
    const rx = Math.min(r, w / 2);
    const ry = Math.min(r, h / 2);
    const rest = attrs.replace(/(^|\s)(x|y|width|height|rx|ry)="[^"]*"/g, "$1");
    const arc = (dx: number, dy: number): string => `a${String(rx)} ${String(ry)} 0 0 1 ${String(dx)} ${String(dy)}`;
    return `<path${rest} d="M${String(x + rx)} ${String(y)}h${String(w - 2 * rx)}${arc(rx, ry)}v${String(h - 2 * ry)}${arc(-rx, ry)}h${String(-(w - 2 * rx))}${arc(-rx, -ry)}v${String(-(h - 2 * ry))}${arc(rx, -ry)}z"/>`;
  });
}

const JSX_ATTRIBUTES: Readonly<Record<string, string>> = {
  fillRule: "fill-rule",
  clipRule: "clip-rule",
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeMiterlimit: "stroke-miterlimit",
  fillOpacity: "fill-opacity",
  strokeOpacity: "stroke-opacity",
};

/** The `<svg>` inside a React icon component, as plain SVG: `{color}` is currentColor, props dropped. */
export function svgFromTsx(tsx: string, where: string): string {
  const match = /<svg[\s\S]*?<\/svg>/.exec(tsx);
  if (match === null) throw new Error(`${where}: no <svg> in the component`);
  return match[0]
    .replace(/\{\.\.\.props\}/g, "")
    .replace(/\bref=\{[^}]*\}/g, "")
    .replace(/=\{color\}/g, '="currentColor"')
    .replace(/=\{\s*([\d.]+)\s*\}/g, '="$1"')
    .replace(/=\{\s*["']([^"']*)["']\s*\}/g, '="$1"')
    .replace(/\b([a-z]+[A-Z][a-zA-Z]*)=/g, (whole, name: string) => (JSX_ATTRIBUTES[name] === undefined ? whole : `${JSX_ATTRIBUTES[name]}=`));
}

/** Converts one SVG into pack icon data. Throws, naming `where`, on anything it can't keep faithfully. */
export function convertSvg(svg: string, where: string): ConvertedIcon {
  const root = /<svg\b([^>]*)>/.exec(svg);
  if (root === null) throw new Error(`${where}: not an SVG`);
  const rootAttributes = parseAttributes(root[1] ?? "");
  const viewBox = rootAttributes.get("viewBox") ?? (rootAttributes.has("width") && rootAttributes.has("height") ? `0 0 ${rootAttributes.get("width") ?? ""} ${rootAttributes.get("height") ?? ""}` : undefined);
  if (viewBox === undefined || !/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/.test(viewBox.trim())) throw new Error(`${where}: no usable viewBox`);
  const paint = toPaint(rootAttributes, where);

  let data: string;
  try {
    ({ data } = optimize(roundedRectsToPaths(svg), {
    multipass: true,
    plugins: [
      {
        name: "preset-default",
        params: { floatPrecision: 2, overrides: { convertShapeToPath: { convertArcs: true } } },
      },
    ],
  }));
  } catch (error: unknown) {
    throw new Error(`${where}: SVGO could not read it: ${error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error)}`, { cause: error });
  }
  const body = data.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>$/, "");
  // Walk paths and groups. A group's paint goes down onto its paths (a path's own paint wins;
  // opacities multiply), so the icon stays a flat list of paths.
  const paths: ConvertedPath[] = [];
  const stack: Paint[] = [{}];
  const tokens = body.match(/<path\b[^>]*\/>|<g\b[^>]*>|<\/g>|<[^>]+>/g) ?? [];
  const rest = body.replace(/<path\b[^>]*\/>|<g\b[^>]*>|<\/g>/g, "").trim();
  if (rest !== "") throw new Error(`${where}: elements other than paths and groups remain after optimizing: ${rest.slice(0, 80)}`);
  for (const token of tokens) {
    const inherited = stack[stack.length - 1] ?? {};
    if (token.startsWith("</g")) {
      stack.pop();
      continue;
    }
    const own = toPaint(parseAttributes(token.replace(/^<\w+/, "")), where);
    const opacity = inherited.opacity !== undefined && own.opacity !== undefined ? String(Number(inherited.opacity) * Number(own.opacity)) : (own.opacity ?? inherited.opacity);
    const merged: Paint = { ...inherited, ...own, ...(opacity === undefined ? {} : { opacity }) };
    if (token.startsWith("<g")) {
      stack.push(merged);
      continue;
    }
    const d = parseAttributes(token).get("d");
    if (d === undefined || d === "") throw new Error(`${where}: a path without data`);
    paths.push({ d, ...merged });
  }
  if (paths.length === 0) throw new Error(`${where}: no paths`);
  return { viewBox: viewBox.trim(), paint, paths };
}

/** "arrow-right" → "Arrow right". */
export const humanize = (id: string): string => id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield await".split(" "),
);

/** The export name for an icon id: camelCase, made a valid identifier. */
export function importName(id: string): string {
  const camel = id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  if (/^\d/.test(camel)) return `icon${camel.replace(/^./, (c) => c.toUpperCase())}`;
  // Also clear of each pack module's own names: `pack`, `icons`, and its shared constants v0…, p0….
  return RESERVED.has(camel) || camel === "pack" || camel === "icons" || /^[vp]\d+$/.test(camel) ? `${camel}Icon` : camel;
}
