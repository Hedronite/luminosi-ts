import { parseObjectSpec, type ObjectSpec } from "../spec.js";

/**
 * A generic dress watch as an `ObjectSpec`, reconstructed from a reference photo: a round case with a
 * stepped bezel, a two-track dial with Roman indices, three subdials (a globe, small seconds, a moon
 * window), a date aperture, faceted hands, an onion crown, wire lugs with screw caps, and a strap.
 * No maker's name, logo or printed words: indices are built from bars.
 *
 * The case is one unit across, the dial faces +z, and 12 o'clock is +y. Colors come from the
 * palette, so the look decides the metal and the strap.
 */

export interface WatchTime {
  /** 0–23; shown on a 12-hour dial. Default 2. */
  readonly hours?: number;
  /** 0–59. Default 4. */
  readonly minutes?: number;
  /** 0–59. Default 40. */
  readonly seconds?: number;
}

type V3 = readonly [number, number, number];

interface PartInput {
  readonly id: string;
  readonly parent?: string;
  readonly shape: Readonly<Record<string, unknown>>;
  readonly material: string;
  readonly position?: V3;
  readonly rotation?: V3;
  readonly scale?: V3;
}

const QUARTER = Math.PI / 2;
/** The dial's top surface. */
const DIAL = 0.075;
const FACE: V3 = [QUARTER, 0, 0];

/** A point `radius` from (cx, cy) at `angle` clockwise from 12 o'clock. */
const polar = (radius: number, angle: number, cx = 0, cy = 0): readonly [number, number] => [cx + radius * Math.sin(angle), cy + radius * Math.cos(angle)];

/** Six decimals, and never -0, which JSON can't carry: the spec must survive a round trip unchanged. */
const round = (value: number): number => {
  const r = Math.round(value * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};
const at = (x: number, y: number, z: number): V3 => [round(x), round(y), round(z)];

/** Bars for one Roman numeral glyph, centered on 0 with its top at +y, in units of its height. */
interface Stroke {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly weight: number;
}

const HEAVY = 0.2;
const LIGHT = 0.085;
const LETTER = { I: 0.2, V: 0.62, X: 0.62 } as const;
const GAP = 0.1;

function letterStrokes(letter: keyof typeof LETTER, left: number): Stroke[] {
  const w = LETTER[letter];
  if (letter === "I") return [{ x0: left + w / 2, y0: 0.5, x1: left + w / 2, y1: -0.5, weight: HEAVY }];
  if (letter === "V") {
    return [
      { x0: left, y0: 0.5, x1: left + w / 2, y1: -0.5, weight: HEAVY },
      { x0: left + w, y0: 0.5, x1: left + w / 2, y1: -0.5, weight: LIGHT },
    ];
  }
  return [
    { x0: left, y0: 0.5, x1: left + w, y1: -0.5, weight: HEAVY },
    { x0: left + w, y0: 0.5, x1: left, y1: -0.5, weight: LIGHT },
  ];
}

const NUMERALS = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"] as const;

function glyphStrokes(numeral: string): Stroke[] {
  const matched: readonly string[] = numeral.match(/[IVX]/g) ?? [];
  const letters = matched.filter((c): c is keyof typeof LETTER => c === "I" || c === "V" || c === "X");
  const width = letters.reduce((sum, c) => sum + LETTER[c], 0) + GAP * (letters.length - 1);
  const strokes: Stroke[] = [];
  let left = -width / 2;
  for (const letter of letters) {
    strokes.push(...letterStrokes(letter, left));
    left += LETTER[letter] + GAP;
  }
  return strokes;
}

/** Roman indices, radial (each numeral's foot toward the center), as thin bars on the dial. */
function numeralParts(radius: number, height: number): PartInput[] {
  const parts: PartInput[] = [];
  NUMERALS.forEach((numeral, hour) => {
    const angle = (hour / 12) * 2 * Math.PI;
    const turn = -angle;
    const [cx, cy] = polar(radius, angle);
    glyphStrokes(numeral).forEach((s, i) => {
      const dx = (s.x1 - s.x0) * height;
      const dy = (s.y1 - s.y0) * height;
      const mx = ((s.x0 + s.x1) / 2) * height;
      const my = ((s.y0 + s.y1) / 2) * height;
      const x = cx + mx * Math.cos(turn) - my * Math.sin(turn);
      const y = cy + mx * Math.sin(turn) + my * Math.cos(turn);
      parts.push({
        id: `numeral-${String(hour === 0 ? 12 : hour)}-${String(i + 1)}`,
        shape: { type: "box", size: [round(s.weight * height), round(Math.hypot(dx, dy)), 0.002] },
        material: "print",
        position: at(x, y, DIAL + 0.001),
        rotation: [0, 0, round(turn + Math.atan2(-dx, dy))],
      });
    });
  });
  return parts;
}

/** Radial ticks around a center: `count` of them, every `major`-th longer and heavier. */
function tickParts(prefix: string, count: number, major: number, outer: number, minor: number, majorLength: number, cx = 0, cy = 0, z = DIAL): PartInput[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 2 * Math.PI;
    const isMajor = i % major === 0;
    const length = isMajor ? majorLength : minor;
    const [x, y] = polar(outer - length / 2, angle, cx, cy);
    return {
      id: `${prefix}-${String(i)}`,
      shape: { type: "box", size: [isMajor ? 0.005 : 0.0022, length, 0.0015] },
      material: "print",
      position: at(x, y, z + 0.001),
      rotation: [0, 0, round(-angle)],
    };
  });
}

/** A faceted (dauphine) hand pointing up +y from the arbor: a raised ridge between two flanks. */
function handShape(length: number, width: number, tail: number): Readonly<Record<string, unknown>> {
  const shoulder = length * 0.32;
  const ridge = width * 0.35;
  // tail, left, right, tip, ridge
  const positions = [0, -tail, 0, -width / 2, shoulder, 0, width / 2, shoulder, 0, 0, length, 0, 0, shoulder, ridge];
  return { type: "mesh", positions: positions.map(round), indices: [0, 2, 4, 0, 4, 1, 4, 2, 3, 4, 3, 1] };
}

function subdial(id: string, cx: number, cy: number, radius: number, handAngle: number): PartInput[] {
  const [hx, hy] = polar(radius * 0.35, handAngle, cx, cy);
  return [
    { id: `${id}-face`, shape: { type: "cylinder", radiusTop: radius, radiusBottom: radius, height: 0.003, segments: 64 }, material: "sub", position: at(cx, cy, DIAL + 0.0005), rotation: FACE },
    { id: `${id}-ring`, shape: { type: "torus", radius, tube: 0.0022, radialSegments: 8, tubularSegments: 64 }, material: "metal", position: at(cx, cy, DIAL + 0.002) },
    ...tickParts(`${id}-tick`, 12, 3, radius - 0.006, 0.007, 0.012, cx, cy, DIAL + 0.002),
    { id: `${id}-hand`, shape: { type: "box", size: [0.0035, radius * 0.9, 0.0015] }, material: "metal", position: at(hx, hy, DIAL + 0.006), rotation: [0, 0, round(-handAngle)] },
    { id: `${id}-pin`, shape: { type: "cylinder", radiusTop: 0.006, radiusBottom: 0.006, height: 0.008, segments: 16 }, material: "metal", position: at(cx, cy, DIAL + 0.005), rotation: FACE },
  ];
}

const SUB_RADIUS = 0.082;
const SUB_OFFSET = 0.15;

/** A small globe in a subdial: a disc with a rim, latitude lines and three meridians. */
function globeParts(cx: number, cy: number, radius: number): PartInput[] {
  const z = DIAL + 0.004;
  const latitude = (name: string, y: number): PartInput => ({
    id: `globe-${name}`,
    shape: { type: "box", size: [round(2 * Math.sqrt(radius * radius - y * y)), 0.0022, 0.0015] },
    material: "print",
    position: at(cx, cy + y, z + 0.001),
  });
  const meridian = (name: string, squeeze: number): PartInput => ({
    id: `globe-${name}`,
    shape: { type: "torus", radius, tube: 0.0016, radialSegments: 6, tubularSegments: 48 },
    material: "print",
    position: at(cx, cy, z + 0.001),
    scale: [squeeze, 1, 1],
  });
  return [
    { id: "globe", shape: { type: "cylinder", radiusTop: radius, radiusBottom: radius, height: 0.002, segments: 64 }, material: "date", position: at(cx, cy, z), rotation: FACE },
    meridian("rim", 1),
    meridian("meridian-wide", 0.62),
    meridian("meridian-narrow", 0.24),
    latitude("equator", 0),
    latitude("north", radius * 0.5),
    latitude("south", -radius * 0.5),
  ];
}

function check(name: string, value: number, max: number): number {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${name} must be an integer from 0 to ${String(max)}, got ${String(value)}`);
  return value;
}

/** The watch at a given time (default 2:04:40). Pure: the same time gives the same spec. */
export function dressWatchSpec({ hours = 2, minutes = 4, seconds = 40 }: WatchTime = {}): ObjectSpec {
  const h = check("hours", hours, 23) % 12;
  const m = check("minutes", minutes, 59);
  const s = check("seconds", seconds, 59);
  const hourAngle = ((h + m / 60) / 12) * 2 * Math.PI;
  const minuteAngle = ((m + s / 60) / 60) * 2 * Math.PI;
  const secondAngle = (s / 60) * 2 * Math.PI;
  const [secondX, secondY] = polar(0.1, secondAngle);

  /** A strap bending away from the dial in tapered segments, each starting where the last ended. */
  const strapSide = (side: "top" | "bottom"): PartInput[] => {
    const sign = side === "top" ? 1 : -1;
    const segments = [
      { length: 0.17, width: 0.47, thickness: 0.044, bend: 0.05 },
      { length: 0.16, width: 0.455, thickness: 0.042, bend: 0.2 },
      { length: 0.16, width: 0.44, thickness: 0.04, bend: 0.38 },
    ] as const;
    let y = 0.46;
    let z = -0.052;
    return segments.map((segment, i) => {
      const dy = Math.cos(segment.bend) * segment.length;
      const dz = -Math.sin(segment.bend) * segment.length;
      const part: PartInput = {
        id: `strap-${side}-${String(i + 1)}`,
        shape: { type: "box", size: [segment.width, round(segment.length + 0.01), segment.thickness] },
        material: "strap",
        position: at(0, sign * (y + dy / 2), z + dz / 2),
        rotation: [round(-sign * segment.bend), 0, 0],
      };
      y += dy;
      z += dz;
      return part;
    });
  };

  const lug = (x: number, y: number, name: string): PartInput[] => {
    const sx = Math.sign(x);
    const sy = Math.sign(y);
    return [
      { id: `lug-${name}`, shape: { type: "cylinder", radiusTop: 0.026, radiusBottom: 0.026, height: 0.2, segments: 20 }, material: "metal", position: at(x, y, -0.035) },
      { id: `lug-${name}-end`, shape: { type: "sphere", radius: 0.026, widthSegments: 20, heightSegments: 10 }, material: "metal", position: at(x, y + sy * 0.1, -0.035) },
      { id: `lug-${name}-screw`, shape: { type: "cylinder", radiusTop: 0.017, radiusBottom: 0.017, height: 0.012, segments: 16 }, material: "metal", position: at(x + sx * 0.026, y + sy * 0.055, -0.035), rotation: [0, 0, QUARTER] },
    ];
  };

  const parts: PartInput[] = [
    // Case and bezel: one turned profile, from the caseback up over the bezel to the dial opening.
    {
      id: "case",
      shape: {
        type: "lathe",
        points: [[0, -0.11], [0.43, -0.11], [0.47, -0.097], [0.494, -0.065], [0.5, -0.025], [0.5, 0.035], [0.492, 0.06], [0.474, 0.08], [0.448, 0.092], [0.428, 0.09], [0.421, 0.076]],
        segments: 96,
      },
      material: "metal",
      rotation: FACE,
    },
    { id: "dial", shape: { type: "cylinder", radiusTop: 0.421, radiusBottom: 0.421, height: 0.01, segments: 96 }, material: "dial", position: [0, 0, DIAL - 0.005], rotation: FACE },
    // Minute track between two printed circles, and a metal line inside it.
    { id: "track-outer", shape: { type: "torus", radius: 0.412, tube: 0.0012, radialSegments: 6, tubularSegments: 128 }, material: "print", position: [0, 0, DIAL] },
    { id: "track-inner", shape: { type: "torus", radius: 0.376, tube: 0.0012, radialSegments: 6, tubularSegments: 128 }, material: "print", position: [0, 0, DIAL] },
    ...tickParts("minute", 60, 5, 0.411, 0.012, 0.03),
    { id: "chapter-line", shape: { type: "torus", radius: 0.35, tube: 0.0025, radialSegments: 8, tubularSegments: 128 }, material: "metal", position: [0, 0, DIAL] },
    ...numeralParts(0.302, 0.058),
    { id: "center", shape: { type: "cylinder", radiusTop: 0.252, radiusBottom: 0.252, height: 0.004, segments: 96 }, material: "center", position: [0, 0, DIAL - 0.0005], rotation: FACE },
    // Subdials: a globe at 12, small seconds at 9, a moon window at 6.
    ...subdial("globe", 0, SUB_OFFSET, SUB_RADIUS, 0),
    ...globeParts(0, SUB_OFFSET, 0.055),
    ...subdial("seconds", -SUB_OFFSET, 0, SUB_RADIUS, (s / 60) * 2 * Math.PI),
    ...subdial("moon", 0, -SUB_OFFSET, SUB_RADIUS, Math.PI),
    { id: "moon-sky", shape: { type: "cylinder", radiusTop: 0.052, radiusBottom: 0.052, height: 0.002, segments: 48 }, material: "night", position: at(0, -SUB_OFFSET + 0.012, DIAL + 0.003), rotation: FACE },
    { id: "moon-mask", shape: { type: "box", size: [0.12, 0.056, 0.003] }, material: "sub", position: at(0, -SUB_OFFSET - 0.016, DIAL + 0.004) },
    { id: "moon", shape: { type: "sphere", radius: 0.014, widthSegments: 16, heightSegments: 8 }, material: "metal", position: at(0.02, -SUB_OFFSET + 0.032, DIAL + 0.004), scale: [1, 1, 0.4] },
    // Date aperture at 3, left blank.
    { id: "date-frame", shape: { type: "box", size: [0.07, 0.042, 0.004] }, material: "metal", position: [0.205, 0, DIAL + 0.001] },
    { id: "date", shape: { type: "box", size: [0.06, 0.032, 0.004] }, material: "date", position: [0.205, 0, DIAL + 0.0025] },
    // Hands.
    { id: "hand-hour", shape: handShape(0.17, 0.026, 0.03), material: "metal", position: [0, 0, DIAL + 0.007], rotation: [0, 0, round(-hourAngle)] },
    { id: "hand-minute", shape: handShape(0.27, 0.02, 0.035), material: "metal", position: [0, 0, DIAL + 0.011], rotation: [0, 0, round(-minuteAngle)] },
    { id: "hand-second", shape: { type: "box", size: [0.0028, 0.34, 0.0015] }, material: "metal", position: at(secondX, secondY, DIAL + 0.016), rotation: [0, 0, round(-secondAngle)] },
    { id: "arbor", shape: { type: "cylinder", radiusTop: 0.012, radiusBottom: 0.012, height: 0.014, segments: 24 }, material: "metal", position: [0, 0, DIAL + 0.01], rotation: FACE },
    // Crown at 3: a stem and a fluted onion.
    { id: "crown-stem", shape: { type: "cylinder", radiusTop: 0.02, radiusBottom: 0.02, height: 0.05, segments: 16 }, material: "metal", position: [0.515, 0, -0.02], rotation: [0, 0, QUARTER] },
    {
      id: "crown",
      shape: { type: "lathe", points: [[0, 0], [0.044, 0], [0.06, 0.016], [0.064, 0.038], [0.055, 0.062], [0.028, 0.075], [0, 0.079]], segments: 20 },
      material: "metal",
      position: [0.53, 0, -0.02],
      rotation: [0, 0, -QUARTER],
    },
    // Wire lugs with screw caps, and the strap between them.
    ...lug(0.268, 0.43, "top-right"),
    ...lug(-0.268, 0.43, "top-left"),
    ...lug(0.268, -0.43, "bottom-right"),
    ...lug(-0.268, -0.43, "bottom-left"),
    ...strapSide("top"),
    ...strapSide("bottom"),
  ];

  return parseObjectSpec({
    format: "lts-object-spec",
    version: 1,
    id: "dress-watch",
    name: "Your dress watch",
    materials: {
      metal: { preset: "metal" },
      dial: { preset: "satin", color: "base", shade: 1.6 },
      center: { preset: "satin", color: "base", shade: 1.42 },
      sub: { preset: "satin", color: "base", shade: 1.5 },
      date: { preset: "matte", color: "base", shade: 1.85 },
      print: { preset: "matte", color: "base", shade: 0.12 },
      night: { preset: "matte", color: "emissive", shade: 0.42 },
      strap: { preset: "matte", color: "accent", shade: 0.42, roughness: 0.5 },
    },
    parts,
    sockets: [
      { id: "strap-mount-top", position: [0, 0.5, -0.035] },
      { id: "strap-mount-bottom", position: [0, -0.5, -0.035] },
    ],
  });
}
