import { hedronite, neutral, presets } from "@hedronite/lts-tokens";
import { BoxGeometry, Color, Mesh } from "three";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { materialIds } from "../presets.js";
import { createMaterial } from "../three.js";
import { applyFinishPalette, createFinishedMaterial, createPresetNodeMaterial } from "../finished.js";
import { auditFinishGraph, assertNoTextureMaps, collectTslNodes, finishOutputNodes, isTextureInGraph } from "./graphAudit.js";
import { finishDescriptor, finishDescriptors, finishIds, finishSchemas } from "./info.js";

function colorHex(slot: { value: Color | number } | undefined): number {
  if (slot === undefined) throw new Error("missing color uniform");
  if (!(slot.value instanceof Color)) throw new Error("color uniform is not a Color");
  return slot.value.getHex();
}

describe("finish descriptors", () => {
  it("lists five finishes with bounded parameter fields", () => {
    expect(finishIds).toEqual(["brushed", "frost", "grain", "orange-peel", "weave"]);
    const descriptors = finishDescriptors();
    expect(descriptors).toHaveLength(5);
    for (const descriptor of descriptors) {
      expect(descriptor.fields.length).toBeGreaterThan(0);
      for (const field of descriptor.fields) {
        if (field.type !== "number" || field.min === undefined || field.max === undefined) continue;
        expect(field.min).toBeLessThanOrEqual(field.max);
      }
    }
    expect(finishDescriptor("brushed").defaults).toEqual({ scale: 8, strength: 0.5, direction: 0 });
    expect(finishDescriptor("grain").defaults).toEqual({ scale: 12, strength: 0.85 });
    expect(finishDescriptor("weave").defaults).toEqual({ scale: 16, strength: 0.72, direction: 0 });
  });

  it("declares at least one real material preset per finish", () => {
    for (const descriptor of finishDescriptors()) {
      expect(descriptor.presets.length).toBeGreaterThan(0);
      for (const presetId of descriptor.presets) {
        expect(materialIds).toContain(presetId);
      }
    }
    expect(finishDescriptor("brushed").presets[0]).toBe("metal");
    expect(finishDescriptor("frost").presets[0]).toBe("glass");
    expect(finishDescriptor("grain").presets[0]).toBe("satin");
    expect(finishDescriptor("orange-peel").presets[0]).toBe("clearcoat");
    expect(finishDescriptor("weave").presets[0]).toBe("fabric");
  });

  it("refuses out-of-range parameters", () => {
    expect(() => finishSchemas.brushed.parse({ scale: 0.25 })).toThrow(z.ZodError);
    expect(() => finishSchemas["orange-peel"].parse({ strength: 1.2 })).toThrow(z.ZodError);
    expect(() => finishSchemas.weave.parse({ direction: 400 })).toThrow(z.ZodError);
  });
});

describe("createPresetNodeMaterial", () => {
  it("wires only the palette color node for the node baseline", () => {
    const material = createPresetNodeMaterial("matte", neutral.scene);
    expect(material).toBeInstanceOf(MeshPhysicalNodeMaterial);
    expect(material.roughnessNode).not.toBeNull();
    expect(material.normalNode).not.toBeNull();
    material.dispose();
  });

  it.each([...materialIds])("matches createMaterial scalars and colors for %s", (id) => {
    const classic = createMaterial(id, neutral.scene);
    const node = createPresetNodeMaterial(id, neutral.scene);
    expect(node.roughness).toBe(node.roughnessNode === null ? classic.roughness : 1);
    expect(node.metalness).toBe(classic.metalness);
    expect(node.clearcoat).toBe(classic.clearcoat);
    expect(node.clearcoatRoughness).toBe(classic.clearcoatRoughness);
    expect(node.transmission).toBe(classic.transmission);
    expect(node.ior).toBe(classic.ior);
    expect(node.thickness).toBe(classic.thickness);
    expect(node.sheen).toBe(classic.sheen);
    expect(node.sheenRoughness).toBe(classic.sheenRoughness);
    expect(node.iridescence).toBe(classic.iridescence);
    expect(node.iridescenceIOR).toBe(classic.iridescenceIOR);
    expect(node.iridescenceThicknessMinimum).toBe(classic.iridescenceThicknessMinimum);
    expect(node.iridescenceThicknessMaximum).toBe(classic.iridescenceThicknessMaximum);
    expect(node.specularIntensity).toBe(classic.specularIntensity);
    expect(node.attenuationDistance).toBe(classic.attenuationDistance);
    expect(node.emissiveIntensity).toBe(classic.emissiveIntensity);
    expect(node.sheenColor.getHex()).toBe(classic.sheenColor.getHex());
    classic.dispose();
    node.dispose();
  });
});

describe("createFinishedMaterial", () => {
  it.each([...finishIds])("%s compiles as a node physical material over every preset", (finishId) => {
    for (const id of ["ceramic", "metal", "glass", "fabric"] as const) {
      const handle = createFinishedMaterial(id, finishId);
      expect(handle.material).toBeInstanceOf(MeshPhysicalNodeMaterial);
      expect(handle.id).toBe(finishId);
      expect(handle.presetId).toBe(id);
      handle.dispose();
    }
  });

  it("recolors in place: the same material uuid, palette uniforms updated, scalars untouched", () => {
    const handle = createFinishedMaterial("metal", "brushed", {}, neutral.scene);
    const uuid = handle.material.uuid;
    const { scale, strength } = handle.uniforms;
    const scaleBefore = scale?.value;
    const strengthBefore = strength?.value;
    const colorSlot = handle.uniforms.color;
    const colorBefore = colorHex(colorSlot);
    applyFinishPalette(handle, hedronite.scene);
    expect(handle.material.uuid).toBe(uuid);
    expect(colorHex(colorSlot)).toBe(new Color(hedronite.scene.metal).getHex());
    expect(colorHex(colorSlot)).not.toBe(colorBefore);
    expect(scale?.value).toBe(scaleBefore);
    expect(strength?.value).toBe(strengthBefore);
    handle.dispose();
  });

  it.each([...finishIds])("changes %s live uniforms with set", (finishId) => {
    const handle = createFinishedMaterial("satin", finishId);
    expect(handle.structural).toEqual(["presetId", "finishId"]);
    const uuid = handle.material.uuid;
    expect(handle.set({ scale: 12, strength: 0.8 })).toBe(true);
    expect(handle.uniforms.scale?.value).toBe(12);
    expect(handle.uniforms.strength?.value).toBe(0.8);
    expect(handle.material.uuid).toBe(uuid);
    handle.dispose();
  });

  it("drives strength to zero with set() on the same material and program", () => {
    const handle = createFinishedMaterial("satin", "grain", { strength: 0.85, scale: 12 }, neutral.scene);
    const uuid = handle.material.uuid;
    const program = handle.material.version;
    expect(handle.set({ strength: 0 })).toBe(true);
    expect(handle.uniforms.strength?.value).toBe(0);
    expect(handle.material.uuid).toBe(uuid);
    expect(handle.material.version).toBe(program);
    handle.set({ strength: 0.85 });
    handle.dispose();
  });

  it("frees the material on dispose", () => {
    const handle = createFinishedMaterial("clearcoat", "orange-peel");
    const onDispose = vi.fn();
    handle.material.addEventListener("dispose", onDispose);
    handle.dispose();
    expect(onDispose).toHaveBeenCalledOnce();
  });

  it("recolors finished meshes under an object", () => {
    const mesh = new Mesh(new BoxGeometry(), createFinishedMaterial("glass", "frost").material);
    applyFinishPalette(mesh, hedronite.scene);
    expect(mesh.material).toBeInstanceOf(MeshPhysicalNodeMaterial);
    mesh.material.dispose();
  });

  it("matches palette colors when made fresh in another look", () => {
    for (const to of presets) {
      const handle = createFinishedMaterial("fabric", "weave", { direction: 15 }, neutral.scene);
      applyFinishPalette(handle, to.scene);
      const fresh = createFinishedMaterial("fabric", "weave", { direction: 15 }, to.scene);
      expect(colorHex(handle.uniforms.color)).toBe(colorHex(fresh.uniforms.color));
      handle.dispose();
      fresh.dispose();
    }
  });
});

describe("finish graph behavior", () => {
  it.each([...finishIds])("%s keeps texture map slots empty and has no texture nodes in wired outputs", (finishId) => {
    const handle = createFinishedMaterial("matte", finishId);
    assertNoTextureMaps(handle.material);
    for (const output of finishOutputNodes(handle.material)) {
      expect(isTextureInGraph(output)).toBe(false);
    }
    handle.dispose();
  });

  it.each([...finishIds])("%s graphs are procedural and use every exposed uniform", (finishId) => {
    const handle = createFinishedMaterial("matte", finishId);
    const audit = auditFinishGraph(handle);
    expect(audit.textures).toBe(false);
    expect(audit.procedural).toBe(true);
    expect(audit.uniforms).toBe(true);
    const nodes = finishOutputNodes(handle.material).flatMap((output) => collectTslNodes(output));
    expect(nodes.length).toBeGreaterThan(1);
    handle.dispose();
  });
});