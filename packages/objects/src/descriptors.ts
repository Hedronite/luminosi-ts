import { defineDescriptor, type AssetDescriptor, type BuildOptions, type ParameterHints, type SnippetTemplate } from "@hedronite/lts-core";
import { platonic, platonicSolids } from "@hedronite/lts-primitives";
import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { z } from "zod";
import { crystalCluster, latticePoints } from "./cluster.js";
import { libraryObjects, objectSpecById } from "./library.js";
import { manifest } from "./manifest.js";
import { showcase } from "./showcase.js";
import { dressWatchSpec } from "./specs/dressWatch.js";
import type { createCrystalCluster, createLattice, loadGltf } from "./three.js";

/** What `build` makes: the object, which the caller owns and frees with `disposeObject` from `@hedronite/lts-primitives/three`. */
export type ObjectBuilt = Awaited<ReturnType<typeof createCrystalCluster> | ReturnType<typeof createLattice> | ReturnType<typeof loadGltf>>;

/** The material builders, loaded when an object is built: objects draw on materials. */
const materials = () => import("@hedronite/lts-materials/three");

const withPalette = (palette: ScenePalette | undefined): { readonly palette?: ScenePalette } => (palette === undefined ? {} : { palette });

/** What is particular to one object: the rest of its descriptor comes from its manifest entry. */
interface Entry<Shape extends z.ZodRawShape> {
  readonly parameters: z.ZodObject<Shape>;
  readonly hints?: ParameterHints;
  readonly templates: readonly SnippetTemplate[];
  readonly vars?: (params: z.output<z.ZodObject<Shape>>) => Readonly<Record<string, string>>;
  readonly build: (params: z.output<z.ZodObject<Shape>>, palette: ScenePalette | undefined, options: BuildOptions) => Promise<ObjectBuilt>;
}

/** An object's descriptor, from its manifest entry (found by id) and what is particular to it. */
function describe<Shape extends z.ZodRawShape>(id: string, entry: Entry<Shape>): AssetDescriptor<ObjectBuilt, ScenePalette> {
  const asset = manifest.assets.find((candidate) => candidate.id === id);
  if (asset === undefined) throw new RangeError(`${id} has a descriptor but is not in the objects manifest`);
  return defineDescriptor({ meta: { ...asset, package: manifest.package }, ...entry });
}

/** An object stored as data (assets/src/objects): built from its spec, the palette picking the colors. */
const stored = (id: string) =>
  describe(id, {
    parameters: z.object({}),
    templates: [
      {
        label: "TypeScript",
        code: `import { objectSpecById } from "@hedronite/lts-objects";\nimport { createObjectFromSpec } from "@hedronite/lts-objects/three";\nimport { disposeObject } from "@hedronite/lts-primitives/three";\n\n// Stored as data in assets/src/objects; the palette picks the colors.\nconst spec = objectSpecById("{{id}}");\nif (spec !== undefined) {\n  const object = createObjectFromSpec(spec);\n  // Later: disposeObject(object);\n}`,
      },
    ],
    build: async (_params, palette) => {
      const { createObjectFromSpec } = await import("./three.js");
      const spec = objectSpecById(id);
      if (spec === undefined) throw new RangeError(`${id} is listed as an object stored as data but has no spec`);
      return createObjectFromSpec(spec, withPalette(palette));
    },
  });

/**
 * One descriptor per object in the manifest: the four procedural objects and the glTF model, each with its own
 * parameters, then every object stored as data (built from its spec). Imports no three.js: `build` loads `./three`
 * when it is called. The defaults are the catalog's showcase settings.
 */
export const descriptors: readonly AssetDescriptor<ObjectBuilt, ScenePalette>[] = [
  describe("crystal-cluster", {
    parameters: z.object({
      count: z.number().int().min(1).max(64).default(showcase.cluster.count),
      spread: z.number().min(0).max(1).default(showcase.cluster.spread),
      seed: z.number().int().default(showcase.cluster.seed),
    }),
    hints: { count: { label: "Crystals", group: "Shape" }, spread: { label: "Lean", group: "Shape", step: 0.05 }, seed: { label: "Seed", group: "Random" } },
    templates: [
      {
        label: "TypeScript",
        code: `import { createMaterial } from "@hedronite/lts-materials/three";\nimport { crystalCluster } from "@hedronite/lts-objects";\nimport { createCrystalCluster } from "@hedronite/lts-objects/three";\nimport { disposeObject } from "@hedronite/lts-primitives/three";\n\n// Same seed, same cluster.\nconst cluster = createCrystalCluster(crystalCluster({ count: {{param.count}}, spread: {{param.spread}}, seed: {{param.seed}} }), createMaterial("satin"));\n// Later: disposeObject(cluster);`,
      },
    ],
    build: async (params, palette) => {
      const [{ createCrystalCluster }, { createMaterial }] = await Promise.all([import("./three.js"), materials()]);
      return createCrystalCluster(crystalCluster(params), createMaterial("satin", palette));
    },
  }),

  describe("framed-solid", {
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
      const [{ createFramedSolid }, { createMaterial }] = await Promise.all([import("./three.js"), materials()]);
      // Glass faces with edges and beads in metal tinted by the look's accent: copper in the Hedronite look.
      const look = palette ?? neutral.scene;
      return createFramedSolid(platonic(solid, radius), { faces: createMaterial("glass", look), edges: createMaterial("metal", { ...look, metal: look.accent }) });
    },
  }),

  describe("instanced-lattice", {
    parameters: z.object({
      size: z.number().int().min(1).max(16).default(showcase.lattice.size),
      spacing: z.number().min(0.05).max(1).default(showcase.lattice.spacing),
      scale: z.number().min(0.01).max(0.3).default(showcase.lattice.scale),
    }),
    hints: { size: { label: "Points per side", group: "Shape" }, spacing: { label: "Spacing", group: "Shape", step: 0.01 }, scale: { label: "Point size", group: "Shape", step: 0.005 } },
    templates: [
      {
        label: "TypeScript",
        code: `import { createMaterial } from "@hedronite/lts-materials/three";\nimport { latticePoints } from "@hedronite/lts-objects";\nimport { createLattice } from "@hedronite/lts-objects/three";\n\n// {{points}} octahedra, one draw call.\nconst lattice = createLattice(latticePoints({ size: {{param.size}}, spacing: {{param.spacing}} }), createMaterial("metal"), { scale: {{param.scale}} });`,
      },
    ],
    vars: ({ size }) => ({ points: String(size ** 3) }),
    build: async ({ size, spacing, scale }, palette) => {
      const [{ createLattice }, { createMaterial }] = await Promise.all([import("./three.js"), materials()]);
      return createLattice(latticePoints({ size, spacing }), createMaterial("metal", palette), { scale });
    },
  }),

  describe("dress-watch", {
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
      const { createObjectFromSpec } = await import("./three.js");
      return createObjectFromSpec(dressWatchSpec(params), withPalette(palette));
    },
  }),

  describe("crystal-cluster-glb", {
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
      const { loadGltf } = await import("./three.js");
      return loadGltf(url, signal === undefined ? {} : { signal });
    },
  }),

  ...libraryObjects.map(({ id }) => stored(id)),
];
