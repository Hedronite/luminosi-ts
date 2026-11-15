import { createRandom } from "@hedronite/lts-core";
import type { Vec3 } from "@hedronite/lts-primitives";

/** One crystal in a cluster, as plain data. */
export interface CrystalSpec {
  /** Centre of the crystal. */
  readonly position: Vec3;
  /** Unit vector along the crystal, from its base to its tip. */
  readonly axis: Vec3;
  readonly sides: number;
  /** Tip-to-tip length along the crystal's axis. */
  readonly height: number;
  /** Distance from the axis to the girdle. */
  readonly radius: number;
}

export interface ClusterOptions {
  /** How many crystals, 1 to 64. Default 9. */
  readonly count?: number;
  /** How far crystals lean from upright, 0 (straight up) to 1 (up to 50°). Default 0.6. */
  readonly spread?: number;
  readonly seed?: number;
}

const SIDES = [5, 6, 6, 6, 8] as const;
const BASE = -0.6;
const MAX_LEAN = (50 * Math.PI) / 180;

/** A crystal cluster as data: crystals rising from near the origin, leaning outward. Same seed, same cluster. */
export function crystalCluster({ count = 9, spread = 0.6, seed = 1 }: ClusterOptions = {}): readonly CrystalSpec[] {
  if (!Number.isInteger(count) || count < 1 || count > 64) {
    throw new RangeError(`count must be an integer from 1 to 64, got ${String(count)}`);
  }
  if (!(spread >= 0 && spread <= 1)) {
    throw new RangeError(`spread must be from 0 to 1, got ${String(spread)}`);
  }
  const random = createRandom(seed);
  return Array.from({ length: count }, (_, i): CrystalSpec => {
    const lean = (i === 0 ? 0.1 : random.range(0.2, 1)) * spread * MAX_LEAN;
    const heading = random.range(0, 2 * Math.PI);
    const height = i === 0 ? 1.2 : random.range(0.45, 0.9);
    const radius = height * random.range(0.11, 0.16);
    const reach = random.range(0, 0.12);
    const axis: Vec3 = [Math.sin(lean) * Math.cos(heading), Math.cos(lean), Math.sin(lean) * Math.sin(heading)];
    // Every crystal rises from a base point on the floor (y = BASE), so the cluster sits as one piece.
    const base: Vec3 = [Math.cos(heading) * reach, BASE, Math.sin(heading) * reach];
    return {
      position: [base[0] + (axis[0] * height) / 2, base[1] + (axis[1] * height) / 2, base[2] + (axis[2] * height) / 2],
      axis,
      sides: random.pick(SIDES),
      height,
      radius,
    };
  });
}

export interface LatticeOptions {
  /** Points per side, 1 to 16. Default 5. */
  readonly size?: number;
  /** Distance between neighbours. Default 0.3. */
  readonly spacing?: number;
}

/** A cubic grid of points centred on the origin: size³ points. */
export function latticePoints({ size = 5, spacing = 0.3 }: LatticeOptions = {}): readonly Vec3[] {
  if (!Number.isInteger(size) || size < 1 || size > 16) {
    throw new RangeError(`size must be an integer from 1 to 16, got ${String(size)}`);
  }
  const offset = ((size - 1) * spacing) / 2;
  const points: Vec3[] = [];
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) points.push([x * spacing - offset, y * spacing - offset, z * spacing - offset]);
  return points;
}
