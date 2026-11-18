import { defineDescriptor, type AssetDescriptor } from "@hedronite/lts-core";
import { z } from "zod";
import { primitive } from "./catalog.js";
import { manifest } from "./manifest.js";
import type { createPolyhedronGeometry } from "./three.js";

/** What `build` makes: a flat-shaded geometry the caller owns and must dispose. */
export type PrimitiveGeometry = ReturnType<typeof createPolyhedronGeometry>;

const parameters = z.object({
  /** Scales the solid about its centre. 1 is the size it ships at. */
  scale: z.number().min(0.25).max(4).default(1),
});

/** One descriptor per primitive in the manifest. Imports no three.js: `build` loads `./three` when it is called. */
export const descriptors: readonly AssetDescriptor<PrimitiveGeometry>[] = manifest.assets.map((asset) =>
  defineDescriptor({
    meta: { ...asset, package: manifest.package },
    parameters,
    hints: { scale: { label: "Size", group: "Shape", step: 0.05 } },
    templates: [
      {
        label: "TypeScript",
        code: `import { primitive } from "@hedronite/lts-primitives";\nimport { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";\nimport { Mesh, MeshStandardMaterial } from "three";\n\nconst geometry = createPolyhedronGeometry(primitive("{{id}}"));\n{{scaled}}const mesh = new Mesh(geometry, new MeshStandardMaterial());\n// Later: geometry.dispose();`,
      },
    ],
    vars: ({ scale }) => ({ scaled: scale === 1 ? "" : `geometry.scale(${String(scale)}, ${String(scale)}, ${String(scale)});\n` }),
    build: async ({ scale }) => {
      const { createPolyhedronGeometry } = await import("./three.js");
      const geometry = createPolyhedronGeometry(primitive(asset.id), asset.id);
      if (scale !== 1) geometry.scale(scale, scale, scale);
      return geometry;
    },
  }),
);
