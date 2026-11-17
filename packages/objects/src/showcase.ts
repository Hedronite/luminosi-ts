/**
 * The settings the catalog shows each object with. Its viewport, its stage and its snippets all build from these values,
 * and the draw calls and triangles budgeted in assets/budgets.json are measured with them (tools/assets/src/objects.ts):
 * change one here and every one of them follows.
 */
export const showcase = {
  cluster: { count: 14, spread: 0.7, seed: 11 },
  lattice: { size: 6, spacing: 0.28, scale: 0.06 },
  watch: { hours: 10, minutes: 9, seconds: 36 },
  framedSolid: { solid: "dodecahedron", radius: 0.95 },
} as const;
