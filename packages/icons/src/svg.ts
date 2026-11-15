import { ICON_VIEW_BOX, type IconData } from "./icon.js";

export interface IconSvgOptions {
  /** Width and height in CSS pixels. Default 24. */
  readonly size?: number;
  /** Stroke width in grid units. Default 2. */
  readonly strokeWidth?: number;
  /** Accessible name. Without one the icon is decorative and hidden from assistive technology. */
  readonly title?: string;
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Renders an icon as a standalone SVG string, for use without React. */
export function iconToSvg(icon: IconData, options: IconSvgOptions = {}): string {
  const { size = 24, strokeWidth = 2, title } = options;
  const a11y = title === undefined ? ' aria-hidden="true"' : ' role="img"';
  const label = title === undefined ? "" : `<title>${escapeXml(title)}</title>`;
  const paths = icon.paths.map((d) => `<path d="${escapeXml(d)}"/>`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="${ICON_VIEW_BOX}"` +
    ` fill="none" stroke="currentColor" stroke-width="${String(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"${a11y}>` +
    `${label}${paths}</svg>`
  );
}
