import { neutral, type SceneColorKey, type ScenePalette } from "@hedronite/lts-tokens";
import { Color, Mesh, Object3D, type Material } from "three";
import { float, normalView, uniform } from "three/tsl";
import { MeshPhysicalNodeMaterial, type NodeMaterial } from "three/webgpu";
import { z } from "zod";
import { buildFinishGraph, type FinishGraph } from "./finishes/graphs.js";
import { finishSchemas, isFinishId, type FinishId, type FinishParams } from "./finishes/info.js";
import { materialPreset, type MaterialId, type MaterialPreset } from "./presets.js";
import type { PaletteDerive } from "./three.js";

type FloatUniform = ReturnType<typeof uniform<"float">>;
type ColorUniform = ReturnType<typeof uniform<"color">>;

interface FinishRecord {
  readonly preset: MaterialPreset;
  readonly presetId: MaterialId;
  readonly finishId: FinishId;
  readonly derive: PaletteDerive | undefined;
  readonly colors: Readonly<Record<string, ColorUniform>>;
  readonly roles: Readonly<Record<string, SceneColorKey>>;
}

const finished = new WeakMap<MeshPhysicalNodeMaterial, FinishRecord>();

/**
 * A preset wearing a procedural finish: uniforms hold live params, and `material` is a node physical material.
 */
export interface FinishHandle<Id extends FinishId = FinishId> {
  readonly id: Id;
  readonly presetId: MaterialId;
  readonly material: MeshPhysicalNodeMaterial;
  readonly uniforms: Readonly<Record<string, FloatUniform | ColorUniform>>;
  /** Only `presetId` and `finishId` need a new material; other params update live uniforms via `set()`. */
  readonly structural: readonly string[];
  set(partial: FinishParams<Id>): boolean;
  dispose(): void;
}

function paletteRoles(preset: MaterialPreset): Record<string, SceneColorKey> {
  const roles: Record<string, SceneColorKey> = { color: preset.color };
  if (preset.attenuationDistance !== undefined) roles.attenuation = preset.color;
  if (preset.emissiveIntensity !== undefined) roles.emissive = preset.color;
  if (preset.sheen !== undefined) roles.sheen = preset.sheenColor ?? preset.color;
  return roles;
}

function paintUniforms(
  material: MeshPhysicalNodeMaterial,
  colors: Record<string, ColorUniform>,
  roles: Record<string, SceneColorKey>,
  preset: MaterialPreset,
  scene: ScenePalette,
): void {
  const color = colors.color;
  if (color !== undefined) color.value.set(scene[preset.color]);
  if (roles.attenuation !== undefined) colors.attenuation?.value.set(scene[roles.attenuation]);
  if (roles.emissive !== undefined) colors.emissive?.value.set(scene[roles.emissive]);
  if (preset.sheen !== undefined) material.sheenColor.set(scene[roles.sheen ?? preset.color]);
}

function configurePreset(material: MeshPhysicalNodeMaterial, preset: MaterialPreset): void {
  material.roughness = preset.roughness;
  material.metalness = preset.metalness;
  material.clearcoat = preset.clearcoat ?? 0;
  material.clearcoatRoughness = preset.clearcoatRoughness ?? 0;
  material.transmission = preset.transmission ?? 0;
  material.ior = preset.ior ?? 1.5;
  material.thickness = preset.thickness ?? 0;
  if (preset.attenuationDistance !== undefined) material.attenuationDistance = preset.attenuationDistance;
  if (preset.emissiveIntensity !== undefined) material.emissiveIntensity = preset.emissiveIntensity;
  if (preset.sheen !== undefined) {
    material.sheen = preset.sheen;
    material.sheenRoughness = preset.sheenRoughness ?? 1;
  }
  if (preset.iridescence !== undefined) {
    material.iridescence = preset.iridescence;
    material.iridescenceIOR = preset.iridescenceIOR ?? 1.3;
    const [thinnest, thickest] = preset.iridescenceThicknessRange ?? [100, 400];
    material.iridescenceThicknessMinimum = thinnest;
    material.iridescenceThicknessMaximum = thickest;
  }
  if (preset.specularIntensity !== undefined) material.specularIntensity = preset.specularIntensity;
}

function wireFinishGraph(material: MeshPhysicalNodeMaterial, graph: FinishGraph, baseColor: ColorUniform): void {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- TSL finish nodes are valid material slots but wider than the declared types
  material.colorNode = (graph.colorNode ?? baseColor) as MeshPhysicalNodeMaterial["colorNode"];
  if (graph.roughnessNode !== undefined) {
    material.roughness = 1;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- procedural roughness node from the finish graph
    material.roughnessNode = graph.roughnessNode as MeshPhysicalNodeMaterial["roughnessNode"];
  }
  if (graph.normalNode !== undefined) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- procedural normal node from the finish graph
    material.normalNode = graph.normalNode as MeshPhysicalNodeMaterial["normalNode"];
  }
  if (graph.anisotropyNode !== undefined) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brushed finish anisotropy direction node
    material.anisotropyNode = graph.anisotropyNode as MeshPhysicalNodeMaterial["anisotropyNode"];
  }
}

/**
 * Node physical material for a preset: same scalars and palette uniforms as a finish, but no procedural graph wired.
 * Used to compare finishes against the shared node baseline (not classic `MeshPhysicalMaterial`).
 */
export function createPresetNodeMaterial(
  presetId: MaterialId,
  palette: ScenePalette = neutral.scene,
  derive?: PaletteDerive,
): MeshPhysicalNodeMaterial {
  const preset = materialPreset(presetId);
  const scene = derive === undefined ? palette : derive(palette);
  const roles = paletteRoles(preset);
  const colors: Record<string, ColorUniform> = {
    color: uniform(new Color(scene[preset.color])),
  };
  if (roles.attenuation !== undefined) colors.attenuation = uniform(new Color(scene[roles.attenuation]));
  if (roles.emissive !== undefined) colors.emissive = uniform(new Color(scene[roles.emissive]));

  const material = new MeshPhysicalNodeMaterial({ name: `${presetId}:base` });
  configurePreset(material, preset);
  const baseColor = colors.color;
  if (baseColor === undefined) throw new Error("color uniform missing");
  // Wire order: preset scalars → palette uniforms → finish slots (when present); first compile must see the final nodes.
  material.colorNode = baseColor;
  material.roughnessNode = float(preset.roughness);
  material.normalNode = normalView;
  material.roughness = 1;
  if (colors.emissive !== undefined) material.emissiveNode = colors.emissive;
  if (colors.attenuation !== undefined) material.attenuationColorNode = colors.attenuation;
  if (preset.sheen !== undefined) material.sheenColor.set(scene[roles.sheen ?? preset.color]);
  return material;
}

/**
 * Builds a finished material: preset scalars are fixed, palette colors follow the look through uniforms, finish params are live uniforms.
 */
export function createFinishedMaterial<Id extends FinishId>(
  presetId: MaterialId,
  finishId: Id,
  params?: FinishParams<Id>,
  palette: ScenePalette = neutral.scene,
  derive?: PaletteDerive,
): FinishHandle<Id> {
  if (!isFinishId(finishId)) throw new RangeError(`unknown finish "${String(finishId)}"`);
  const preset = materialPreset(presetId);
  const scene = derive === undefined ? palette : derive(palette);
  finishSchemas[finishId].parse(params ?? {});
  const roles = paletteRoles(preset);
  const colors: Record<string, ColorUniform> = {
    color: uniform(new Color(scene[preset.color])),
  };
  if (roles.attenuation !== undefined) colors.attenuation = uniform(new Color(scene[roles.attenuation]));
  if (roles.emissive !== undefined) colors.emissive = uniform(new Color(scene[roles.emissive]));

  const material = new MeshPhysicalNodeMaterial({ name: `${presetId}:${finishId}` });
  configurePreset(material, preset);
  const baseColor = colors.color;
  if (baseColor === undefined) throw new Error("color uniform missing");
  const parsedParams = finishSchemas[finishId].parse(params ?? {});
  const graph = buildFinishGraph(finishId, params ?? {}, preset.roughness, baseColor);

  if (parsedParams.strength === 0) {
    material.colorNode = baseColor;
    material.roughnessNode = float(preset.roughness);
    material.normalNode = normalView;
    material.roughness = 1;
  } else {
    wireFinishGraph(material, graph, baseColor);
  }

  if (colors.emissive !== undefined) material.emissiveNode = colors.emissive;
  if (colors.attenuation !== undefined) material.attenuationColorNode = colors.attenuation;
  if (preset.sheen !== undefined) material.sheenColor.set(scene[roles.sheen ?? preset.color]);

  const uniforms: Record<string, FloatUniform | ColorUniform> = {
    scale: graph.bindings.scale,
    strength: graph.bindings.strength,
    ...colors,
  };
  if (graph.bindings.direction !== undefined) uniforms.direction = graph.bindings.direction;

  const shape: Readonly<Record<string, z.ZodType>> = finishSchemas[finishId].shape;
  const handle: FinishHandle<Id> = {
    id: finishId,
    presetId,
    material,
    uniforms,
    structural: ["presetId", "finishId"],
    set: (partial) => {
      for (const [key, raw] of Object.entries(partial)) {
        if (raw === undefined) continue;
        if (key === "presetId" || key === "finishId") throw new RangeError(`${finishId}: "${key}" is structural`);
        const field = shape[key];
        if (field === undefined) throw new RangeError(`${finishId} has no parameter "${key}"`);
        const next = z.parse(field, raw);
        const slot = uniforms[key];
        if (slot === undefined) throw new RangeError(`${finishId}: no uniform for "${key}"`);
        if (slot.value instanceof Color) slot.value.set(String(next));
        else if (typeof next === "number") slot.value = next;
        else throw new RangeError(`${finishId}: "${key}" is not a number`);
      }
      return true;
    },
    dispose: () => {
      finished.delete(material);
      material.dispose();
    },
  };
  finished.set(material, { preset, presetId, finishId, derive, colors, roles });
  return handle;
}

/**
 * Recolors a finished material in place: same uuid and program, only palette-driven color uniforms change.
 */
export function applyFinishPalette(target: FinishHandle | NodeMaterial | readonly Material[] | Object3D, palette: ScenePalette): void {
  repaintFinished(target, palette);
}

function repaintFinished(target: unknown, palette: ScenePalette): void {
  if (Array.isArray(target)) {
    target.forEach((each) => {
      repaintFinished(each, palette);
    });
    return;
  }
  if (isFinishHandle(target)) {
    applyFinishRecord(target.material, palette);
    return;
  }
  if (target instanceof MeshPhysicalNodeMaterial) {
    applyFinishRecord(target, palette);
    return;
  }
  if (target instanceof Object3D) {
    target.traverse((child) => {
      if (child instanceof Mesh) repaintFinished(child.material, palette);
    });
  }
}

function applyFinishRecord(material: MeshPhysicalNodeMaterial, palette: ScenePalette): void {
  const known = finished.get(material);
  if (known === undefined) return;
  const scene = known.derive === undefined ? palette : known.derive(palette);
  paintUniforms(material, known.colors, known.roles, known.preset, scene);
}

function isFinishHandle(value: unknown): value is FinishHandle {
  return typeof value === "object" && value !== null && "material" in value && "presetId" in value;
}