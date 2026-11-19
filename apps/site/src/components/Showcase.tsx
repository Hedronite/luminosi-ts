import { PrimitiveMesh, StudioEnvironment, StudioLights } from "@hedronite/lts-adapters";
import type { PrimitiveId } from "@hedronite/lts-primitives";
import { hedronite, neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { Canvas } from "@react-three/fiber";
import { useRef, useSyncExternalStore } from "react";
import { IslandCounts } from "./IslandCounts";

const pieces: readonly { readonly primitive: PrimitiveId; readonly material: "satin" | "glass" | "metal"; readonly x: number }[] = [
  { primitive: "platonic-octahedron", material: "metal", x: -1.3 },
  { primitive: "platonic-icosahedron", material: "glass", x: 0 },
  { primitive: "platonic-dodecahedron", material: "satin", x: 1.3 },
];

/** The look the page is showing: its theme CSS answers to `data-preset` on the root element, and the solids follow it. */
const subscribe = (change: () => void): (() => void) => {
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-preset"] });
  return () => {
    observer.disconnect();
  };
};
const lookOf = (): string => document.documentElement.dataset["preset"] ?? "";

/** The scene colors of the page's look: Hedronite's where the page shows it, the neutral set otherwise. */
const paletteFor = (look: string): ScenePalette => (look === "hedronite" ? hedronite.scene : neutral.scene);

/** The page's only island: three solids from @hedronite/lts-adapters, rendered on demand. A change of look recolors them in place. */
export default function Showcase() {
  const host = useRef<HTMLDivElement>(null);
  const palette = paletteFor(useSyncExternalStore(subscribe, lookOf, () => ""));
  return (
    <div ref={host} role="img" aria-label="An octahedron in metal, an icosahedron in glass and a dodecahedron in satin, rendered in 3D." className="h-72 w-full">
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 0.6, 4.2], fov: 40 }}>
        <StudioEnvironment />
        <StudioLights />
        {pieces.map((piece) => (
          <PrimitiveMesh key={piece.primitive} primitive={piece.primitive} material={piece.material} palette={palette} position={[piece.x, 0, 0]} scale={0.55} rotation={[0.35, 0.6, 0]} />
        ))}
        <IslandCounts target={host} />
      </Canvas>
    </div>
  );
}
