// Generated from a scene document: change the document and generate this again.
import { materialPreset } from "@hedronite/lts-materials";
import { createMaterial } from "@hedronite/lts-materials/three";
import { createFramedSolid } from "@hedronite/lts-objects/three";
import { primitive } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry, createStudioLights, disposeObject } from "@hedronite/lts-primitives/three";
import { createEffect, type EffectClock } from "@hedronite/lts-shaders/three";
import { neutral } from "@hedronite/lts-tokens";
import { Group, PerspectiveCamera, Scene, Vector2 } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { PMREMGenerator, type WebGPURenderer } from "three/webgpu";

const palette = neutral.scene;

export interface Options {
  /** Where surface shaders read time from. Default: three's wall clock. */
  readonly clock?: EffectClock;
  /** Skip the intro and the sweep of the screen effects. */
  readonly reducedMotion?: boolean;
}

export interface Built {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Settles when every object has built. */
  readonly ready: Promise<void>;
  /** Draws a frame. The camera's aspect follows the renderer's size at each call. */
  readonly render: (delta: number) => void;
  readonly dispose: () => void;
}

export function build(renderer: WebGPURenderer, options: Options = {}): Built {
  const scene = new Scene();
  const size = new Vector2();
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 3.4);
  camera.lookAt(0, 0, 0);
  const controller = new AbortController();
  const loads: Promise<void>[] = [];

  scene.add(createStudioLights({ intensity: 1 }));
  const room = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = environment.texture;

  const root = new Group();
  scene.add(root);

  const n0 = new Group();
  n0.name = "node-1";
  n0.position.set(0, 0, 0);
  n0.rotation.set(0, 0, 0);
  n0.scale.set(1, 1, 1);
  root.add(n0);
  const object0 = createFramedSolid(primitive("archimedean-truncated-icosahedron"), { faces: createEffect("toon", { bands: 4 }, palette, options.clock === undefined ? {} : { clock: options.clock }).material, edges: createMaterial("metal", palette, (look) => ({ ...look, [materialPreset("metal").color]: look.accent })) });
  n0.add(object0);

  return {
    scene,
    camera,
    ready: Promise.all(loads).then(() => undefined),
    render: (delta) => {
      renderer.getSize(size);
      if (size.y > 0 && Math.abs(camera.aspect - size.x / size.y) > 1e-6) {
        camera.aspect = size.x / size.y;
        camera.updateProjectionMatrix();
      }
      renderer.render(scene, camera);
    },
    dispose: () => {
      controller.abort();
      scene.remove(root);
      disposeObject(root);
      environment.dispose();
    },
  };
}
