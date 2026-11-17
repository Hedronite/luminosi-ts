import type { AssetMeta } from "@hedronite/lts-core";
import { iconToSvg, type IconData } from "@hedronite/lts-icons";
import { objectSpecById } from "@hedronite/lts-objects";

export interface Snippet {
  readonly label: string;
  readonly code: string;
}

const camel = (id: string): string => id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascal = (id: string): string => camel(id).replace(/^[a-z]/, (c) => c.toUpperCase());

/** Copy-ready usage for an asset. Kinds without a package yet have none. */
export function snippetsFor(meta: AssetMeta, icon: IconData | undefined): readonly Snippet[] {
  if (meta.kind === "icon" && icon !== undefined) {
    const component = pascal(meta.id);
    const constant = camel(meta.id);
    return [
      { label: "React", code: `import { ${component} } from "@hedronite/lts-icons/react";\n\n<${component} title="${meta.name}" />` },
      { label: "TypeScript", code: `import { ${constant}, iconToSvg } from "@hedronite/lts-icons";\n\nconst svg = iconToSvg(${constant}, { title: "${meta.name}" });` },
      { label: "SVG", code: iconToSvg(icon) },
    ];
  }
  if (meta.kind === "primitive") {
    return [
      {
        label: "TypeScript",
        code: `import { primitive } from "@hedronite/lts-primitives";\nimport { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";\nimport { Mesh, MeshStandardMaterial } from "three";\n\nconst geometry = createPolyhedronGeometry(primitive("${meta.id}"));\nconst mesh = new Mesh(geometry, new MeshStandardMaterial());\n// Later: geometry.dispose();`,
      },
    ];
  }
  if (meta.id === "crystal-cluster") {
    return [
      {
        label: "TypeScript",
        code: `import { createMaterial } from "@hedronite/lts-materials/three";\nimport { crystalCluster } from "@hedronite/lts-objects";\nimport { createCrystalCluster } from "@hedronite/lts-objects/three";\nimport { disposeObject } from "@hedronite/lts-primitives/three";\n\n// Same seed, same cluster.\nconst cluster = createCrystalCluster(crystalCluster({ count: 14, spread: 0.7, seed: 11 }), createMaterial("satin"));\n// Later: disposeObject(cluster);`,
      },
    ];
  }
  if (meta.id === "framed-solid") {
    return [
      {
        label: "TypeScript",
        code: `import { createMaterial } from "@hedronite/lts-materials/three";\nimport { createFramedSolid } from "@hedronite/lts-objects/three";\nimport { archimedean } from "@hedronite/lts-primitives";\nimport { disposeObject } from "@hedronite/lts-primitives/three";\nimport { hedronite } from "@hedronite/lts-tokens";\n\n// Glass faces, copper edges and glass beads: three draw calls for any solid.\nconst palette = hedronite.scene;\nconst solid = createFramedSolid(archimedean("truncated-icosahedron"), {\n  faces: createMaterial("glass", palette),\n  edges: createMaterial("metal", { ...palette, metal: palette.accent }),\n});\n// Later: disposeObject(solid);`,
      },
    ];
  }
  if (meta.id === "instanced-lattice") {
    return [
      {
        label: "TypeScript",
        code: `import { createMaterial } from "@hedronite/lts-materials/three";\nimport { latticePoints } from "@hedronite/lts-objects";\nimport { createLattice } from "@hedronite/lts-objects/three";\n\n// 216 octahedra, one draw call.\nconst lattice = createLattice(latticePoints({ size: 6, spacing: 0.28 }), createMaterial("metal"), { scale: 0.06 });`,
      },
    ];
  }
  if (meta.id === "crystal-cluster-glb") {
    return [
      {
        label: "TypeScript",
        code: `import { loadGltf } from "@hedronite/lts-objects/three";\n\n// Built by tools/assets: one draw call, meshopt-compressed, decoded by three's bundled decoder.\nconst scene = await loadGltf("/models/crystal-cluster-glb.glb");`,
      },
    ];
  }
  if (meta.kind === "object" && objectSpecById(meta.id) !== undefined) {
    return [
      {
        label: "TypeScript",
        code: `import { objectSpecById } from "@hedronite/lts-objects";\nimport { createObjectFromSpec } from "@hedronite/lts-objects/three";\nimport { disposeObject } from "@hedronite/lts-primitives/three";\n\n// Stored as data in assets/src/objects; the palette picks the colors.\nconst spec = objectSpecById("${meta.id}");\nif (spec !== undefined) {\n  const object = createObjectFromSpec(spec);\n  // Later: disposeObject(object);\n}`,
      },
    ];
  }
  if (meta.id === "dress-watch") {
    return [
      {
        label: "TypeScript",
        code: `import { dressWatchSpec } from "@hedronite/lts-objects";\nimport { createObjectFromSpec } from "@hedronite/lts-objects/three";\nimport { hedronite } from "@hedronite/lts-tokens";\n\n// The spec is plain JSON: store it, diff it, review it. The palette picks the metal and strap.\nconst spec = dressWatchSpec({ hours: 10, minutes: 9, seconds: 36 });\nconst watch = createObjectFromSpec(spec, { palette: hedronite.scene });\n// Later: disposeObject(watch) from @hedronite/lts-primitives.`,
      },
    ];
  }
  if (meta.kind === "scene") {
    const kit = meta.id.replace(/^scene-/, "");
    return [
      {
        label: "TypeScript",
        code: `import { disposeObject } from "@hedronite/lts-primitives/three";\nimport { createSceneKit } from "@hedronite/lts-scenes/three";\n\n// Lights and shapes in one group; use it instead of other lights.\nconst kit = createSceneKit("${kit}");\nscene.add(kit);\n// Later: disposeObject(kit);`,
      },
    ];
  }
  if (meta.kind === "effect") {
    return [
      {
        label: "TypeScript",
        code: `import { ScreenEffects } from "@hedronite/lts-postfx/three";\nimport { hedronite } from "@hedronite/lts-tokens";\nimport { WebGPURenderer } from "three/webgpu";\n\nconst renderer = new WebGPURenderer({ antialias: true, alpha: true });\nawait renderer.init();\n// Inks from the look: lapis and copper with the Hedronite preset.\nconst effects = new ScreenEffects(renderer, scene, camera, [{ id: "${meta.id}" }], { palette: hedronite.scene });\n// Each frame, instead of renderer.render(scene, camera):\neffects.render(delta);\n// Later: effects.dispose();`,
      },
      {
        label: "React",
        code: `import { ScreenEffectsPass, WebGPUCanvas } from "@hedronite/lts-adapters/webgpu";\n\nconst stack = [{ id: "${meta.id}" }] as const; // keep it stable: a new array rebuilds the passes\n\n// The WebGPU renderer (WebGL 2 where WebGPU is missing) runs screen effects and surface shaders together.\n<WebGPUCanvas>\n  {/* your scene */}\n  <ScreenEffectsPass effects={stack} />\n</WebGPUCanvas>`,
      },
    ];
  }
  if (meta.kind === "shader") {
    return [
      {
        label: "TypeScript",
        code: `import { createEffectMaterial } from "@hedronite/lts-shaders/three";\nimport { WebGPURenderer } from "three/webgpu";\n\n// TSL materials need WebGPURenderer; it falls back to WebGL 2 where WebGPU is missing.\nconst renderer = new WebGPURenderer({ antialias: true });\nawait renderer.init();\nconst material = createEffectMaterial("${meta.id}");`,
      },
    ];
  }
  if (meta.kind === "material") {
    return [
      {
        label: "TypeScript",
        code: `import { createMaterial } from "@hedronite/lts-materials/three";\nimport { hedronite } from "@hedronite/lts-tokens";\n\nconst material = createMaterial("${meta.id}"); // neutral colors\nconst branded = createMaterial("${meta.id}", hedronite.scene);\n// Later: material.dispose();`,
      },
    ];
  }
  return [];
}
