import type { MaterialId } from "@hedronite/lts-materials";
import { orderStack, type ScreenEffectId } from "@hedronite/lts-postfx";
import type { PrimitiveId, Vec3 } from "@hedronite/lts-primitives";
import type { EffectId } from "@hedronite/lts-shaders";

/** Objects the playground can place, beside primitives and framed solids. */
export const placeableObjects = [
  { id: "crystal-cluster", name: "Crystal cluster" },
  { id: "instanced-lattice", name: "Instanced lattice" },
  { id: "dress-watch", name: "Dress watch" },
  { id: "your-desk-lamp", name: "Desk lamp" },
] as const;
export type PlaceableObject = (typeof placeableObjects)[number]["id"];

export const isPlaceableObject = (id: string): id is PlaceableObject => placeableObjects.some((object) => object.id === id);

/**
 * One thing in the scene: a primitive in a material or a surface shader, a framed solid (its faces in a
 * material or a shader), or a library object.
 */
export type Item =
  | { readonly kind: "primitive"; readonly primitive: PrimitiveId; readonly material: MaterialId; readonly shader?: EffectId }
  | { readonly kind: "framed"; readonly primitive: PrimitiveId; readonly faces: MaterialId; readonly edges: MaterialId; readonly shader?: EffectId }
  | { readonly kind: "object"; readonly object: PlaceableObject; readonly material: MaterialId };

export type Placement = Item & { readonly key: string };

/** One-ink prints use one of the look's scene colors; "look" prints with two inks. */
export type InkMode = "look" | "accent" | "emissive" | "glass";

export interface Composition {
  readonly placements: readonly Placement[];
  /** Scales the studio lights. 0.2 to 2.5. */
  readonly lightIntensity: number;
  /** Screen effects over the whole scene. */
  readonly effects: readonly ScreenEffectId[];
  readonly ink: InkMode;
}

export const MAX_PLACEMENTS = 8;

/** How big each placement is drawn (primitives and framed solids are about one unit across). */
export const PLACEMENT_SCALE = 0.5;

/** Library objects are built at their own size; this brings them to about a primitive's. */
export const OBJECT_SCALE = 0.6;

export const scaleOf = (item: Item): number => (item.kind === "object" ? OBJECT_SCALE : PLACEMENT_SCALE);

/** Positions on a ring, wide enough that neighbouring shapes never touch. */
export function arrange(count: number): readonly Vec3[] {
  if (count <= 1) return count === 1 ? [[0, 0, 0]] : [];
  const radius = Math.max(0.8, 0.6 / Math.sin(Math.PI / count));
  return Array.from({ length: count }, (_, i): Vec3 => {
    const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
    return [radius * Math.cos(angle), 0, radius * Math.sin(angle)];
  });
}

/** The item without its key, for export. */
function plain(placement: Placement): Item {
  switch (placement.kind) {
    case "primitive":
      return { kind: "primitive", primitive: placement.primitive, material: placement.material, ...(placement.shader === undefined ? {} : { shader: placement.shader }) };
    case "framed":
      return { kind: "framed", primitive: placement.primitive, faces: placement.faces, edges: placement.edges, ...(placement.shader === undefined ? {} : { shader: placement.shader }) };
    case "object":
      return { kind: "object", object: placement.object, material: placement.material };
  }
}

/** The effect stack in the order it runs. */
const stackOf = (composition: Composition): readonly ScreenEffectId[] => orderStack(composition.effects.map((id) => ({ id }))).map((effect) => effect.id);

/** The composition as JSON, for saving or sharing. */
export function toJson(composition: Composition): string {
  return JSON.stringify(
    {
      lightIntensity: composition.lightIntensity,
      placements: composition.placements.map(plain),
      ...(composition.effects.length === 0 ? {} : { effects: stackOf(composition), ink: composition.ink }),
    },
    null,
    2,
  );
}

const round = (n: number): string => String(Math.round(n * 1000) / 1000);

/** The JSX for one placement at a position. */
function element(item: Item, [x, y, z]: Vec3): string {
  const at = `position={[${round(x)}, ${round(y)}, ${round(z)}]} scale={${String(scaleOf(item))}}`;
  switch (item.kind) {
    case "primitive":
      return item.shader === undefined ? `<PrimitiveMesh primitive="${item.primitive}" material="${item.material}" ${at} />` : `<PrimitiveMesh primitive="${item.primitive}" shader="${item.shader}" ${at} />`;
    case "framed":
      return `<FramedSolid primitive="${item.primitive}" ${item.shader === undefined ? `faces="${item.faces}"` : `shader="${item.shader}"`} edges="${item.edges}" ${at} />`;
    case "object":
      switch (item.object) {
        case "crystal-cluster":
          return `<CrystalCluster count={14} spread={0.7} seed={11} material="${item.material}" ${at} />`;
        case "instanced-lattice":
          return `<Lattice size={6} spacing={0.28} nodeScale={0.06} material="${item.material}" ${at} />`;
        case "dress-watch":
        case "your-desk-lamp":
          return `<LibraryObject object="${item.object}" ${at} />`;
      }
  }
}

const componentOf = (item: Item): string => {
  if (item.kind === "primitive") return "PrimitiveMesh";
  if (item.kind === "framed") return "FramedSolid";
  if (item.object === "crystal-cluster") return "CrystalCluster";
  if (item.object === "instanced-lattice") return "Lattice";
  return "LibraryObject";
};

/**
 * The composition as React Three Fiber code using @hedronite/lts-adapters, on `WebGPUCanvas`: the
 * WebGPU renderer (with its WebGL 2 fallback) runs surface shaders, screen effects and materials alike.
 */
export function toTsx(composition: Composition): string {
  const positions = arrange(composition.placements.length);
  const stack = stackOf(composition);
  const components = new Set(["StudioEnvironment", "StudioLights", "WebGPUCanvas", ...composition.placements.map(componentOf), ...(stack.length > 0 ? ["ScreenEffectsPass"] : [])]);
  const ink = composition.ink === "look" || stack.length === 0 ? "" : ` monochrome={palette.${composition.ink}}`;
  return [
    `import { ${[...components].sort().join(", ")} } from "@hedronite/lts-adapters";`,
    ...(ink === "" ? [] : ['import { neutral } from "@hedronite/lts-tokens";']),
    "",
    ...(stack.length > 0 ? [`// Defined once, outside the component: a new array would rebuild the passes.`, `const stack = [${stack.map((id) => `{ id: "${id}" }`).join(", ")}] as const;`] : []),
    ...(ink === "" ? [] : ["const palette = neutral.scene;"]),
    ...(stack.length > 0 || ink !== "" ? [""] : []),
    "export function Scene() {",
    "  return (",
    "    <WebGPUCanvas>",
    "      <StudioEnvironment />",
    `      <StudioLights intensity={${String(composition.lightIntensity)}} />`,
    ...composition.placements.map((placement, i) => `      ${element(placement, positions[i] ?? [0, 0, 0])}`),
    ...(stack.length > 0 ? [`      <ScreenEffectsPass effects={stack}${ink} />`] : []),
    "    </WebGPUCanvas>",
    "  );",
    "}",
  ].join("\n");
}
