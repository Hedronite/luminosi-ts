import type { Scene, SceneNode } from "../schema.js";
import { assetScale, creditExport, creditHeader, forest, importLine, literal, lookSource, names, num, vec, type Entry, type EmitOptions } from "./common.js";

/** A JSX attribute value: a plain string as it is, anything else as an expression. */
const text = (value: string): string => (/^[^"\\&<>{}\r\n]*$/.test(value) ? `"${value}"` : `{${JSON.stringify(value)}}`);

/** The attributes that say what a node's asset is made of. */
function assetAttributes(node: SceneNode): readonly string[] {
  const { asset, surface } = node;
  const surfaceAttributes = (face: "material" | "faces"): string[] => {
    if (surface === undefined) return [];
    const shaderParams = surface.params === undefined ? [] : [`shaderParams={${literal(surface.params)}}`];
    return "shader" in surface ? [`shader=${text(surface.shader)}`, ...shaderParams] : [`${face}=${text(surface.material)}`];
  };
  switch (asset.kind) {
    case "primitive":
      return [`primitive=${text(asset.id)}`, ...surfaceAttributes("material"), "palette={palette}"];
    case "framed":
      return [`primitive=${text(asset.id)}`, ...surfaceAttributes("faces"), `edges=${text(asset.edges.material)}`, "palette={palette}"];
    case "object":
      return [`object=${text(asset.id)}`, ...(asset.params === undefined ? [] : [`params={${literal(asset.params)}}`]), "palette={palette}"];
  }
}

const tagOf = (node: SceneNode): string => (node.asset.kind === "primitive" ? "PrimitiveMesh" : node.asset.kind === "framed" ? "FramedSolid" : "LibraryObject");

const placement = (node: SceneNode, scale: readonly number[]): readonly string[] => [`position={${vec(node.position)}}`, `rotation={${vec(node.rotation)}}`, `scale={${vec(scale)}}`];

/** One node, and what stands under it. A node with children is a group that carries its transform, so they follow it; the rest carry it themselves. */
function lines(entries: readonly Entry[], at: number, depth: number): readonly string[] {
  const entry = entries[at];
  if (entry === undefined) return [];
  const { node } = entry;
  const pad = "  ".repeat(depth);
  const name = `name=${text(node.id)}`;
  const grown = assetScale(node);
  if (entry.children.length === 0) {
    const scale = grown === undefined ? node.scale : node.scale.map((axis) => axis * grown);
    return [`${pad}<${tagOf(node)} ${[...assetAttributes(node), ...placement(node, scale), name].join(" ")} />`];
  }
  return [
    `${pad}<group ${[name, ...placement(node, node.scale)].join(" ")}>`,
    `${pad}  <${tagOf(node)} ${[...assetAttributes(node), ...(grown === undefined ? [] : [`scale={${num(grown)}}`])].join(" ")} />`,
    ...entry.children.flatMap((child) => lines(entries, child, depth + 1)),
    `${pad}</group>`,
  ];
}

/**
 * The document as React Three Fiber code over `@hedronite/lts-adapters`, on `WebGPUCanvas`: the WebGPU renderer (with its
 * WebGL 2 fallback) runs surface shaders, screen effects and materials alike. Equal documents give equal text. A node
 * never appears as a name in the code (a string on the component, nothing more), so any id is safe. Given `credits` (what
 * `creditsFor` finds), the module opens with a `//` line for each and exports them as `credits`; given none, the text is as it
 * was before credits existed.
 */
export function toTsx(scene: Scene, options: EmitOptions = {}): string {
  const credits = options.credits ?? [];
  const entries = forest(scene);
  const look = lookSource(scene.look);
  const effects = scene.effects.length > 0;
  const components = [...new Set(["StudioLights", ...entries.map(({ node }) => tagOf(node))])].sort();
  const webgpu = ["WebGPUCanvas", "WebGPUStudioEnvironment", ...(effects ? ["ScreenEffectsPass"] : [])].sort();
  const ink = effects && scene.ink !== "look" ? ` monochrome={palette.${scene.ink}}` : "";
  const [x, y, z] = scene.camera.target;
  const lookAt = x === 0 && y === 0 && z === 0 ? "" : ` onCreated={({ camera }) => {\n        camera.lookAt(${num(x)}, ${num(y)}, ${num(z)});\n      }}`;
  return [
    "// Generated from a scene document: change the document and generate this again.",
    ...creditHeader(credits),
    importLine(names(components), "@hedronite/lts-adapters"),
    importLine(names(webgpu), "@hedronite/lts-adapters/webgpu"),
    importLine(names(look.values, look.types), "@hedronite/lts-tokens"),
    "",
    ...look.lines,
    ...(credits.length === 0 ? [] : ["", ...creditExport(credits)]),
    ...(effects ? ["", "// Defined once, outside the component: a new array would rebuild the passes.", `const effects = [${scene.effects.map((effect) => (effect.params === undefined ? `{ id: ${JSON.stringify(effect.id)} }` : `{ id: ${JSON.stringify(effect.id)}, params: ${literal(effect.params)} }`)).join(", ")}] as const;`] : []),
    "",
    effects ? "export function Scene({ reducedMotion = false }: { readonly reducedMotion?: boolean }) {" : "export function Scene() {",
    "  return (",
    `    <WebGPUCanvas camera={{ position: ${vec(scene.camera.position)}, fov: ${num(scene.camera.fov)}, near: 0.1, far: 100 }}${lookAt}>`,
    "      <WebGPUStudioEnvironment />",
    `      <StudioLights intensity={${num(scene.lights.intensity)}} />`,
    ...entries.flatMap((entry, at) => (entry.parent === -1 ? lines(entries, at, 3) : [])),
    ...(effects ? [`      <ScreenEffectsPass effects={effects} palette={palette} reducedMotion={reducedMotion}${ink} />`] : []),
    "    </WebGPUCanvas>",
    "  );",
    "}",
    "",
  ].join("\n");
}
