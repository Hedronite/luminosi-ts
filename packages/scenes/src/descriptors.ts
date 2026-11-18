import { defineDescriptor, type AssetDescriptor } from "@hedronite/lts-core";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { z } from "zod";
import { isSceneKitId } from "./kits.js";
import { manifest } from "./manifest.js";
import type { createSceneKit } from "./three.js";

/** What `build` makes: a group of lights and shapes the caller owns and frees with `disposeObject`. */
export type SceneKitGroup = ReturnType<typeof createSceneKit>;

/** A kit is set by its lights and placements and the palette; it has no parameter of its own yet. */
const parameters = z.object({});

/** One descriptor per scene kit in the manifest (ids are `scene-<kit>`). Imports no three.js: `build` loads `./three` when it is called. */
export const descriptors: readonly AssetDescriptor<SceneKitGroup, ScenePalette>[] = manifest.assets.map((asset) => {
  const kit = asset.id.replace(/^scene-/, "");
  if (!isSceneKitId(kit)) throw new RangeError(`${asset.id} is in the manifest but is not a scene kit`);
  return defineDescriptor({
    meta: { ...asset, package: manifest.package },
    parameters,
    templates: [
      {
        label: "TypeScript",
        code: `import { disposeObject } from "@hedronite/lts-primitives/three";\nimport { createSceneKit } from "@hedronite/lts-scenes/three";\n\n// Lights and shapes in one group; use it instead of other lights.\nconst kit = createSceneKit("{{kit}}");\nscene.add(kit);\n// Later: disposeObject(kit);`,
      },
    ],
    vars: () => ({ kit }),
    build: async (_params, palette: ScenePalette | undefined) => {
      const { createSceneKit } = await import("./three.js");
      return createSceneKit(kit, palette);
    },
  });
});
