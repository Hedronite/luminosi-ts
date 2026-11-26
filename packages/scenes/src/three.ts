import { applyPalette as applyMaterialPalette, createMaterial } from "@hedronite/lts-materials/three";
import { primitive } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";
import { neutral, sceneLighting, type ScenePalette } from "@hedronite/lts-tokens";
import { AmbientLight, Color, DirectionalLight, Group, HemisphereLight, Light, Mesh, type Object3D } from "three";
import { sceneKit, type LightSpec, type SceneKitId } from "./kits.js";

/** The spec each light a kit built came from, so a later `applyPalette` writes its colors the way building did. */
const lightSpecs = new WeakMap<Object3D, LightSpec>();

/** Writes the colors a spec gives from `palette` into `light`, in place. The one place a kit light's colors are decided. */
const tintColor = new Color();

function paintLight(light: Light, spec: LightSpec, palette: ScenePalette): void {
  const lighting = sceneLighting(palette);
  if (spec.kind !== "hemisphere") {
    light.color.set(lighting[spec.role]);
    if (spec.tint !== undefined) light.color.multiply(tintColor.set(spec.tint));
  } else if (light instanceof HemisphereLight) {
    light.color.set(lighting[spec.sky]);
    light.groundColor.set(lighting[spec.ground]);
  }
}

const createLight = (spec: LightSpec, palette: ScenePalette): Light => {
  let light: Light;
  switch (spec.kind) {
    case "directional":
      light = new DirectionalLight(new Color(), spec.intensity);
      light.position.set(...spec.position);
      break;
    case "ambient":
      light = new AmbientLight(new Color(), spec.intensity);
      break;
    case "hemisphere":
      light = new HemisphereLight(new Color(), new Color(), spec.intensity);
      break;
  }
  paintLight(light, spec, palette);
  lightSpecs.set(light, spec);
  return light;
};

/**
 * Builds a scene kit (lights and placements) into a Group. Materials take their colors from `palette` (default: neutral).
 * The caller owns everything and should free it with `disposeObject` from `@hedronite/lts-primitives/three`.
 */
export function createSceneKit(id: SceneKitId, palette: ScenePalette = neutral.scene): Group {
  const kit = sceneKit(id);
  const group = new Group();
  group.name = `scene-${id}`;

  for (const spec of kit.lights) group.add(createLight(spec, palette));

  for (const [index, placement] of kit.placements.entries()) {
    const geometry = createPolyhedronGeometry(primitive(placement.primitive), placement.primitive);
    const material = createMaterial(placement.material, palette);
    const mesh = new Mesh(geometry, material);
    mesh.name = `${placement.primitive}-${String(index)}`;
    mesh.position.set(...placement.position);
    mesh.scale.setScalar(placement.scale);
    if (placement.rotation !== undefined) mesh.rotation.set(...placement.rotation);
    group.add(mesh);
  }
  return group;
}

/** Recolors a built kit in place: every material and kit light follows `palette`, and nothing is added or disposed. */
export function applyPalette(kit: Object3D, palette: ScenePalette): void {
  applyMaterialPalette(kit, palette);
  kit.traverse((child) => {
    const spec = lightSpecs.get(child);
    if (spec !== undefined && child instanceof Light) paintLight(child, spec, palette);
  });
}
