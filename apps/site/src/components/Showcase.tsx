import { PrimitiveMesh, StudioEnvironment, StudioLights } from "@hedronite/lts-adapters";
import type { PrimitiveId } from "@hedronite/lts-primitives";
import { Canvas } from "@react-three/fiber";

const pieces: readonly { readonly primitive: PrimitiveId; readonly material: "satin" | "glass" | "metal"; readonly x: number }[] = [
  { primitive: "platonic-octahedron", material: "metal", x: -1.3 },
  { primitive: "platonic-icosahedron", material: "glass", x: 0 },
  { primitive: "platonic-dodecahedron", material: "satin", x: 1.3 },
];

/** The page's only island: three solids from @hedronite/lts-adapters, rendered on demand. */
export default function Showcase() {
  return (
    <div role="img" aria-label="An octahedron in metal, an icosahedron in glass and a dodecahedron in satin, rendered in 3D." className="h-72 w-full">
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 0.6, 4.2], fov: 40 }}>
        <StudioEnvironment />
        <StudioLights />
        {pieces.map((piece) => (
          <PrimitiveMesh key={piece.primitive} primitive={piece.primitive} material={piece.material} position={[piece.x, 0, 0]} scale={0.55} rotation={[0.35, 0.6, 0]} />
        ))}
      </Canvas>
    </div>
  );
}
