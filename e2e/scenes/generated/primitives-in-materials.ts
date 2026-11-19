// Generated from a scene document: change the document and generate this again.
import { createMaterial } from "@hedronite/lts-materials/three";
import { primitive } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry, createStudioLights, disposeObject } from "@hedronite/lts-primitives/three";
import { type EffectClock } from "@hedronite/lts-shaders/three";
import { neutral } from "@hedronite/lts-tokens";
import { Group, Mesh, PerspectiveCamera, Scene, Vector2 } from "three";
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
  const camera = new PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 2.2, 5.5);
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
  n0.position.set(5.19573633741296e-17, 0, -0.848528137423857);
  n0.rotation.set(0, 0, 0);
  n0.scale.set(0.5, 0.5, 0.5);
  root.add(n0);
  const geometry0 = createPolyhedronGeometry(primitive("platonic-cube"), "platonic-cube");
  const object0 = new Mesh(geometry0, createMaterial("metal", palette));
  n0.add(object0);

  const n1 = new Group();
  n1.name = "node-2";
  n1.position.set(0.848528137423857, 0, 0);
  n1.rotation.set(0, 0, 0);
  n1.scale.set(0.5, 0.5, 0.5);
  root.add(n1);
  const geometry1 = createPolyhedronGeometry(primitive("platonic-icosahedron"), "platonic-icosahedron");
  const object1 = new Mesh(geometry1, createMaterial("glass", palette));
  n1.add(object1);

  const n2 = new Group();
  n2.name = "node-3";
  n2.position.set(5.19573633741296e-17, 0, 0.848528137423857);
  n2.rotation.set(0, 0, 0);
  n2.scale.set(0.5, 0.5, 0.5);
  root.add(n2);
  const geometry2 = createPolyhedronGeometry(primitive("platonic-octahedron"), "platonic-octahedron");
  const object2 = new Mesh(geometry2, createMaterial("ceramic", palette));
  n2.add(object2);

  const n3 = new Group();
  n3.name = "node-4";
  n3.position.set(-0.848528137423857, 0, 1.039147267482592e-16);
  n3.rotation.set(0, 0, 0);
  n3.scale.set(0.5, 0.5, 0.5);
  root.add(n3);
  const geometry3 = createPolyhedronGeometry(primitive("platonic-dodecahedron"), "platonic-dodecahedron");
  const object3 = new Mesh(geometry3, createMaterial("emissive", palette));
  n3.add(object3);

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
