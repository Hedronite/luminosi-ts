import { type MaterialId } from "@hedronite/lts-materials";
import { createMaterial } from "@hedronite/lts-materials/three";
import { type EffectId } from "@hedronite/lts-shaders";
import { crystalCluster, latticePoints, type ClusterOptions, type LatticeOptions } from "@hedronite/lts-objects";
import { createCrystalCluster, createLattice } from "@hedronite/lts-objects/three";
import { primitive, type PrimitiveId } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry, createStudioLights, disposeObject } from "@hedronite/lts-primitives/three";
import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { useThree, type ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { useEffectMaterial, type ShaderParams } from "./effectMaterial.js";
import { PMREMGenerator, type WebGLRenderer } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

type GroupProps = Omit<ThreeElements["group"], "args" | "children" | "ref" | "object">;

export interface PrimitiveMeshProps extends Omit<ThreeElements["mesh"], "args" | "children" | "geometry" | "material" | "ref" | "id"> {
  readonly primitive: PrimitiveId;
  /** Material preset. Default "satin". */
  readonly material?: MaterialId;
  /** A surface shader instead of a material preset. Needs the WebGPU renderer (`WebGPUCanvas` from `@hedronite/lts-adapters/webgpu`). The shader loads on demand: nothing draws until it is ready. */
  readonly shader?: EffectId;
  /** The shader's parameters, by name. A change moves the shader live, with no new material (a structural one, such as toon's `bands`, builds it again). Ignored without `shader`. */
  readonly shaderParams?: ShaderParams;
  /** Scene colors. Default: the neutral token preset. */
  readonly palette?: ScenePalette;
}

/** A primitive with a preset material. Owns both, and frees them when they change or it unmounts. */
export function PrimitiveMesh({ primitive: id, material = "satin", shader, shaderParams, palette = neutral.scene, ...props }: PrimitiveMeshProps) {
  const geometry = useMemo(() => createPolyhedronGeometry(primitive(id), id), [id]);
  const preset = useMemo(() => (shader === undefined ? createMaterial(material, palette) : undefined), [material, shader, palette]);
  const effect = useEffectMaterial(shader, palette, shaderParams);
  const surface = shader === undefined ? preset : effect;
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  useEffect(
    () => () => {
      preset?.dispose();
    },
    [preset],
  );
  return surface === undefined ? null : <mesh geometry={geometry} material={surface} dispose={null} {...props} />;
}

/** A prefiltered studio room, from WebGL's PMREM generator. */
function studioTexture(gl: WebGLRenderer) {
  const room = new RoomEnvironment();
  const pmrem = new PMREMGenerator(gl);
  const target = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  return target;
}

/**
 * A procedural studio room as the scene's environment, for reflections on metal, glass and glossy
 * surfaces. Nothing is fetched. Freed on unmount. For the WebGPU renderer (`WebGPUCanvas`) use
 * `WebGPUStudioEnvironment` from `@hedronite/lts-adapters/webgpu`.
 */
export function StudioEnvironment() {
  const gl = useThree((state) => state.gl);
  // A property check, not an instanceof: this entry must not import three's WebGPU build.
  if ("isWebGPURenderer" in gl) throw new Error("StudioEnvironment runs on the WebGL renderer: inside <WebGPUCanvas> use WebGPUStudioEnvironment from @hedronite/lts-adapters/webgpu");
  const target = useMemo(() => studioTexture(gl), [gl]);
  useEffect(
    () => () => {
      target.dispose();
    },
    [target],
  );
  return <primitive object={target.texture} attach="environment" />;
}

/** The library's three-point studio rig. */
export function StudioLights({ intensity = 1 }: { readonly intensity?: number }) {
  const rig = useMemo(() => createStudioLights({ intensity }), [intensity]);
  return <primitive object={rig} />;
}

export interface CrystalClusterProps extends Omit<GroupProps, keyof ClusterOptions>, ClusterOptions {
  readonly material?: MaterialId;
  readonly palette?: ScenePalette;
}

/** A seeded crystal cluster. Owns its geometries and material. */
export function CrystalCluster({ count, spread, seed, material = "satin", palette = neutral.scene, ...props }: CrystalClusterProps) {
  const group = useMemo(() => {
    const options: ClusterOptions = { ...(count === undefined ? {} : { count }), ...(spread === undefined ? {} : { spread }), ...(seed === undefined ? {} : { seed }) };
    return createCrystalCluster(crystalCluster(options), createMaterial(material, palette));
  }, [count, spread, seed, material, palette]);
  useEffect(
    () => () => {
      disposeObject(group);
    },
    [group],
  );
  return <primitive object={group} {...props} />;
}

export interface LatticeProps extends Omit<GroupProps, keyof LatticeOptions>, LatticeOptions {
  /** Size of each node. Default 0.08. */
  readonly nodeScale?: number;
  readonly material?: MaterialId;
  readonly palette?: ScenePalette;
}

/** A lattice of octahedra drawn with one instanced mesh. Owns its geometry and material. */
export function Lattice({ size, spacing, nodeScale = 0.08, material = "metal", palette = neutral.scene, ...props }: LatticeProps) {
  const mesh = useMemo(() => {
    const options: LatticeOptions = { ...(size === undefined ? {} : { size }), ...(spacing === undefined ? {} : { spacing }) };
    return createLattice(latticePoints(options), createMaterial(material, palette), { scale: nodeScale });
  }, [size, spacing, nodeScale, material, palette]);
  useEffect(
    () => () => {
      disposeObject(mesh);
    },
    [mesh],
  );
  return <primitive object={mesh} {...props} />;
}
