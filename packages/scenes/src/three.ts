import { createMaterial } from "@hedronite/lts-materials/three";
import { primitive } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";
import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { AmbientLight, Color, DirectionalLight, Group, HemisphereLight, Mesh, type Light } from "three";
import { sceneKit, type LightSpec, type SceneKitId } from "./kits.js";

const createLight = (spec: LightSpec): Light => {
  switch (spec.kind) {
    case "directional": {
      const light = new DirectionalLight(new Color(spec.color), spec.intensity);
      light.position.set(...spec.position);
      return light;
    }
    case "ambient":
      return new AmbientLight(new Color(spec.color), spec.intensity);
    case "hemisphere":
      return new HemisphereLight(new Color(spec.sky), new Color(spec.ground), spec.intensity);
  }
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
