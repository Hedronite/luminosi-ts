import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import type { Object3D } from "three";

const noteUuid = (value: unknown, seen: Set<string>): void => {
  if (typeof value === "object" && value !== null && "uuid" in value && typeof value.uuid === "string") seen.add(value.uuid);
};

/**
 * Adds to `seen` the `uuid` of every drawable object under `root` (anything that carries a material), of its geometry and of every
 * material it holds. It reads the scene graph and nothing else: no name, no kind of material. A new mesh, a swapped material and a
 * swapped geometry each add one.
 */
function noteBuilds(root: Object3D, seen: Set<string>): void {
  root.traverse((object) => {
    if (!("material" in object)) return;
    seen.add(object.uuid);
    if ("geometry" in object) noteUuid(object.geometry, seen);
    const held: unknown = object.material;
    const materials: readonly unknown[] = Array.isArray(held) ? held : [held];
    for (const material of materials) noteUuid(material, seen);
  });
}

/** The uuids the island has ever attached. It lives outside React, so an island that is mounted again keeps counting where it was, and it never goes down. */
const seen = new Set<string>();

/** What the renderer itself reports it holds, from `info.memory`. The WebGL renderer counts no render targets, so those read 0 there. */
function memoryOf(gl: object): { readonly geometries: number; readonly textures: number; readonly targets: number } {
  const info: unknown = "info" in gl ? gl.info : undefined;
  const memory: unknown = typeof info === "object" && info !== null && "memory" in info ? info.memory : undefined;
  const count = (key: string): number => {
    const value: unknown = typeof memory === "object" && memory !== null && key in memory ? Reflect.get(memory, key) : undefined;
    return typeof value === "number" ? value : 0;
  };
  return { geometries: count("geometries"), textures: count("textures"), targets: count("renderTargets") };
}

/**
 * Writes the island's rendered frame count, its builds (how many distinct meshes, geometries and materials it has ever attached, by
 * `uuid`, never counting one twice and never going down: a remount raises it, a recolor leaves it) and the renderer's own memory
 * counts onto `target`, for tests. Use it inside the island's Canvas.
 */
export function IslandCounts({ target }: { readonly target: RefObject<HTMLDivElement | null> }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    // A frame follows every commit that attaches something, so an object that lives for one commit is still seen.
    noteBuilds(scene, seen);
  });
  useEffect(() => {
    const timer = setInterval(() => {
      const element = target.current;
      if (element === null) return;
      noteBuilds(scene, seen);
      const memory = memoryOf(gl);
      element.dataset["frames"] = String(frames.current);
      element.dataset["builds"] = String(seen.size);
      element.dataset["geometries"] = String(memory.geometries);
      element.dataset["textures"] = String(memory.textures);
      element.dataset["targets"] = String(memory.targets);
    }, 150);
    return () => {
      clearInterval(timer);
    };
  }, [gl, scene, target]);
  return null;
}
