// The asset pipeline: assets/src/models/*.json (scene descriptions) → optimized .glb + a budget report.
// Source art is data, so the repo holds no binaries; outputs land in dist/ and are rebuilt, never edited.
//   flatten + join  → one draw call per material
//   weld + quantize → indexed, compact vertex data
//   meshopt         → EXT_meshopt_compression, decoded in the browser by three's bundled decoder
// Fails (exit 1) when any asset is over its budget in assets/budgets.json.
import { brotliCompressSync } from "node:zlib";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Document, WebIO, type Primitive } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { flatten, join as joinPrimitives, meshopt, quantize, weld } from "@gltf-transform/functions";
import { crystalCluster } from "@hedronite/lts-objects";
import { bipyramid, triangulate, type Vec3 } from "@hedronite/lts-primitives";
import { MeshoptEncoder } from "meshoptimizer";
import { z } from "zod";

const root = resolve(import.meta.dirname, "../../..");
const sourceDir = join(root, "assets/src/models");
const outDir = join(import.meta.dirname, "../dist");

const sceneSchema = z
  .object({
    generator: z.literal("crystal-cluster"),
    options: z.object({ count: z.number().int(), spread: z.number(), seed: z.number().int() }).strict(),
    material: z.object({ name: z.string(), color: z.string().regex(/^#[0-9a-f]{6}$/i), roughness: z.number(), metalness: z.number() }).strict(),
  })
  .strict();
const budgetsSchema = z.record(z.string(), z.object({ triangles: z.number(), drawCalls: z.number(), brotliBytes: z.number() }).strict());

/** sRGB hex to the linear RGB that glTF's baseColorFactor expects. */
const linearRgb = (hex: string): [number, number, number] => {
  const channel = (i: number): number => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(1), channel(2)];
};

/** The rotation taking +Y onto `axis` (unit), as an x, y, z, w quaternion. */
const fromUp = ([x, y, z]: Vec3): [number, number, number, number] => {
  const w = 1 + y;
  if (w < 1e-9) return [1, 0, 0, 0];
  const n = Math.hypot(z, w, x);
  return [z / n, 0, -x / n, w / n];
};

function buildDocument(scene: z.infer<typeof sceneSchema>): Document {
  const document = new Document();
  const buffer = document.createBuffer();
  const material = document
    .createMaterial(scene.material.name)
    .setBaseColorFactor([...linearRgb(scene.material.color), 1])
    .setRoughnessFactor(scene.material.roughness)
    .setMetallicFactor(scene.material.metalness);
  const meshes = new Map<number, ReturnType<Document["createMesh"]>>();
  const meshFor = (sides: number): ReturnType<Document["createMesh"]> => {
    const known = meshes.get(sides);
    if (known !== undefined) return known;
    const { positions, normals } = triangulate(bipyramid(sides, { radius: 1, height: 1 }));
    const primitive: Primitive = document
      .createPrimitive()
      .setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer))
      .setAttribute("NORMAL", document.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer))
      .setMaterial(material);
    const mesh = document.createMesh(`bipyramid-${String(sides)}`).addPrimitive(primitive);
    meshes.set(sides, mesh);
    return mesh;
  };
  const sceneNode = document.createScene();
  crystalCluster(scene.options).forEach((crystal, i) => {
    sceneNode.addChild(
      document
        .createNode(`crystal-${String(i)}`)
        .setMesh(meshFor(crystal.sides))
        .setTranslation([...crystal.position])
        .setRotation(fromUp(crystal.axis))
        .setScale([crystal.radius, crystal.height, crystal.radius]),
    );
  });
  return document;
}

interface Report {
  readonly triangles: number;
  readonly drawCalls: number;
  readonly bytes: number;
  readonly brotliBytes: number;
}

function measure(document: Document): Pick<Report, "triangles" | "drawCalls"> {
  let triangles = 0;
  let drawCalls = 0;
  for (const node of document.getRoot().listNodes()) {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      drawCalls++;
      const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
      triangles += count / 3;
    }
  }
  return { triangles, drawCalls };
}

await MeshoptEncoder.ready;
const io = new WebIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const budgets = budgetsSchema.parse(JSON.parse(await readFile(join(root, "assets/budgets.json"), "utf8")));
const ids = (await readdir(sourceDir)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)).sort();

await mkdir(join(outDir, "models"), { recursive: true });

async function buildOne(id: string): Promise<readonly [string, Report, readonly string[]]> {
  const scene = sceneSchema.parse(JSON.parse(await readFile(join(sourceDir, `${id}.json`), "utf8")));
  const document = buildDocument(scene);
  await document.transform(flatten(), joinPrimitives({ keepNamed: false }), weld(), quantize(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const glb = await io.writeBinary(document);
  await writeFile(join(outDir, "models", `${id}.glb`), glb);
  const entry: Report = { ...measure(document), bytes: glb.byteLength, brotliBytes: brotliCompressSync(glb).byteLength };
  const budget = budgets[id];
  if (budget === undefined) return [id, entry, [`${id}: no budget in assets/budgets.json`]];
  const over = (["triangles", "drawCalls", "brotliBytes"] as const)
    .filter((key) => entry[key] > budget[key])
    .map((key) => `${id}: ${key} ${String(entry[key])} > budget ${String(budget[key])}`);
  return [id, entry, over];
}

const results = await Promise.all(ids.map(buildOne));
const report = Object.fromEntries(results.map(([id, entry]) => [id, entry]));
await writeFile(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.table(report);
const over = results.flatMap(([, , problems]) => problems);
if (over.length > 0) {
  console.error(`Over budget:\n  ${over.join("\n  ")}`);
  process.exit(1);
}
