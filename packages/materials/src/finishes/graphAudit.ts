import type { FinishHandle } from "../finished.js";
import { finishSchemas } from "./info.js";

interface TslNode {
  isTextureNode?: boolean;
  isUniformNode?: boolean;
  isConstNode?: boolean;
  isVaryingNode?: boolean;
  nodeType?: string;
  property?: string;
  name?: string;
  method?: string;
}

const MAP_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "bumpMap",
  "displacementMap",
  "alphaMap",
  "lightMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "anisotropyMap",
  "iridescenceMap",
  "iridescenceThicknessMap",
  "sheenRoughnessMap",
  "specularColorMap",
  "specularIntensityMap",
  "transmissionMap",
  "thicknessMap",
  "emissiveMap",
  "envMap",
] as const;

function hasTraverse(value: unknown): value is { traverse: (callback: (node: unknown) => void) => void } {
  if (value === null || typeof value !== "object") return false;
  const traverse: unknown = Reflect.get(value, "traverse");
  return typeof traverse === "function";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function tslNodeFromUnknown(node: unknown): TslNode {
  if (node === null || typeof node !== "object") return {};
  const out: TslNode = {};
  if (Reflect.get(node, "isTextureNode") === true) out.isTextureNode = true;
  if (Reflect.get(node, "isUniformNode") === true) out.isUniformNode = true;
  if (Reflect.get(node, "isConstNode") === true) out.isConstNode = true;
  if (Reflect.get(node, "isVaryingNode") === true) out.isVaryingNode = true;
  const nodeType = readString(Reflect.get(node, "nodeType"));
  if (nodeType !== undefined) out.nodeType = nodeType;
  const property = readString(Reflect.get(node, "property"));
  if (property !== undefined) out.property = property;
  const name = readString(Reflect.get(node, "name"));
  if (name !== undefined) out.name = name;
  const method = readString(Reflect.get(node, "method"));
  if (method !== undefined) out.method = method;
  return out;
}

/** Every node in a TSL subtree. */
export function collectTslNodes(root: unknown): TslNode[] {
  if (!hasTraverse(root)) return [];
  const nodes: TslNode[] = [];
  root.traverse((node) => {
    nodes.push(tslNodeFromUnknown(node));
  });
  return nodes;
}

/** True when the node carries a sampled texture. */
export function isTextureInGraph(root: unknown): boolean {
  return collectTslNodes(root).some((node) => node.isTextureNode === true);
}

/** Procedural grounding: MaterialX noise, or position local/world accessors. */
function hasProceduralSource(root: unknown): boolean {
  return collectTslNodes(root).some((node) => {
    const type = node.nodeType ?? "";
    const property = node.property ?? "";
    const name = node.name ?? "";
    if (/noise|perlin|materialx/i.test(type) || /noise|perlin/i.test(name)) return true;
    if (/position(local|world|geometry)/i.test(property) || /position(local|world|geometry)/i.test(name)) return true;
    if (node.isVaryingNode === true && /position/i.test(`${property}${name}`)) return true;
    if (type === "VaryingNode" && /position/i.test(`${property}${name}`)) return true;
    if (type === "AttributeNode" && /position/i.test(`${property}${name}`)) return true;
    const method = node.method;
    if (typeof method === "string" && /^(sin|cos|abs|length|dot|normalize)$/i.test(method)) return true;
    return false;
  });
}

const OUTPUT_KEYS = ["roughnessNode", "normalNode", "anisotropyNode", "colorNode"] as const;

/** Wired finish outputs on the physical node material. */
export function finishOutputNodes(material: {
  readonly roughnessNode: unknown;
  readonly normalNode: unknown;
  readonly anisotropyNode: unknown;
  readonly colorNode: unknown;
}): unknown[] {
  return OUTPUT_KEYS.map((key) => material[key]).filter((node) => node !== null && node !== undefined);
}

export function assertNoTextureMaps(material: object): void {
  for (const key of MAP_SLOTS) {
    const value: unknown = Reflect.get(material, key);
    if (value !== null && value !== undefined) {
      throw new Error(`${key} must stay null on finished materials`);
    }
  }
}

const PARAM_KEYS = ["scale", "strength", "direction"] as const;

/** Finish parameter uniforms appear in the wired graph, not only on the handle. */
function graphContainsRef(root: unknown, target: unknown): boolean {
  if (target === root) return true;
  if (!hasTraverse(root)) return false;
  let found = false;
  root.traverse((node) => {
    if (node === target) found = true;
  });
  return found;
}

function uniformsReachGraph(handle: FinishHandle): boolean {
  const outputs = finishOutputNodes(handle.material);
  const shape = finishSchemas[handle.id].shape;
  for (const key of PARAM_KEYS) {
    if (!(key in shape)) continue;
    const uniform = handle.uniforms[key];
    if (uniform === undefined) return false;
    if (!outputs.some((output) => graphContainsRef(output, uniform))) return false;
  }
  return true;
}

export function auditFinishGraph(handle: FinishHandle): { procedural: boolean; uniforms: boolean; textures: boolean } {
  const outputs = finishOutputNodes(handle.material);
  const procedural = outputs.some((output) => hasProceduralSource(output));
  const textures = outputs.some((output) => isTextureInGraph(output));
  const uniforms = uniformsReachGraph(handle);
  return { procedural, uniforms, textures };
}