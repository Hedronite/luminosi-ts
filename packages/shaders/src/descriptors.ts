import { defineDescriptor, type AssetDescriptor } from "@hedronite/lts-core";
import type { ScenePalette } from "@hedronite/lts-tokens";
import type { z } from "zod";
import { effectSchemas, type EffectId } from "./info.js";
import { manifest } from "./manifest.js";
import type { createEffectMaterial } from "./three.js";

/** What `build` makes: a TSL node material the caller owns and must dispose. */
export type ShaderMaterial = ReturnType<typeof createEffectMaterial>;

/** The material builder for each effect id: the one table that says which builder an id runs. Each parses its own parameters. */
async function creators(): Promise<Readonly<Record<EffectId, (params: unknown, palette: ScenePalette | undefined) => ShaderMaterial>>> {
  const three = await import("./three.js");
  return {
    dissolve: (params, palette) => three.createDissolveMaterial(effectSchemas.dissolve.parse(params), palette),
    "fresnel-glow": (params, palette) => three.createFresnelGlowMaterial(effectSchemas["fresnel-glow"].parse(params), palette),
    "height-gradient": (params, palette) => three.createHeightGradientMaterial(effectSchemas["height-gradient"].parse(params), palette),
    hologram: (params, palette) => three.createHologramMaterial(effectSchemas.hologram.parse(params), palette),
    pulse: (params, palette) => three.createPulseMaterial(effectSchemas.pulse.parse(params), palette),
    refraction: (params, palette) => three.createRefractionMaterial(effectSchemas.refraction.parse(params), palette),
    "soap-film": (params, palette) => three.createSoapFilmMaterial(effectSchemas["soap-film"].parse(params), palette),
    toon: (params, palette) => three.createToonMaterial(effectSchemas.toon.parse(params), palette),
  };
}

/** One descriptor per surface shader in the manifest, with that shader's own parameters. Imports no three.js: `build` loads `./three` when it is called. */
export const descriptors: readonly AssetDescriptor<ShaderMaterial, ScenePalette>[] = manifest.assets.map((asset) => {
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
      const create = (await creators())[asset.id];
      return create(params, palette);
    },
  });
});
