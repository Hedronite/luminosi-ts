import { ROOM_SPECS, type RoomColorExpr, type RoomColorToken } from "../rooms.js";
import type { Scene, SceneNode } from "../schema.js";
import { assetScale, creditExport, creditHeader, forest, hasMotion, importLine, literal, lookSource, motionSource, names, num, type Entry, type EmitOptions } from "./common.js";

const isShader = (node: SceneNode): boolean => node.surface !== undefined && "shader" in node.surface;

/** The material source for a node's faces or surface: a shader's material, or a preset's. `fallback` is the preset a node with no surface gets. */
function faces(node: SceneNode, fallback: string): string {
  const { surface } = node;
  if (surface !== undefined && "shader" in surface) return `createEffect(${JSON.stringify(surface.shader)}, ${literal(surface.params ?? {})}, palette, options.clock === undefined ? {} : { clock: options.clock }).material`;
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
        `  const geometry${String(at)} = createPolyhedronGeometry(primitive(${JSON.stringify(asset.id)}), ${JSON.stringify(asset.id)});`,
        // The primitive's own scale parameter scales its geometry about the centre, as its descriptor does.
        ...(scale === undefined ? [] : [`  geometry${String(at)}.scale(${num(scale)}, ${num(scale)}, ${num(scale)});`]),
        `  const object${String(at)} = new Mesh(geometry${String(at)}, ${faces(node, "satin")});`,
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

interface VanillaRoomConfig {
  readonly threeValues: readonly string[];
  readonly tokenValues: readonly string[];
  readonly lines: readonly string[];
}

const TOKEN_EXPR: Readonly<Record<RoomColorToken, { readonly code: string; readonly token: string }>> = {
  WHITE: { code: "WHITE", token: "WHITE" },
  BLACK: { code: "BLACK", token: "BLACK" },
  "neutral.ground": { code: "neutral.scene.ground", token: "neutral" },
  "neutral.base": { code: "neutral.scene.base", token: "neutral" },
  "hedronite.sky": { code: "hedronite.scene.sky", token: "hedronite" },
  "hedronite.fill": { code: "hedronite.scene.fill", token: "hedronite" },
  "dusk.key": { code: "duskLightTints.key", token: "duskLightTints" },
  "dusk.rim": { code: "duskLightTints.rim", token: "duskLightTints" },
  "dusk.ambient": { code: "duskLightTints.ambient", token: "duskLightTints" },
};

function colorExprCode(expr: RoomColorExpr, tokens: Set<string>): string {
  if (typeof expr === "string") {
    tokens.add(TOKEN_EXPR[expr].token);
    return TOKEN_EXPR[expr].code;
  }
  tokens.add("mixHex");
  return `mixHex(${colorExprCode(expr[1], tokens)}, ${colorExprCode(expr[2], tokens)}, ${num(expr[3])})`;
}

function environmentLines(scene: Scene): VanillaRoomConfig {
  const env = scene.environment;
  const hdri = env.hdri;
  const threeValues: string[] = [];
  const tokens = new Set<string>();
  const lines: string[] = [];
  const decl = hdri === undefined ? "const" : "let";

  if (env.kind === "studio") {
    lines.push(
      "  const room = new RoomEnvironment();",
      "  const pmrem = new PMREMGenerator(renderer);",
      `  ${decl} environment = pmrem.fromScene(room, 0.04);`,
      "  room.dispose();",
      "  pmrem.dispose();",
      "  scene.environment = environment.texture;",
    );
  } else {
    threeValues.push("BackSide", "BoxGeometry", "Mesh", "MeshLambertMaterial", "MeshStandardMaterial", "PointLight");
    tokens.add("BLACK");
    const spec = ROOM_SPECS[env.kind];
    lines.push(
      "  const room = new Scene();",
      "  room.position.y = -3.5;",
      "  const roomGeometry = new BoxGeometry();",
      '  roomGeometry.deleteAttribute("uv");',
      `  const wallMaterial = new MeshStandardMaterial({ color: ${colorExprCode(spec.wall, tokens)}, roughness: ${num(spec.roughness)}, side: BackSide });`,
      `  const contactMaterial = new MeshStandardMaterial({ color: ${colorExprCode(spec.contact, tokens)}, roughness: 1 });`,
      "  const roomMaterials: (MeshStandardMaterial | MeshLambertMaterial)[] = [wallMaterial, contactMaterial];",
      "  const enclosure = new Mesh(roomGeometry, wallMaterial);",
      "  enclosure.position.set(0, 12, 0);",
      "  enclosure.scale.set(31, 27, 29);",
      "  room.add(enclosure);",
      "  const contactFloor = new Mesh(roomGeometry, contactMaterial);",
      "  contactFloor.position.set(0, -1.2, 0);",
      "  contactFloor.scale.set(22, 0.4, 22);",
      "  room.add(contactFloor);",
      `  const roomLight = new PointLight(${colorExprCode(spec.point, tokens)}, ${num(spec.pointIntensity)}, 32, 2);`,
      "  roomLight.position.set(0.4, 16, 0.3);",
      "  room.add(roomLight);",
      ...spec.cards.flatMap(([colorExpr, cardIntensity, x, y, z, sx, sy, sz], i) => [
        `  const cardMat${String(i)} = new MeshLambertMaterial({ color: BLACK, emissive: ${colorExprCode(colorExpr, tokens)}, emissiveIntensity: ${num(cardIntensity)} });`,
        `  roomMaterials.push(cardMat${String(i)});`,
        `  const card${String(i)} = new Mesh(roomGeometry, cardMat${String(i)});`,
        `  card${String(i)}.position.set(${num(x)}, ${num(y)}, ${num(z)});`,
        `  card${String(i)}.scale.set(${num(sx)}, ${num(sy)}, ${num(sz)});`,
        `  room.add(card${String(i)});`,
      ]),
      "  const pmrem = new PMREMGenerator(renderer);",
      `  ${decl} environment = pmrem.fromScene(room, ${num(spec.blur)});`,
      "  roomGeometry.dispose();",
      "  for (const roomMaterial of roomMaterials) roomMaterial.dispose();",
      "  pmrem.dispose();",
      "  scene.environment = environment.texture;",
    );
  }

  if (env.intensity !== undefined) lines.push(`  scene.environmentIntensity = ${num(env.intensity)};`);
  if (env.rotation !== undefined) lines.push(`  scene.environmentRotation.set(0, ${num(env.rotation)}, 0);`);

  if (hdri !== undefined) {
    threeValues.push("EquirectangularReflectionMapping");
    const safeCredit = hdri.credit.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
    const safeUrl = hdri.url.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
    lines.push(
      `  // Optional HDRI (${hdri.license}): ${safeCredit} (${safeUrl})`,
      "  loads.push(",
      "    (async () => {",
      "      try {",
      `        const response = await fetch(${JSON.stringify(hdri.url)}, { signal: controller.signal });`,
      "        if (!response.ok) return;",
      "        const buffer = await response.arrayBuffer();",
      "        if (controller.signal.aborted) return;",
      "        const equirectangular = new HDRLoader().createDataTexture(buffer);",
      "        equirectangular.mapping = EquirectangularReflectionMapping;",
      "        equirectangular.needsUpdate = true;",
      "        if (controller.signal.aborted) { equirectangular.dispose(); return; }",
      "        const hdriPmrem = new PMREMGenerator(renderer);",
      "        const nextEnvironment = hdriPmrem.fromEquirectangular(equirectangular);",
      "        equirectangular.dispose();",
      "        hdriPmrem.dispose();",
      "        if (controller.signal.aborted) { nextEnvironment.dispose(); return; }",
      "        const previousEnvironment = environment;",
      "        environment = nextEnvironment;",
      "        scene.environment = nextEnvironment.texture;",
      "        previousEnvironment.dispose();",
      "      } catch {",
      "        // Graceful fallback to procedural room on network or decode failure.",
      "      }",
      "    })(),",
      "  );",
    );
  }

  return { threeValues, tokenValues: [...tokens], lines };
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
 * asynchronously), `render(delta)` and `dispose`. Equal documents give equal text. A node is a group named by its
 * id, held in a numbered variable and never used as a name or a key, so any id is safe. Given `credits` (what `creditsFor`
 * finds), the module opens with a `//` line for each and exports them as `credits`; given none, the text is as it was before
 * credits existed.
 */
export function toVanilla(scene: Scene, options: EmitOptions = {}): string {
  const credits = options.credits ?? [];
  const motion = hasMotion(scene);
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
  const env = environmentLines(scene);
  const tokenValues = [...new Set([...look.values, ...env.tokenValues])].sort();
  const threeValues = [...new Set(["Group", ...(primitives ? ["Mesh"] : []), "PerspectiveCamera", "Scene", "Vector2", ...env.threeValues])].sort();
  // Each effect's parameters are checked and filled with its defaults by its own schema, as `createScene` fills them.
  const stack = `[${scene.effects.map((effect) => `{ id: ${JSON.stringify(effect.id)}, params: screenEffectSchemas[${JSON.stringify(effect.id)}].parse(${literal(effect.params ?? {})}) }`).join(", ")}]`;
  return [
    "// Generated from a scene document: change the document and generate this again.",
    ...creditHeader(credits),
    ...(framed ? [importLine("{ materialPreset }", "@hedronite/lts-materials")] : []),
    ...(materials ? [importLine("{ createMaterial }", "@hedronite/lts-materials/three")] : []),
    ...(objects ? [importLine("{ descriptors }", "@hedronite/lts-objects/descriptors")] : []),
    ...(framed ? [importLine("{ createFramedSolid }", "@hedronite/lts-objects/three")] : []),
    ...(effects ? [importLine("{ screenEffectSchemas }", "@hedronite/lts-postfx"), importLine("{ ScreenEffects }", "@hedronite/lts-postfx/three")] : []),
    ...(primitives || framed ? [importLine("{ primitive }", "@hedronite/lts-primitives")] : []),
    importLine(names([...(primitives || framed ? ["createPolyhedronGeometry"] : []), "createStudioLights", "disposeObject"].sort()), "@hedronite/lts-primitives/three"),
    importLine(shaders ? "{ createEffect, type EffectClock }" : "{ type EffectClock }", "@hedronite/lts-shaders/three"),
    importLine(names(tokenValues, look.types), "@hedronite/lts-tokens"),
    importLine(names(threeValues, motion ? ["Object3D"] : []), "three"),
    ...(scene.environment.hdri === undefined ? [] : [importLine("{ HDRLoader }", "three/examples/jsm/loaders/HDRLoader.js")]),
    ...(scene.environment.kind === "studio" ? [importLine("{ RoomEnvironment }", "three/examples/jsm/environments/RoomEnvironment.js")] : []),
    importLine("{ PMREMGenerator, type WebGPURenderer }", "three/webgpu"),
    "",
    ...look.lines,
    ...(credits.length === 0 ? [] : ["", ...creditExport(credits)]),
    ...(motion ? ["", ...motionSource(scene)] : []),
    ...(objects ? ["", "const objects = new Map(descriptors.map((descriptor) => [descriptor.meta.id, descriptor]));"] : []),
    "",
    "export interface Options {",
    "  /** Where surface shaders read time from. Default: three's wall clock. */",
    "  readonly clock?: EffectClock;",
    "  /** Skip the intro and the sweep of the screen effects. */",
    "  readonly reducedMotion?: boolean;",
    "}",
    "",
    "export interface Built {",
    "  readonly scene: Scene;",
    "  readonly camera: PerspectiveCamera;",
    "  /** Settles when every object has built. */",
    "  readonly ready: Promise<void>;",
    "  /** Draws a frame. The camera's aspect follows the renderer's size at each call. */",
    "  readonly render: (delta: number) => void;",
    ...(motion ? ["  /** One step of the document's motion: the seconds since the last, and what the drivers read. */", "  readonly advance: (seconds: number, input?: MotionInput) => void;"] : []),
    "  readonly dispose: () => void;",
    "}",
    "",
    "export function build(renderer: WebGPURenderer, options: Options = {}): Built {",
    "  const scene = new Scene();",
    "  const size = new Vector2();",
    `  const camera = new PerspectiveCamera(${num(scene.camera.fov)}, 1, 0.1, 100);`,
    `  camera.position.set(${scene.camera.position.map(num).join(", ")});`,
    `  camera.lookAt(${num(x)}, ${num(y)}, ${num(z)});`,
    "  const controller = new AbortController();",
    "  const loads: Promise<void>[] = [];",
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
    ...env.lines,
    "",
    "  const root = new Group();",
    "  scene.add(root);",
    ...nodes(entries),
    ...(motion
      ? [
          "",
          "  // The document's motion: its tracks stepped by the caller's clock and written onto the groups above and the camera.",
          `  const byName = new Map<string, Object3D>([${entries.map(({ node }, at) => `[${JSON.stringify(node.id)}, n${String(at)}]`).join(", ")}]);`,
          "  const motion = motionRuntime(options.reducedMotion === true);",
          "  const motionTargets: MotionTargets = {",
          "    object: (id) => byName.get(id),",
          "    cameraPosition: (x, y, z) => { camera.position.set(x, y, z); },",
          "    cameraTarget: (x, y, z) => { camera.lookAt(x, y, z); },",
          "    cameraFov: (fov) => { camera.fov = fov; camera.updateProjectionMatrix(); },",
          "  };",
          "  // The rest pose: what the scene shows before anything steps it, and all it shows under reduced motion.",
          "  motionApply(motion.values, motionTargets);",
        ]
      : []),
    "",
    ...(effects ? [`  const effects = new ScreenEffects(renderer, scene, camera, ${stack}, { palette, reducedMotion: options.reducedMotion === true${ink} });`] : []),
    "  return {",
    "    scene,",
    "    camera,",
    "    ready: Promise.all(loads).then(() => undefined),",
    "    render: (delta) => {",
    "      renderer.getSize(size);",
    "      if (size.y > 0 && Math.abs(camera.aspect - size.x / size.y) > 1e-6) {",
    "        camera.aspect = size.x / size.y;",
    "        camera.updateProjectionMatrix();",
    "      }",
    ...(effects ? ["      effects.setSize();", "      effects.render(delta);"] : ["      renderer.render(scene, camera);"]),
    "    },",
    ...(motion ? ["    advance: (seconds: number, input: MotionInput = {}) => {", "      motion.step(seconds, input);", "      motionApply(motion.values, motionTargets);", "    },"] : []),
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
