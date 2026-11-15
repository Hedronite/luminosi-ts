/**
 * Icon packs: other people's open-source icon sets, converted to data. Unlike the core icons
 * (stroke-only, one 24-unit grid), a pack icon keeps its set's own grid and paint: each path says
 * whether it is filled or stroked and how. Every black in the source becomes `currentColor`, so a pack
 * icon takes the text color like a core one.
 *
 * Packs keep their sources' licenses (ISC, MIT, CC BY 4.0); `IconPackInfo` carries the license and
 * credit, and CREDITS.md lists them. Import a pack from `@hedronite/lts-icons/packs/<id>`.
 */

/** How a path or an icon is painted. Values are SVG presentation attributes, already validated. */
export interface PackPaint {
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: string;
  readonly strokeLinecap?: "butt" | "round" | "square";
  readonly strokeLinejoin?: "miter" | "round" | "bevel";
  readonly strokeMiterlimit?: string;
  readonly fillRule?: "nonzero" | "evenodd";
  readonly clipRule?: "nonzero" | "evenodd";
  readonly opacity?: string;
  readonly fillOpacity?: string;
  readonly strokeOpacity?: string;
  readonly transform?: string;
}

export interface PackPath extends PackPaint {
  readonly d: string;
}

export interface PackIcon {
  /** Unique within its pack. */
  readonly id: string;
  readonly name: string;
  /** The name the pack module exports this icon under. */
  readonly importName: string;
  readonly viewBox: string;
  /** Paint every path inherits (the source's root attributes). */
  readonly paint: PackPaint;
  readonly paths: readonly PackPath[];
}

export interface IconPackInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly count: number;
  /** SPDX-style license of the icons. */
  readonly license: string;
  readonly credit: string;
  readonly source: string;
}

/** The SVG attribute for each paint property. */
export const paintAttributes = {
  fill: "fill",
  stroke: "stroke",
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeMiterlimit: "stroke-miterlimit",
  fillRule: "fill-rule",
  clipRule: "clip-rule",
  opacity: "opacity",
  fillOpacity: "fill-opacity",
  strokeOpacity: "stroke-opacity",
  transform: "transform",
} as const satisfies Record<keyof PackPaint, string>;

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const paintKeys = Object.keys(paintAttributes).filter((key): key is keyof PackPaint => Object.hasOwn(paintAttributes, key));

const attributes = (paint: PackPaint): string =>
  paintKeys
    .map((key) => {
      const value = paint[key];
      return value === undefined ? "" : ` ${paintAttributes[key]}="${escapeXml(value)}"`;
    })
    .join("");

export interface PackIconSvgOptions {
  /** Width and height in CSS pixels. Default 24. */
  readonly size?: number;
  /** Accessible name. Without one the icon is decorative and hidden from assistive technology. */
  readonly title?: string;
}

/** Renders a pack icon as a standalone SVG string, for use without React. */
export function packIconToSvg(icon: PackIcon, { size = 24, title }: PackIconSvgOptions = {}): string {
  const a11y = title === undefined ? ' aria-hidden="true"' : ' role="img"';
  const label = title === undefined ? "" : `<title>${escapeXml(title)}</title>`;
  const paths = icon.paths.map(({ d, ...paint }) => `<path d="${escapeXml(d)}"${attributes(paint)}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="${icon.viewBox}"${attributes(icon.paint)}${a11y}>${label}${paths}</svg>`;
}
