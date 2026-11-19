import { applyPalette as applyMaterialPalette, createMaterial } from "@hedronite/lts-materials/three";
import { primitive } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";
import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { AmbientLight, Color, DirectionalLight, Group, HemisphereLight, Light, Mesh, type Object3D } from "three";
import { sceneKit, type LightSpec, type SceneKitId } from "./kits.js";

/** The spec each light a kit built came from, so a later `applyPalette` writes its colors the way building did. */
const lightSpecs = new WeakMap<Object3D, LightSpec>();

/** Writes the colors a spec gives into `light`, in place. The one place a kit light's colors are decided. */
function paintLight(light: Light, spec: LightSpec): void {
  if (spec.kind !== "hemisphere") {
    light.color.set(spec.color);
  } else if (light instanceof HemisphereLight) {
    light.color.set(spec.sky);
    light.groundColor.set(spec.ground);
  }
}

const createLight = (spec: LightSpec): Light => {
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
  paintLight(light, spec);
  lightSpecs.set(light, spec);
  return light;
};

/**
 * A scene kit as a group: its lights and its meshes, colored from `palette`.
 * Add it to a scene in place of other lights. Free it with `disposeObject` from `@hedronite/lts-primitives`.
 */
export function createSceneKit(id: SceneKitId, palette: ScenePalette = neutral.scene): Group {
  const kit = sceneKit(id);
  const group = new Group();
  group.name = `scene-${id}`;
  for (const spec of kit.lights) group.add(createLight(spec));
  for (const placement of kit.placements) {
    const mesh = new Mesh(createPolyhedronGeometry(primitive(placement.primitive), placement.primitive), createMaterial(placement.material, palette));
    mesh.position.set(...placement.position);
    mesh.scale.setScalar(placement.scale);
    if (placement.rotation !== undefined) mesh.rotation.set(...placement.rotation);
    group.add(mesh);
  }
  return group;
}

/**
 * Recolors in place, from a look, a kit `createSceneKit` made: its materials follow the look, and its lights are written again
 * from the kit's own data, so a change of look rebuilds nothing (the same geometries, the same programs). A kit's mood is its
 * lights, so they keep the colors the kit gives them under every look. Lights and materials made some other way are left alone.
 * The caller asks for a new frame.
 */
export function applyPalette(kit: Object3D, palette: ScenePalette): void {
  applyMaterialPalette(kit, palette);
  kit.traverse((child) => {
    const spec = lightSpecs.get(child);
    if (spec !== undefined && child instanceof Light) paintLight(child, spec);
  });
}
