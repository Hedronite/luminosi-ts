import type { MaterialId } from "@hedronite/lts-materials";
import type { PrimitiveId, Vec3 } from "@hedronite/lts-primitives";

export interface Placement {
  readonly key: string;
  readonly primitive: PrimitiveId;
  readonly material: MaterialId;
}

export interface Composition {
  readonly placements: readonly Placement[];
  /** Scales the studio lights. 0.2 to 2.5. */
  readonly lightIntensity: number;
}

export const MAX_PLACEMENTS = 8;

/** How big each primitive is drawn in the playground (they are about one unit across). */
export const PLACEMENT_SCALE = 0.5;

/** Positions on a ring, wide enough that neighbouring shapes never touch. */
export function arrange(count: number): readonly Vec3[] {
  if (count <= 1) return count === 1 ? [[0, 0, 0]] : [];
  const radius = Math.max(0.8, 0.6 / Math.sin(Math.PI / count));
  return Array.from({ length: count }, (_, i): Vec3 => {
    const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
    return [radius * Math.cos(angle), 0, radius * Math.sin(angle)];
  });
}

/** The composition as JSON, for saving or sharing. */
export function toJson(composition: Composition): string {
  return JSON.stringify(
    { lightIntensity: composition.lightIntensity, placements: composition.placements.map(({ primitive, material }) => ({ primitive, material })) },
    null,
    2,
  );
}

const round = (n: number): string => String(Math.round(n * 1000) / 1000);

/** The composition as React Three Fiber code using @hedronite/lts-adapters. */
export function toTsx(composition: Composition): string {
  const positions = arrange(composition.placements.length);
  const meshes = composition.placements.map((placement, i) => {
    const [x, y, z] = positions[i] ?? [0, 0, 0];
    return `      <PrimitiveMesh primitive="${placement.primitive}" material="${placement.material}" position={[${round(x)}, ${round(y)}, ${round(z)}]} scale={${String(PLACEMENT_SCALE)}} />`;
  });
  return [
    'import { PrimitiveMesh, StudioLights } from "@hedronite/lts-adapters";',
    'import { Canvas } from "@react-three/fiber";',
    "",
    "export function Scene() {",
    "  return (",
    "    <Canvas>",
    `      <StudioLights intensity={${String(composition.lightIntensity)}} />`,
    ...meshes,
    "    </Canvas>",
    "  );",
    "}",
  ].join("\n");
}
