import { defineDescriptor, type AssetDescriptor } from "@hedronite/lts-core";
import type { ScenePalette } from "@hedronite/lts-tokens";
import type { z } from "zod";
import { effectSchemas } from "./info.js";
import { manifest } from "./manifest.js";
import type { createEffect } from "./three.js";

/** What `build` makes: the shader's handle. Its `material` is the TSL node material, `set` moves its parameters live, and the caller calls `dispose`. */
export type ShaderEffect = ReturnType<typeof createEffect>;

/** One descriptor per surface shader in the manifest, with that shader's own parameters. Imports no three.js: `build` loads `./three` when it is called. */
export const descriptors: readonly AssetDescriptor<ShaderEffect, ScenePalette>[] = manifest.assets.map((asset) => {
  const parameters: z.ZodObject = effectSchemas[asset.id];
  return defineDescriptor({
    meta: { ...asset, package: manifest.package },
    parameters,
    templates: [
      {
        label: "TypeScript",
        code: `import { createEffectMaterial } from "@hedronite/lts-shaders/three";\nimport { WebGPURenderer } from "three/webgpu";\n\n// TSL materials need WebGPURenderer; it falls back to WebGL 2 where WebGPU is missing.\nconst renderer = new WebGPURenderer({ antialias: true });\nawait renderer.init();\nconst material = createEffectMaterial("{{id}}");`,
      },
    ],
    build: async (params, palette: ScenePalette | undefined) => {
      const three = await import("./three.js");
      return three.createEffect(asset.id, params, palette);
    },
  });
});
