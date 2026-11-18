import { defineDescriptor, type AssetDescriptor } from "@hedronite/lts-core";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { z } from "zod";
import { manifest } from "./manifest.js";
import type { createMaterial } from "./three.js";

/** What `build` makes: a physical material the caller owns and must dispose. */
export type MaterialObject = ReturnType<typeof createMaterial>;

/** Every material is set by its preset and the palette; it has no parameter of its own yet. */
const parameters = z.object({});

/** One descriptor per material preset in the manifest. Imports no three.js: `build` loads `./three` when it is called. */
export const descriptors: readonly AssetDescriptor<MaterialObject, ScenePalette>[] = manifest.assets.map((asset) =>
  defineDescriptor({
    meta: { ...asset, package: manifest.package },
    parameters,
    templates: [
      {
        label: "TypeScript",
        code: `import { createMaterial } from "@hedronite/lts-materials/three";\nimport { hedronite } from "@hedronite/lts-tokens";\n\nconst material = createMaterial("{{id}}"); // neutral colors\nconst branded = createMaterial("{{id}}", hedronite.scene);\n// Later: material.dispose();`,
      },
    ],
    build: async (_params, palette: ScenePalette | undefined) => {
      const { createMaterial } = await import("./three.js");
      return createMaterial(asset.id, palette);
    },
  }),
);
