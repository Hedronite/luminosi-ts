import type { Scene, SceneNode } from "../schema.js";
import { assetScale, forest, importLine, literal, lookSource, names, num, type Entry } from "./common.js";

const isShader = (node: SceneNode): boolean => node.surface !== undefined && "shader" in node.surface;

/** The material source for a node's faces or surface: a shader's material, or a preset's. `fallback` is the preset a node with no surface gets. */
function faces(node: SceneNode, fallback: string): string {
  const { surface } = node;
  if (surface !== undefined && "shader" in surface) return `createEffect(${JSON.stringify(surface.shader)}, ${literal(surface.params ?? {})}, palette, { clock }).material`;
  return `createMaterial(${JSON.stringify(surface === undefined ? fallback : surface.material)}, palette)`;
}

/** The source that builds one node's asset into `object`, and adds it to `group`. */
function build(node: SceneNode, at: number): readonly string[] {
  const { asset } = node;
  const group = `n${String(at)}`;
  const scale = assetScale(node);
  const grow = scale === undefined ? [] : [`  object${String(at)}.scale.setScalar(${num(scale)});`];
  switch (asset.kind) {
    case "primitive":
      return [
        `  const object${String(at)} = new Mesh(createPolyhedronGeometry(primitive(${JSON.stringify(asset.id)}), ${JSON.stringify(asset.id)}), ${faces(node, "satin")});`,
        ...grow,
        `  ${group}.add(object${String(at)});`,
      ];
    case "framed": {
      const edges = JSON.stringify(asset.edges.material);
      return [
        // The edges take the look's accent in the slot their material colors from, as the adapter's framed solid does.
        `  const object${String(at)} = createFramedSolid(primitive(${JSON.stringify(asset.id)}), { faces: ${faces(node, "glass")}, edges: createMaterial(${edges}, palette, (look) => ({ ...look, [materialPreset(${edges}).color]: look.accent })) });`,
        ...grow,
        `  ${group}.add(object${String(at)});`,
      ];
    }
    case "object":
      return [`  loads.push(load(${JSON.stringify(asset.id)}, ${literal(asset.params ?? {})}).then((object) => {`, `    if (controller.signal.aborted) disposeObject(object);`, `    else ${group}.add(object);`, "  }));"];
  }
}

function nodes(entries: readonly Entry[]): readonly string[] {
  return entries.flatMap(({ node, parent }, at) => {
    const group = `n${String(at)}`;
    return [
      "",
      `  const ${group} = new Group();`,
      `  ${group}.name = ${JSON.stringify(node.id)};`,
      `  ${group}.position.set(${node.position.map(num).join(", ")});`,
      `  ${group}.rotation.set(${node.rotation.map(num).join(", ")});`,
      `  ${group}.scale.set(${node.scale.map(num).join(", ")});`,
      `  ${parent === -1 ? "root" : `n${String(parent)}`}.add(${group});`,
      ...build(node, at),
    ];
  });
}

/**
 * The document as plain three.js: one module that exports `build(renderer)`, made from the libraries' `./three`
 * builders and nothing of this package. It returns the scene, the camera, a `ready` promise (objects build
 * asynchronously), `render(delta)`, `resize` and `dispose`. Equal documents give equal text. A node is a group named by its
 * id, held in a numbered variable and never used as a name or a key, so any id is safe.
 */
export function toVanilla(scene: Scene): string {
  const entries = forest(scene);
  const look = lookSource(scene.look);
  const drawn = entries.map(({ node }) => node);
  const primitives = drawn.some(({ asset }) => asset.kind === "primitive");
  const framed = drawn.some(({ asset }) => asset.kind === "framed");
  const objects = drawn.some(({ asset }) => asset.kind === "object");
  const shaders = drawn.some(isShader);
  const materials = drawn.some((node) => node.asset.kind === "framed" || (node.asset.kind === "primitive" && !isShader(node)));
  const effects = scene.effects.length > 0;
  const ink = scene.ink === "look" ? "" : `, monochrome: palette.${scene.ink}`;
  const [x, y, z] = scene.camera.target;
  const stack = `[${scene.effects.map((effect) => (effect.params === undefined ? `{ id: ${JSON.stringify(effect.id)} }` : `{ id: ${JSON.stringify(effect.id)}, params: ${literal(effect.params)} }`)).join(", ")}]`;
  return [
    "// Generated from a scene document: change the document and generate this again.",
    ...(framed ? [importLine("{ materialPreset }", "@hedronite/lts-materials")] : []),
    ...(materials ? [importLine("{ createMaterial }", "@hedronite/lts-materials/three")] : []),
    ...(objects ? [importLine("{ descriptors }", "@hedronite/lts-objects/descriptors")] : []),
    ...(framed ? [importLine("{ createFramedSolid }", "@hedronite/lts-objects/three")] : []),
    ...(effects ? [importLine("{ ScreenEffects }", "@hedronite/lts-postfx/three")] : []),
    ...(primitives || framed ? [importLine("{ primitive }", "@hedronite/lts-primitives")] : []),
    importLine(names([...(primitives || framed ? ["createPolyhedronGeometry"] : []), "createStudioLights", "disposeObject"].sort()), "@hedronite/lts-primitives/three"),
    ...(shaders ? [importLine("{ createEffect }", "@hedronite/lts-shaders/three")] : []),
    importLine(names(look.values, look.types), "@hedronite/lts-tokens"),
    importLine(names(["Group", ...(primitives ? ["Mesh"] : []), "PerspectiveCamera", "Scene", "Vector2"].sort()), "three"),
    importLine("{ RoomEnvironment }", "three/examples/jsm/environments/RoomEnvironment.js"),
    ...(shaders ? [importLine("{ uniform }", "three/tsl")] : []),
    importLine("{ PMREMGenerator, type WebGPURenderer }", "three/webgpu"),
    "",
    ...look.lines,
    ...(objects ? ["", "const objects = new Map(descriptors.map((descriptor) => [descriptor.meta.id, descriptor]));"] : []),
    "",
    "export interface Built {",
    "  readonly scene: Scene;",
    "  readonly camera: PerspectiveCamera;",
    "  /** Settles when every object has built. */",
    "  readonly ready: Promise<void>;",
    "  readonly render: (delta: number) => void;",
    "  readonly resize: (width: number, height: number) => void;",
    "  readonly dispose: () => void;",
    "}",
    "",
    "export function build(renderer: WebGPURenderer): Built {",
    "  const scene = new Scene();",
    "  const size = renderer.getSize(new Vector2());",
    `  const camera = new PerspectiveCamera(${num(scene.camera.fov)}, size.y === 0 ? 1 : size.x / size.y, 0.1, 1000);`,
    `  camera.position.set(${scene.camera.position.map(num).join(", ")});`,
    `  camera.lookAt(${num(x)}, ${num(y)}, ${num(z)});`,
    "  const controller = new AbortController();",
    "  const loads: Promise<void>[] = [];",
    ...(shaders ? ["  const clock = uniform(0);"] : []),
    ...(objects
      ? [
          "  const load = (id: string, params: unknown) => {",
          "    const descriptor = objects.get(id);",
          "    return descriptor === undefined ? Promise.reject(new Error(`no object named ${id}`)) : descriptor.build(params, palette, { signal: controller.signal });",
          "  };",
        ]
      : []),
    "",
    `  scene.add(createStudioLights({ intensity: ${num(scene.lights.intensity)} }));`,
    "  const room = new RoomEnvironment();",
    "  const pmrem = new PMREMGenerator(renderer);",
    "  const environment = pmrem.fromScene(room, 0.04);",
    "  room.dispose();",
    "  pmrem.dispose();",
    "  scene.environment = environment.texture;",
    "",
    "  const root = new Group();",
    "  scene.add(root);",
    ...nodes(entries),
    "",
    ...(effects ? [`  const effects = new ScreenEffects(renderer, scene, camera, ${stack}, { palette${ink} });`] : []),
    ...(shaders ? ["  let elapsed = 0;"] : []),
    "  return {",
    "    scene,",
    "    camera,",
    "    ready: Promise.all(loads).then(() => undefined),",
    "    render: (delta) => {",
    ...(shaders ? ["      elapsed += delta;", "      clock.value = elapsed;"] : []),
    effects ? "      effects.render(delta);" : "      renderer.render(scene, camera);",
    "    },",
    "    resize: (width, height) => {",
    "      camera.aspect = width / height;",
    "      camera.updateProjectionMatrix();",
    ...(effects ? ["      effects.setSize();"] : []),
    "    },",
    "    dispose: () => {",
    "      controller.abort();",
    "      scene.remove(root);",
    "      disposeObject(root);",
    ...(effects ? ["      effects.dispose();"] : []),
    "      environment.dispose();",
    "    },",
    "  };",
    "}",
    "",
  ].join("\n");
}
