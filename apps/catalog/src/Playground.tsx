import { PrimitiveMesh, StudioLights } from "@hedronite/lts-adapters";
import { Close } from "@hedronite/lts-icons/react";
import { isMaterialId, materialIds, materialPreset, type MaterialId } from "@hedronite/lts-materials";
import { isPrimitiveId, primitiveIds, primitiveInfo, type PrimitiveId } from "@hedronite/lts-primitives";
import { Canvas } from "@react-three/fiber";
import { useRef, useState } from "react";
import { arrange, MAX_PLACEMENTS, PLACEMENT_SCALE, toJson, toTsx, type Composition, type Placement } from "./composition";
import { CopyButton } from "./CopyButton";
import { usePreset } from "./look";
import { Controls, Environment, GpuCounts } from "./scene";

const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";

let nextKey = 0;
const place = (primitive: PrimitiveId, material: MaterialId): Placement => {
  nextKey += 1;
  return { key: String(nextKey), primitive, material };
};

const starter: Composition = {
  lightIntensity: 1,
  placements: [place("platonic-cube", "satin"), place("platonic-icosahedron", "glass"), place("platonic-octahedron", "metal")],
};

/** Compose primitives and materials into a small scene, then export it as JSON or code. */
export function Playground() {
  const preset = usePreset();
  const [composition, setComposition] = useState<Composition>(starter);
  const [primitive, setPrimitive] = useState<PrimitiveId>("platonic-dodecahedron");
  const [material, setMaterial] = useState<MaterialId>("ceramic");
  const host = useRef<HTMLDivElement>(null);
  const positions = arrange(composition.placements.length);
  const full = composition.placements.length >= MAX_PLACEMENTS;

  return (
    <section aria-labelledby="playground-title" className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
      <div className="flex flex-col gap-4">
        <h2 id="playground-title" className="text-lg font-semibold">
          Playground
        </h2>
        <label className="flex flex-col gap-1 text-sm">
          Primitive
          <select
            className={field}
            value={primitive}
            onChange={(event) => {
              if (isPrimitiveId(event.target.value)) setPrimitive(event.target.value);
            }}
          >
            {primitiveIds.map((id) => (
              <option key={id} value={id}>
                {primitiveInfo(id).name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Material
          <select
            className={field}
            value={material}
            onChange={(event) => {
              if (isMaterialId(event.target.value)) setMaterial(event.target.value);
            }}
          >
            {materialIds.map((id) => (
              <option key={id} value={id}>
                {materialPreset(id).name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={full}
          onClick={() => {
            setComposition((c) => ({ ...c, placements: [...c.placements, place(primitive, material)] }));
          }}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {full ? `Scene is full (${String(MAX_PLACEMENTS)})` : "Add to scene"}
        </button>

        <ol aria-label="Scene" className="flex flex-col gap-1">
          {composition.placements.map((placement) => {
            const label = `${primitiveInfo(placement.primitive).name}, ${materialPreset(placement.material).name}`;
            return (
              <li key={placement.key} className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5 text-sm">
                {label}
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => {
                    setComposition((c) => ({ ...c, placements: c.placements.filter((p) => p.key !== placement.key) }));
                  }}
                  className="rounded p-1 hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Close size={16} />
                </button>
              </li>
            );
          })}
        </ol>

        <label className="flex flex-col gap-1 text-sm">
          <span>
            Light <output>{composition.lightIntensity.toFixed(1)}</output>
          </span>
          <input
            type="range"
            min={0.2}
            max={2.5}
            step={0.1}
            value={composition.lightIntensity}
            onChange={(event) => {
              setComposition((c) => ({ ...c, lightIntensity: Number(event.target.value) }));
            }}
          />
        </label>
      </div>

      <div className="flex flex-col gap-4">
        <div
          ref={host}
          role="img"
          aria-label={`The composed scene: ${String(composition.placements.length)} shapes. Drag to rotate, scroll to zoom.`}
          className="h-96 overflow-hidden rounded-xl border border-line bg-surface-raised"
          data-testid="playground-viewport"
        >
          <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 2.2, 5.5], fov: 40 }}>
            <Environment />
            <StudioLights intensity={composition.lightIntensity} />
            <Controls />
            {composition.placements.map((placement, i) => (
              <PrimitiveMesh
                key={placement.key}
                primitive={placement.primitive}
                material={placement.material}
                palette={preset.scene}
                position={positions[i] ?? [0, 0, 0]}
                scale={PLACEMENT_SCALE}
                rotation={[0.3, 0.5, 0]}
              />
            ))}
            <GpuCounts target={host} />
          </Canvas>
        </div>
        {[
          { label: "JSON export", code: toJson(composition) },
          { label: "React export", code: toTsx(composition) },
        ].map((snippet) => (
          <section key={snippet.label} aria-label={snippet.label}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{snippet.label}</h3>
              <CopyButton text={snippet.code} what={snippet.label} />
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-surface-raised p-3 text-xs">
              <code>{snippet.code}</code>
            </pre>
          </section>
        ))}
      </div>
    </section>
  );
}
