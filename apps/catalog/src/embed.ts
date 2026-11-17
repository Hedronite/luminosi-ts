import { parseObjectSpec } from "@hedronite/lts-objects";
import { createObjectFromSpec } from "@hedronite/lts-objects/three";
import { disposeObject } from "@hedronite/lts-primitives/three";
import { presets } from "@hedronite/lts-tokens";
import { ACESFilmicToneMapping, Color, DirectionalLight, Mesh, OrthographicCamera, PMREMGenerator, Scene, Vector3, WebGLRenderer, type Object3D } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { defaultBox, fitFrustum, parseEmbedParams, type CameraExtent } from "./embedFit.js";

/**
 * The embed page: one ObjectSpec, one frame, no chrome. Used by the image-to-object review (which
 * frames the render like the reference photo) and, later, by Studio's WebView. Query parameters are
 * documented on `parseEmbedParams`. When the frame is drawn, `window.__ltsEmbed` says so.
 */

export interface EmbedState {
  readonly status: "loading" | "drawn" | "error";
  readonly error?: string;
  readonly parts?: number;
  readonly frustum?: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
}

declare global {
  interface Window {
    __ltsEmbed?: EmbedState;
  }
}

const isMesh = (object: Object3D): object is Mesh => object instanceof Mesh;

/** Every vertex of every mesh, in the camera's frame: the exact projected extent, not a loose box. */
function cameraExtent(root: Object3D, camera: OrthographicCamera): CameraExtent {
  root.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const toCamera = camera.matrixWorldInverse;
  const point = new Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  root.traverse((object) => {
    if (!isMesh(object)) return;
    const position = object.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld).applyMatrix4(toCamera);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  });
  if (!Number.isFinite(minX)) throw new Error("the object has no geometry to frame");
  return { minX, maxX, minY, maxY };
}

async function draw(): Promise<EmbedState> {
  const params = parseEmbedParams(location.search);
  const look = presets.find((preset) => preset.id === params.look);
  if (look === undefined) throw new RangeError(`unknown look "${params.look}"; try ${presets.map((p) => p.id).join(", ")}`);
  const response = await fetch(params.spec);
  if (!response.ok) throw new Error(`could not load ${params.spec}: HTTP ${String(response.status)}`);
  const spec = parseObjectSpec(await response.json());

  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(params.width, params.height);
  renderer.toneMapping = ACESFilmicToneMapping;
  document.body.append(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(params.background);
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  const key = new DirectionalLight("#ffffff", 1.2);
  key.position.set(1, 2, 3);
  scene.add(key);

  const object = createObjectFromSpec(spec, { palette: look.scene });
  scene.add(object);

  // Orbit the camera, not the object, so the object's own frame stays the spec's.
  const yaw = (params.yaw * Math.PI) / 180;
  const pitch = (params.pitch * Math.PI) / 180;
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  camera.position.set(10 * Math.sin(yaw) * Math.cos(pitch), 10 * Math.sin(pitch), 10 * Math.cos(yaw) * Math.cos(pitch));
  camera.lookAt(0, 0, 0);
  const extent = cameraExtent(object, camera);
  const frustum = fitFrustum(extent, params.fit ?? defaultBox(extent, params.width, params.height), params.width, params.height);
  Object.assign(camera, frustum);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  disposeObject(object);
  environment.dispose();
  pmrem.dispose();
  return { status: "drawn", parts: spec.parts.length, frustum };
}

window.__ltsEmbed = { status: "loading" };
draw().then(
  (state) => {
    window.__ltsEmbed = state;
  },
  (error: unknown) => {
    window.__ltsEmbed = { status: "error", error: error instanceof Error ? error.message : String(error) };
    console.error(error);
  },
);
