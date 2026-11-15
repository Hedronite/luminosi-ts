/**
 * Framing for the embed page: an orthographic frustum that puts an object's projected extent exactly
 * on a target box in the image, at one uniform scale. Fitting by height keeps the object's own
 * proportions, so a too-wide or too-narrow reconstruction still shows as one.
 */

/** A box in normalized image coordinates: x to the right, y down, 0–1. */
export interface ImageBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** An extent in camera space: x to the right, y up. */
export interface CameraExtent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface Frustum {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Fits `extent` into `box` of a `width` × `height` image: height to height, centers on centers. */
export function fitFrustum(extent: CameraExtent, box: ImageBox, width: number, height: number): Frustum {
  const boxHeight = (box.y1 - box.y0) * height;
  const extentHeight = extent.maxY - extent.minY;
  const extentWidth = extent.maxX - extent.minX;
  if (!(width > 0 && height > 0)) throw new RangeError("the image needs a positive size");
  if (!(boxHeight > 0)) throw new RangeError("the target box needs a positive height");
  // A flat extent (no height) falls back to fitting its width.
  const perPixel = extentHeight > 0 ? extentHeight / boxHeight : extentWidth / Math.max(1e-9, (box.x1 - box.x0) * width);
  const centerX = (extent.minX + extent.maxX) / 2;
  const centerY = (extent.minY + extent.maxY) / 2;
  const left = centerX - ((box.x0 + box.x1) / 2) * width * perPixel;
  const top = centerY + ((box.y0 + box.y1) / 2) * height * perPixel;
  return { left, right: left + width * perPixel, top, bottom: top - height * perPixel };
}

/** The default target: the object centered, filling 80% of the image's limiting side. */
export function defaultBox(extent: CameraExtent, width: number, height: number): ImageBox {
  const w = Math.max(1e-9, extent.maxX - extent.minX);
  const h = Math.max(1e-9, extent.maxY - extent.minY);
  const scale = 0.8 * Math.min(width / w, height / h);
  const bw = (w * scale) / width;
  const bh = (h * scale) / height;
  return { x0: (1 - bw) / 2, y0: (1 - bh) / 2, x1: (1 + bw) / 2, y1: (1 + bh) / 2 };
}

const number = (value: string | null, fallback: number, min: number, max: number): number => {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new RangeError(`expected a number from ${String(min)} to ${String(max)}, got "${value}"`);
  return parsed;
};

export interface EmbedParams {
  /** A same-origin path to an ObjectSpec JSON file. */
  readonly spec: string;
  readonly look: string;
  readonly width: number;
  readonly height: number;
  readonly background: string;
  /** Camera orbit, degrees: yaw turns about the vertical axis, pitch looks down from above. */
  readonly yaw: number;
  readonly pitch: number;
  readonly fit: ImageBox | undefined;
}

/** Reads the embed page's query string. Throws a RangeError naming the first bad parameter. */
export function parseEmbedParams(search: string): EmbedParams {
  const query = new URLSearchParams(search);
  const spec = query.get("spec") ?? "";
  // Same origin only: a path, never a URL with a scheme or a protocol-relative "//host".
  if (!spec.startsWith("/") || spec.startsWith("//")) throw new RangeError('"spec" must be a same-origin path such as /specs/object.json');
  const background = query.get("bg") ?? "#ffffff";
  if (!/^#[0-9a-f]{6}$/i.test(background)) throw new RangeError('"bg" must be a #rrggbb color');
  const rawFit = query.get("fit");
  let fit: ImageBox | undefined;
  if (rawFit !== null && rawFit !== "") {
    const values = rawFit.split(",").map((v) => number(v, Number.NaN, 0, 1));
    const [x0, y0, x1, y1] = values;
    if (values.length !== 4 || x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined || !(x1 > x0 && y1 > y0)) {
      throw new RangeError('"fit" must be four numbers x0,y0,x1,y1 from 0 to 1, with x1 > x0 and y1 > y0');
    }
    fit = { x0, y0, x1, y1 };
  }
  return {
    spec,
    look: query.get("look") ?? "neutral",
    width: Math.round(number(query.get("width"), 512, 16, 2048)),
    height: Math.round(number(query.get("height"), 512, 16, 2048)),
    background,
    yaw: number(query.get("yaw"), 0, -360, 360),
    pitch: number(query.get("pitch"), 0, -89, 89),
    fit,
  };
}
