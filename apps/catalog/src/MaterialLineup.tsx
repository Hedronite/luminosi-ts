import { StudioLights } from "@hedronite/lts-adapters";
import { materialIds, materialPreset } from "@hedronite/lts-materials";
import { createMaterial } from "@hedronite/lts-materials/three";
import { isPrimitiveId, primitive, primitiveIds, primitiveInfo, type PrimitiveId } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { Canvas } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SphereGeometry } from "three";
import { lineupLayout } from "./lineup";
import { usePreset } from "./look";
import { Environment, GpuCounts } from "./scene";

const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";

type Shape = "sphere" | PrimitiveId;

function geometryFor(shape: Shape) {
  // The sphere is smooth, so coats, sheens and films read without facets; the primitives keep theirs.
  return shape === "sphere" ? new SphereGeometry(0.95, 64, 32) : createPolyhedronGeometry(primitive(shape), shape);
}

/** Every material on the same shape, one per cell; 1 world unit is 1 CSS pixel, so cells line up with the labels. */
function Spheres({ shape, palette, width, cell, cols }: { readonly shape: Shape; readonly palette: ScenePalette; readonly width: number; readonly cell: number; readonly cols: number }) {
  const rows = Math.ceil(materialIds.length / cols);
  const resources = useMemo(() => ({ geometry: geometryFor(shape), materials: materialIds.map((id) => createMaterial(id, palette)) }), [shape, palette]);
  useEffect(
    () => () => {
      resources.geometry.dispose();
      for (const material of resources.materials) material.dispose();
    },
    [resources],
  );
  const height = rows * cell;
  return (
    <>
      {resources.materials.map((material, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        return (
          <mesh
            key={material.name}
            geometry={resources.geometry}
            material={material}
            dispose={null}
            position={[(col + 0.5) * cell - width / 2, height / 2 - (row + 0.42) * cell, 0]}
            scale={cell * 0.3}
            rotation={shape === "sphere" ? [0, 0, 0] : [0.35, 0.6, 0]}
          />
        );
      })}
    </>
  );
}

/** Every material side by side on one shape, under the current look. */
export function MaterialLineup() {
  const preset = usePreset();
  const [shape, setShape] = useState<Shape>("sphere");
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const { cols, cell, height } = lineupLayout(width, materialIds.length);

  return (
    <section aria-labelledby="lineup-title" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="lineup-title" className="text-lg font-semibold">
            Materials side by side
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            All {String(materialIds.length)} materials on one shape, in the {preset.name} look.
          </p>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="lineup-shape">Shape</label>
          <select
            id="lineup-shape"
            className={field}
            value={shape}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "sphere" || isPrimitiveId(next)) setShape(next);
            }}
          >
            <option value="sphere">Sphere</option>
            {primitiveIds.map((id) => (
              <option key={id} value={id}>
                {primitiveInfo(id).name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div ref={box} className="relative mt-3 overflow-hidden rounded-xl border border-line bg-surface-raised" style={{ height }} data-testid="material-lineup">
        {width === 0 ? null : (
          <>
            <div role="group" aria-label={`${String(materialIds.length)} materials on the ${shape === "sphere" ? "sphere" : primitiveInfo(shape).name} shape, in a grid.`} className="absolute inset-0">
              <Canvas frameloop="demand" dpr={[1, 2]} orthographic camera={{ position: [0, 0, 500], zoom: 1, near: 1, far: 2000 }}>
                <Environment />
                <StudioLights />
                <Spheres key={`${shape}:${preset.id}`} shape={shape} palette={preset.scene} width={width} cell={cell} cols={cols} />
                <GpuCounts target={box} />
              </Canvas>
            </div>
            <ul aria-label="Materials in the lineup" className="pointer-events-none absolute inset-0 grid content-start" style={{ gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))` }}>
              {materialIds.map((id) => (
                <li key={id} className="flex items-end justify-center pb-2 text-center text-xs" style={{ height: cell }}>
                  <span className="text-balance rounded bg-surface/70 px-1.5 py-0.5">{materialPreset(id).name}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
