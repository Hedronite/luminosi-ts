import { defineDescriptor, type AssetDescriptor, type AssetPreviewData } from "@hedronite/lts-core";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { z } from "zod";
import { screenEffectSchemas } from "./effects.js";
import { manifest } from "./manifest.js";
import type { ScreenEffects } from "./three.js";

type Constructed = ConstructorParameters<typeof ScreenEffects>;

/**
 * What `build` makes: a function that puts this effect over a scene. A screen effect needs a renderer, a scene and a
 * camera, which a descriptor does not have, so `build` hands back the step that takes them. The caller owns the
 * `ScreenEffects` it returns and calls `dispose()`.
 */
export type ScreenEffectPass = (renderer: Constructed[0], scene: Constructed[1], camera: Constructed[2], options?: Constructed[4]) => ScreenEffects;

/** One effect and its parameters as the stack takes them, checked against that effect's own schema. */
const stackEntry = z.discriminatedUnion("id", [
  z.object({ id: z.literal("dither"), params: screenEffectSchemas.dither }),
  z.object({ id: z.literal("ascii"), params: screenEffectSchemas.ascii }),
  z.object({ id: z.literal("grain"), params: screenEffectSchemas.grain }),
  z.object({ id: z.literal("scan"), params: screenEffectSchemas.scan }),
  z.object({ id: z.literal("lens"), params: screenEffectSchemas.lens }),
  z.object({ id: z.literal("crystallize"), params: screenEffectSchemas.crystallize }),
  z.object({ id: z.literal("smoke"), params: screenEffectSchemas.smoke }),
  z.object({ id: z.literal("crt"), params: screenEffectSchemas.crt }),
]);

/**
 * How a stage puts each effect on show, where the defaults would not show it: the scan sweeps every few seconds instead
 * of every nine, so it comes round while someone looks. Not exhaustive on purpose: an effect with no line here is shown
 * with its defaults, so adding an effect takes only its own definition.
 */
const previews: { readonly [Id in keyof typeof screenEffectSchemas]?: AssetPreviewData } = {
  scan: { stage: { period: 4 } },
};

/** One descriptor per screen effect in the manifest, with that effect's own parameters. Imports no three.js: `build` loads `./three` when it is called. */
export const descriptors: readonly AssetDescriptor<ScreenEffectPass, ScenePalette>[] = manifest.assets.map((asset) => {
  const parameters: z.ZodObject = screenEffectSchemas[asset.id];
  const preview = previews[asset.id];
  return defineDescriptor({
    meta: { ...asset, package: manifest.package },
    parameters,
    ...(preview === undefined ? {} : { preview }),
    templates: [
      {
        label: "TypeScript",
        code: `import { ScreenEffects } from "@hedronite/lts-postfx/three";\nimport { hedronite } from "@hedronite/lts-tokens";\nimport { WebGPURenderer } from "three/webgpu";\n\nconst renderer = new WebGPURenderer({ antialias: true, alpha: true });\nawait renderer.init();\n// Inks from the look: lapis and copper with the Hedronite preset.\nconst effects = new ScreenEffects(renderer, scene, camera, [{ id: "{{id}}" }], { palette: hedronite.scene });\n// Each frame, instead of renderer.render(scene, camera):\neffects.render(delta);\n// Later: effects.dispose();`,
      },
      {
        label: "React",
        code: `import { ScreenEffectsPass, WebGPUCanvas } from "@hedronite/lts-adapters/webgpu";\n\nconst stack = [{ id: "{{id}}" }] as const; // keep it stable: a new array rebuilds the passes\n\n// The WebGPU renderer (WebGL 2 where WebGPU is missing) runs screen effects and surface shaders together.\n<WebGPUCanvas>\n  {/* your scene */}\n  <ScreenEffectsPass effects={stack} />\n</WebGPUCanvas>`,
      },
    ],
    build: async (params, palette: ScenePalette | undefined) => {
      const three = await import("./three.js");
      const stack = [stackEntry.parse({ id: asset.id, params })];
      return (renderer, scene, camera, options) => new three.ScreenEffects(renderer, scene, camera, stack, { ...(palette === undefined ? {} : { palette }), ...options });
    },
  });
});
