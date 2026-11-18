import type { Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export interface GltfOptions {
  readonly signal?: AbortSignal;
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/**
 * Loads a glTF binary (a URL, or bytes already in hand) into a group.
 * Meshopt-compressed geometry decodes with the decoder bundled in three, so nothing is fetched from a CDN.
 */
export async function loadGltf(source: string | ArrayBuffer, { signal }: GltfOptions = {}): Promise<Object3D> {
  const bytes = typeof source === "string" ? await (await fetch(source, signal === undefined ? {} : { signal })).arrayBuffer() : source;
  signal?.throwIfAborted();
  const gltf = await loader.parseAsync(bytes, "");
  return gltf.scene;
}
