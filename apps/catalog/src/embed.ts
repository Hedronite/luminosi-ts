import { rendererReadout, whenDrawn } from "@hedronite/lts-adapters/webgpu";
import { parseObjectSpec } from "@hedronite/lts-objects";
import { createObjectFromSpec } from "@hedronite/lts-objects/three";
import { disposeObject } from "@hedronite/lts-primitives/three";
import { presets } from "@hedronite/lts-tokens";
import { ACESFilmicToneMapping, Color, CustomBlending, DirectionalLight, Mesh, MeshBasicMaterial, OneFactor, OrthographicCamera, PlaneGeometry, PMREMGenerator, Scene, Vector3, WebGPURenderer, ZeroFactor, type Object3D } from "three/webgpu";
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

  const renderer = new WebGPURenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(params.width, params.height);
  renderer.toneMapping = ACESFilmicToneMapping;
  await renderer.init();
  rendererReadout(renderer);
  document.body.append(renderer.domElement);

  const scene = new Scene();
  // The background is a page color, not a lit surface: the canvas is transparent where nothing is
  // drawn, so `bg` lands exactly rather than through the renderer's tone mapping.
  document.body.style.background = params.background;
  const room = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = target.texture;
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

  // One frame. The clear carries the requested background with full alpha, so the glass, which refracts what
  // was drawn before it, samples that colour as the WebGL renderer's background did before the swap. The page
  // still paints `bg` exactly: a quad behind the object is drawn last, at the far end of the view, so every
  // pixel the object covered fails its depth test; where nothing was drawn it keeps the frame's colour and
  // writes zero alpha, leaving only the object opaque over the page.
  renderer.setClearColor(new Color(params.background), 1);
  const backdrop = new Mesh(
    new PlaneGeometry((frustum.right - frustum.left) * 1.05, (frustum.top - frustum.bottom) * 1.05),
    new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: ZeroFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: ZeroFactor,
    }),
  );
  // Perpendicular to the view and a hair wider than the frame, centred on the frustum (its fit box may sit off
  // centre), so the edge pixels are covered at any camera angle.
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  backdrop.position
    .copy(camera.position)
    .addScaledVector(camera.getWorldDirection(new Vector3()), 50)
    .addScaledVector(right, (frustum.left + frustum.right) / 2)
    .addScaledVector(up, (frustum.top + frustum.bottom) / 2);
  backdrop.quaternion.copy(camera.quaternion);
  backdrop.renderOrder = 1000;
  scene.add(backdrop);
  renderer.render(scene, camera);
  await whenDrawn(renderer);
  disposeObject(object);
  disposeObject(backdrop);
  target.dispose();
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
