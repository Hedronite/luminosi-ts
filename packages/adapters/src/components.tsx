import { createMaterial, type MaterialId } from "@hedronite/lts-materials";
import { createEffectMaterial, type EffectId } from "@hedronite/lts-shaders";
import { createCrystalCluster, createLattice, crystalCluster, latticePoints, type ClusterOptions, type LatticeOptions } from "@hedronite/lts-objects";
import { createPolyhedronGeometry, createStudioLights, disposeObject, primitive, type PrimitiveId } from "@hedronite/lts-primitives";
import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { useThree, type ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { PMREMGenerator, type Material, type WebGLRenderer } from "three";
import { PMREMGenerator as NodePMREMGenerator, WebGPURenderer } from "three/webgpu";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

type GroupProps = Omit<ThreeElements["group"], "args" | "children" | "ref" | "object">;

export interface PrimitiveMeshProps extends Omit<ThreeElements["mesh"], "args" | "children" | "geometry" | "material" | "ref" | "id"> {
  readonly primitive: PrimitiveId;
  /** Material preset. Default "satin". */
  readonly material?: MaterialId;
  /** A surface shader instead of a material preset. Needs the WebGPU renderer (`WebGPUCanvas`). */
  readonly shader?: EffectId;
  /** Scene colors. Default: the neutral token preset. */
  readonly palette?: ScenePalette;
}

/** A primitive with a preset material. Owns both, and frees them when they change or it unmounts. */
export function PrimitiveMesh({ primitive: id, material = "satin", shader, palette = neutral.scene, ...props }: PrimitiveMeshProps) {
  const geometry = useMemo(() => createPolyhedronGeometry(primitive(id), id), [id]);
  const surface = useMemo((): Material => (shader === undefined ? createMaterial(material, palette) : createEffectMaterial(shader, palette)), [material, shader, palette]);
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  useEffect(
    () => () => {
      surface.dispose();
    },
    [surface],
  );
  return <mesh geometry={geometry} material={surface} dispose={null} {...props} />;
}

/** A prefiltered environment for either renderer: WebGL's PMREM generator, or the WebGPU renderer's own. */
function studioTexture(gl: WebGLRenderer | WebGPURenderer) {
  const room = new RoomEnvironment();
  const pmrem = gl instanceof WebGPURenderer ? new NodePMREMGenerator(gl) : new PMREMGenerator(gl);
  const target = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  return target;
}

/**
 * A procedural studio room as the scene's environment, for reflections on metal, glass and glossy
 * surfaces. Nothing is fetched. Works on the WebGL and the WebGPU renderer. Freed on unmount.
 */
export function StudioEnvironment() {
  // Inside WebGPUCanvas the renderer React Three Fiber hands over is a WebGPURenderer.
  const gl: WebGLRenderer | WebGPURenderer = useThree((state) => state.gl);
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
