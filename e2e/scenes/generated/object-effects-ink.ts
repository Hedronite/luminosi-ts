// Generated from a scene document: change the document and generate this again.
import { descriptors } from "@hedronite/lts-objects/descriptors";
import { screenEffectSchemas } from "@hedronite/lts-postfx";
import { ScreenEffects } from "@hedronite/lts-postfx/three";
import { createStudioLights, disposeObject } from "@hedronite/lts-primitives/three";
import { type EffectClock } from "@hedronite/lts-shaders/three";
import { neutral } from "@hedronite/lts-tokens";
import { Group, PerspectiveCamera, Scene, Vector2 } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { PMREMGenerator, type WebGPURenderer } from "three/webgpu";

const palette = neutral.scene;

const objects = new Map(descriptors.map((descriptor) => [descriptor.meta.id, descriptor]));

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
  const camera = new PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 2.2, 5.5);
  camera.lookAt(0, 0, 0);
  const controller = new AbortController();
  const loads: Promise<void>[] = [];
  const load = (id: string, params: unknown) => {
    const descriptor = objects.get(id);
    return descriptor === undefined ? Promise.reject(new Error(`no object named ${id}`)) : descriptor.build(params, palette, { signal: controller.signal });
  };

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
  n0.scale.set(0.6, 0.6, 0.6);
  root.add(n0);
  loads.push(load("dress-watch", { hours: 10, minutes: 10, seconds: 30 }).then((object) => {
    if (controller.signal.aborted) disposeObject(object);
    else n0.add(object);
  }));

  const effects = new ScreenEffects(renderer, scene, camera, [{ id: "dither", params: screenEffectSchemas["dither"].parse({ cell: 4 }) }, { id: "grain", params: screenEffectSchemas["grain"].parse({}) }], { palette, reducedMotion: options.reducedMotion === true, monochrome: palette.accent });
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
      effects.setSize();
      effects.render(delta);
    },
    dispose: () => {
      controller.abort();
      scene.remove(root);
      disposeObject(root);
      effects.dispose();
      environment.dispose();
    },
  };
}
