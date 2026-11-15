/** An sRGB color as #rrggbb. */
export type Hex = `#${string}`;

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** Parses #rrggbb into 0–255 channels. Throws on anything else. */
export function parseHex(hex: string): readonly [number, number, number] {
  const match = HEX.exec(hex);
  if (match === null) {
    throw new Error(`not a #rrggbb color: ${hex}`);
  }
  const [, r = "0", g = "0", b = "0"] = match;
  return [Number.parseInt(r, 16), Number.parseInt(g, 16), Number.parseInt(b, 16)];
}

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast ratio between two colors, 1 to 21. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
