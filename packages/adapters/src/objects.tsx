import { createMaterial, materialPreset, type MaterialId } from "@hedronite/lts-materials";
import { createEffectMaterial, type EffectId } from "@hedronite/lts-shaders";
import { createFramedSolid, createObjectFromSpec, dressWatchSpec, objectSpecById, type WatchTime } from "@hedronite/lts-objects";
import { disposeObject, primitive, type PrimitiveId } from "@hedronite/lts-primitives";
import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import type { ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { Object3D } from "three";

type GroupProps = Omit<ThreeElements["group"], "args" | "children" | "ref" | "object">;

export interface FramedSolidProps extends GroupProps {
  readonly primitive: PrimitiveId;
  /** The faces' material. Default "glass". */
  readonly faces?: MaterialId;
  /** A surface shader for the faces instead of a material preset. Needs the WebGPU renderer (`WebGPUCanvas`). */
  readonly shader?: EffectId;
  /** The edges' material, tinted with the scene's accent color. Default "metal" (copper in the Hedronite look). */
  readonly edges?: MaterialId;
  readonly palette?: ScenePalette;
}

/** The scene colors with `material`'s own color slot replaced by the accent, so it takes the accent. */
export function accentPalette(palette: ScenePalette, material: MaterialId): ScenePalette {
  return { ...palette, [materialPreset(material).color]: palette.accent };
}

/** A framed solid (faces, edge tubes, vertex beads), as on hedronite.com. Owns and frees what it builds. */
export function FramedSolid({ primitive: id, faces = "glass", shader, edges = "metal", palette = neutral.scene, ...props }: FramedSolidProps) {
  const object = useMemo(
    () =>
      createFramedSolid(primitive(id), {
        faces: shader === undefined ? createMaterial(faces, palette) : createEffectMaterial(shader, palette),
        edges: createMaterial(edges, accentPalette(palette, edges)),
      }),
    [id, faces, shader, edges, palette],
  );
  useEffect(
    () => () => {
      disposeObject(object);
    },
    [object],
  );
  return (
    <group {...props}>
      <primitive object={object} dispose={null} />
    </group>
  );
}

export interface LibraryObjectProps extends GroupProps {
  /** "dress-watch", or the id of an object stored as data (such as "your-desk-lamp"). */
  readonly object: string;
  /** The watch's time. Default 10:09:36. */
  readonly time?: WatchTime;
  readonly palette?: ScenePalette;
}

const tenPastTen: WatchTime = { hours: 10, minutes: 9, seconds: 36 };

/** An ObjectSpec object from the library, built from its spec. Renders nothing for an unknown id. */
export function LibraryObject({ object: id, time = tenPastTen, palette = neutral.scene, ...props }: LibraryObjectProps) {
  const object = useMemo((): Object3D | undefined => {
    const spec = id === "dress-watch" ? dressWatchSpec(time) : objectSpecById(id);
    return spec === undefined ? undefined : createObjectFromSpec(spec, { palette });
  }, [id, time, palette]);
  useEffect(
    () => () => {
      if (object !== undefined) disposeObject(object);
    },
    [object],
  );
  return object === undefined ? null : (
    <group {...props}>
      <primitive object={object} dispose={null} />
    </group>
  );
}
