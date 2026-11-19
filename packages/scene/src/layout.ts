/** A point or a size in three dimensions. */
export type Vec3 = readonly [number, number, number];

/**
 * Where the n-th of `count` nodes sits when they stand on a ring: wide enough that neighbouring shapes never touch,
 * the first at the back. One node sits at the origin. This is the layout the playground has always used, made a
 * function of the document so a version 0 composition can be given its positions.
 */
export function ringLayout(count: number): readonly Vec3[] {
  if (count <= 1) return count === 1 ? [[0, 0, 0]] : [];
  const radius = Math.max(0.8, 0.6 / Math.sin(Math.PI / count));
  return Array.from({ length: count }, (_, i): Vec3 => {
    const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
    return [radius * Math.cos(angle), 0, radius * Math.sin(angle)];
  });
}
