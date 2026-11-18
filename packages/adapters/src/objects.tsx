import { materialPreset, type MaterialId } from "@hedronite/lts-materials";
import { createMaterial } from "@hedronite/lts-materials/three";
import { type EffectId } from "@hedronite/lts-shaders";
import { createFramedSolid } from "@hedronite/lts-objects/three";
import { primitive, type PrimitiveId } from "@hedronite/lts-primitives";
import { disposeObject } from "@hedronite/lts-primitives/three";
import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import type { ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import type { Object3D } from "three";
import { useEffectMaterial } from "./effectMaterial.js";

type GroupProps = Omit<ThreeElements["group"], "args" | "children" | "ref" | "object">;

export interface FramedSolidProps extends GroupProps {
  readonly primitive: PrimitiveId;
  /** The faces' material. Default "glass". */
  readonly faces?: MaterialId;
  /** A surface shader for the faces instead of a material preset. Needs the WebGPU renderer (`WebGPUCanvas` from `@hedronite/lts-adapters/webgpu`). The shader loads on demand: nothing draws until it is ready. */
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
  const effect = useEffectMaterial(shader, palette);
  const surface = useMemo(() => (shader === undefined ? createMaterial(faces, palette) : effect), [shader, faces, palette, effect]);
  const object = useMemo(
    () => (surface === undefined ? undefined : createFramedSolid(primitive(id), { faces: surface, edges: createMaterial(edges, accentPalette(palette, edges)) })),
    [id, surface, edges, palette],
  );
  useEffect(
    () => () => {
      if (object !== undefined) disposeObject(object);
    },
    [object],
  );
  return <group {...props}>{object === undefined ? null : <primitive object={object} dispose={null} />}</group>;
}

export interface LibraryObjectProps extends GroupProps {
  /** The id of an object in the library, such as "dress-watch" or "your-desk-lamp". */
  readonly object: string;
  /** The object's parameters, as its descriptor takes them (the watch's `hours`, `minutes` and `seconds`, a cluster's `count`). A missing one takes its default. */
  readonly params?: Readonly<Record<string, unknown>>;
  readonly palette?: ScenePalette;
}

/** Every object's descriptor, loaded once on first use, so a page that draws no library object never loads them. */
let descriptors: Promise<ReadonlyMap<string, { readonly build: (params: unknown, palette: ScenePalette, options: { readonly signal: AbortSignal }) => Promise<Object3D> }>> | undefined;
const objectDescriptors = () => {
  descriptors ??= import("@hedronite/lts-objects/descriptors").then((module) => new Map(module.descriptors.map((descriptor) => [descriptor.meta.id, descriptor])));
  return descriptors;
};

/**
 * An object from the library, built by its descriptor. It draws nothing until the build lands, keeps the previous
 * object on screen while a new one builds, and frees what it built. Renders nothing for an unknown id.
 */
export function LibraryObject({ object: id, params, palette = neutral.scene, ...props }: LibraryObjectProps) {
  const [object, setObject] = useState<Object3D | undefined>(undefined);
  // The parameters as text, so a new object literal with the same values does not rebuild.
  const key = JSON.stringify(params ?? {});
  useEffect(() => {
    const controller = new AbortController();
    objectDescriptors()
      .then((found) => found.get(id)?.build(JSON.parse(key), palette, { signal: controller.signal }))
      .then(
        (built) => {
          if (built === undefined) return;
          if (controller.signal.aborted) disposeObject(built);
          else setObject(built);
        },
        (error: unknown) => {
          if (!controller.signal.aborted) console.error(`could not build ${id}`, error);
        },
      );
    return () => {
      controller.abort();
    };
  }, [id, key, palette]);
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
