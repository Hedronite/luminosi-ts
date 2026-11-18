import { defineDescriptor, type AssetDescriptor, type BuildOptions, type ParameterHints, type SnippetTemplate } from "@hedronite/lts-core";
import { materialIds } from "@hedronite/lts-materials";
import { platonic, platonicSolids } from "@hedronite/lts-primitives";
import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { z } from "zod";
import { crystalCluster, latticePoints } from "./cluster.js";
import { libraryObjects, objectSpecById } from "./library.js";
import { showcase } from "./showcase.js";
import { dressWatchSpec } from "./specs/dressWatch.js";
import type { loadGltf } from "./gltf.js";
import type { createCrystalCluster, createLattice } from "./meshes.js";

/** What `build` makes: the object, which the caller owns and frees with `disposeObject` from `@hedronite/lts-primitives/three`. */
export type ObjectBuilt = Awaited<ReturnType<typeof createCrystalCluster> | ReturnType<typeof createLattice> | ReturnType<typeof loadGltf>>;

/** The material builders, loaded when an object is built: objects draw on materials. */
const materials = () => import("@hedronite/lts-materials/three");

const withPalette = (palette: ScenePalette | undefined): { readonly palette?: ScenePalette } => (palette === undefined ? {} : { palette });

/** What is particular to one object: the rest of its descriptor, its metadata, comes from the ObjectInfo given beside it. */
interface Entry<Shape extends z.ZodRawShape> {
  readonly parameters: z.ZodObject<Shape>;
  readonly hints?: ParameterHints;
  readonly templates: readonly SnippetTemplate[];
  readonly vars?: (params: z.output<z.ZodObject<Shape>>) => Readonly<Record<string, string>>;
  readonly build: (params: z.output<z.ZodObject<Shape>>, palette: ScenePalette | undefined, options: BuildOptions) => Promise<ObjectBuilt>;
}

/** The package every object here ships in. */
const packageName = "@hedronite/lts-objects";

/** What an object says about itself: the manifest entry the registry, the CLI and the catalog list it by. */
interface ObjectInfo {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  /** The day it joined the library (YYYY-MM-DD). */
  readonly added: string;
}

/**
 * An object's descriptor: its own metadata and what is particular to it. The objects manifest is derived from these,
 * so adding an object is adding one `describe` below and nothing else.
 */
function describe<Shape extends z.ZodRawShape>(info: ObjectInfo, entry: Entry<Shape>): AssetDescriptor<ObjectBuilt, ScenePalette> {
  return defineDescriptor({ meta: { ...info, kind: "object", version: "0.1.0", package: packageName }, ...entry });
}

/** An object stored as data (assets/src/objects): built from its spec, the palette picking the colors. */
const stored = (info: ObjectInfo) =>
  describe(info, {
    parameters: z.object({}),
    templates: [
      {
        label: "TypeScript",
        code: `import { objectSpecById } from "@hedronite/lts-objects";\nimport { createObjectFromSpec } from "@hedronite/lts-objects/three";\nimport { disposeObject } from "@hedronite/lts-primitives/three";\n\n// Stored as data in assets/src/objects; the palette picks the colors.\nconst spec = objectSpecById("{{id}}");\nif (spec !== undefined) {\n  const object = createObjectFromSpec(spec);\n  // Later: disposeObject(object);\n}`,
      },
    ],
    build: async (_params, palette) => {
      const { createObjectFromSpec } = await import("./fromSpec.js");
      const spec = objectSpecById(info.id);
      if (spec === undefined) throw new RangeError(`${info.id} is listed as an object stored as data but has no spec`);
      return createObjectFromSpec(spec, withPalette(palette));
    },
  });

/**
 * The objects defined in code: the four procedural objects and the glTF model, each with its own parameters. Imports no
 * three.js: `build` loads the module it needs when it is called. The defaults are the catalog's showcase settings. Add an object by
 * adding a `describe` here and running `bun run objects`, which writes the light list the manifest reads
 * (generated/manifest.ts), so listing objects never loads their descriptors.
 */
export const procedural: readonly AssetDescriptor<ObjectBuilt, ScenePalette>[] = [
  describe({ id: "crystal-cluster", name: "Crystal cluster", tags: ["procedural", "crystal"], added: "2026-11-15" }, {
    parameters: z.object({
      count: z.number().int().min(1).max(64).default(showcase.cluster.count),
      spread: z.number().min(0).max(1).default(showcase.cluster.spread),
      seed: z.number().int().default(showcase.cluster.seed),
      material: z.enum(materialIds).default("satin"),
    }),
    hints: { count: { label: "Crystals", group: "Shape" }, spread: { label: "Lean", group: "Shape", step: 0.05 }, seed: { label: "Seed", group: "Random" }, material: { label: "Material", group: "Surface" } },
    templates: [
      {
        label: "TypeScript",
        code: `import { createMaterial } from "@hedronite/lts-materials/three";\nimport { crystalCluster } from "@hedronite/lts-objects";\nimport { createCrystalCluster } from "@hedronite/lts-objects/three";\nimport { disposeObject } from "@hedronite/lts-primitives/three";\n\n// Same seed, same cluster.\nconst cluster = createCrystalCluster(crystalCluster({ count: {{param.count}}, spread: {{param.spread}}, seed: {{param.seed}} }), createMaterial("satin"));\n// Later: disposeObject(cluster);`,
      },
    ],
    build: async ({ material, ...shape }, palette) => {
      const [{ createCrystalCluster }, { createMaterial }] = await Promise.all([import("./meshes.js"), materials()]);
      return createCrystalCluster(crystalCluster(shape), createMaterial(material, palette));
    },
  }),

  describe({ id: "framed-solid", name: "Framed solid", tags: ["procedural", "glass", "polyhedron"], added: "2026-11-16" }, {
    parameters: z.object({
      solid: z.enum(platonicSolids).default(showcase.framedSolid.solid),
      radius: z.number().min(0.2).max(2).default(showcase.framedSolid.radius),
    }),
    hints: { solid: { label: "Solid", group: "Shape" }, radius: { label: "Radius", group: "Shape", step: 0.05 } },
    templates: [
      {
        label: "TypeScript",
        code: `import { createMaterial } from "@hedronite/lts-materials/three";\nimport { createFramedSolid } from "@hedronite/lts-objects/three";\nimport { archimedean } from "@hedronite/lts-primitives";\nimport { disposeObject } from "@hedronite/lts-primitives/three";\nimport { hedronite } from "@hedronite/lts-tokens";\n\n// Glass faces, copper edges and glass beads: three draw calls for any solid.\nconst palette = hedronite.scene;\nconst solid = createFramedSolid(archimedean("truncated-icosahedron"), {\n  faces: createMaterial("glass", palette),\n  edges: createMaterial("metal", { ...palette, metal: palette.accent }),\n});\n// Later: disposeObject(solid);`,
      },
    ],
    build: async ({ solid, radius }, palette) => {
      const [{ createFramedSolid }, { createMaterial }] = await Promise.all([import("./framed.js"), materials()]);
      // Glass faces with edges and beads in metal tinted by the look's accent: copper in the Hedronite look.
      const look = palette ?? neutral.scene;
      return createFramedSolid(platonic(solid, radius), { faces: createMaterial("glass", look), edges: createMaterial("metal", { ...look, metal: look.accent }) });
    },
  }),

  describe({ id: "instanced-lattice", name: "Instanced lattice", tags: ["procedural", "instanced"], added: "2026-11-15" }, {
    parameters: z.object({
      size: z.number().int().min(1).max(16).default(showcase.lattice.size),
      spacing: z.number().min(0.05).max(1).default(showcase.lattice.spacing),
      scale: z.number().min(0.01).max(0.3).default(showcase.lattice.scale),
      material: z.enum(materialIds).default("metal"),
    }),
    hints: { size: { label: "Points per side", group: "Shape" }, spacing: { label: "Spacing", group: "Shape", step: 0.01 }, scale: { label: "Point size", group: "Shape", step: 0.005 }, material: { label: "Material", group: "Surface" } },
    templates: [
      {
        label: "TypeScript",
        code: `import { createMaterial } from "@hedronite/lts-materials/three";\nimport { latticePoints } from "@hedronite/lts-objects";\nimport { createLattice } from "@hedronite/lts-objects/three";\n\n// {{points}} octahedra, one draw call.\nconst lattice = createLattice(latticePoints({ size: {{param.size}}, spacing: {{param.spacing}} }), createMaterial("metal"), { scale: {{param.scale}} });`,
      },
    ],
    vars: ({ size }) => ({ points: String(size ** 3) }),
    build: async ({ size, spacing, scale, material }, palette) => {
      const [{ createLattice }, { createMaterial }] = await Promise.all([import("./meshes.js"), materials()]);
      return createLattice(latticePoints({ size, spacing }), createMaterial(material, palette), { scale });
    },
  }),

  describe({ id: "dress-watch", name: "Your dress watch", tags: ["object-spec", "image-reconstruction", "watch"], added: "2026-11-15" }, {
    parameters: z.object({
      hours: z.number().int().min(0).max(23).default(showcase.watch.hours),
      minutes: z.number().int().min(0).max(59).default(showcase.watch.minutes),
      seconds: z.number().int().min(0).max(59).default(showcase.watch.seconds),
    }),
    hints: { hours: { label: "Hours", group: "Time" }, minutes: { label: "Minutes", group: "Time" }, seconds: { label: "Seconds", group: "Time" } },
    templates: [
      {
        label: "TypeScript",
        code: `import { dressWatchSpec } from "@hedronite/lts-objects";\nimport { createObjectFromSpec } from "@hedronite/lts-objects/three";\nimport { hedronite } from "@hedronite/lts-tokens";\n\n// The spec is plain JSON: store it, diff it, review it. The palette picks the metal and strap.\nconst spec = dressWatchSpec({ hours: {{param.hours}}, minutes: {{param.minutes}}, seconds: {{param.seconds}} });\nconst watch = createObjectFromSpec(spec, { palette: hedronite.scene });\n// Later: disposeObject(watch) from @hedronite/lts-primitives.`,
      },
    ],
    build: async (params, palette) => {
      const { createObjectFromSpec } = await import("./fromSpec.js");
      return createObjectFromSpec(dressWatchSpec(params), withPalette(palette));
    },
  }),

  describe({ id: "crystal-cluster-glb", name: "Crystal cluster (glTF)", tags: ["gltf", "meshopt", "pipeline"], added: "2026-11-15" }, {
    parameters: z.object({
      /** Where the .glb is served from. The catalog passes the URL its bundler gives the file. */
      url: z.string().min(1).default("/models/crystal-cluster-glb.glb"),
    }),
    hints: { url: { label: "Model URL", group: "Source" } },
    templates: [
      {
        label: "TypeScript",
        code: `import { loadGltf } from "@hedronite/lts-objects/three";\n\n// Built by tools/assets: one draw call, meshopt-compressed, decoded by three's bundled decoder.\nconst scene = await loadGltf("/models/crystal-cluster-glb.glb");`,
      },
    ],
    build: async ({ url }, _palette, { signal }) => {
      const { loadGltf } = await import("./gltf.js");
      return loadGltf(url, signal === undefined ? {} : { signal });
    },
  }),

];

/** Every object: the ones defined in code, then each one stored as data. */
export const descriptors: readonly AssetDescriptor<ObjectBuilt, ScenePalette>[] = [...procedural, ...libraryObjects.map(stored)];
