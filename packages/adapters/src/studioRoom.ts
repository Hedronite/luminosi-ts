import { ROOM_SPECS, STUDIO_BLUR, type EnvironmentKind, type RoomColorExpr, type RoomColorToken, type SceneEnvironment } from "@hedronite/lts-scene";
import { BLACK, duskLightTints, hedronite, mixHex, neutral, WHITE, type Hex } from "@hedronite/lts-tokens";
import { BackSide, BoxGeometry, DataTexture, EquirectangularReflectionMapping, Mesh, MeshLambertMaterial, MeshStandardMaterial, PointLight, Scene, type Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export { STUDIO_BLUR } from "@hedronite/lts-scene";

export interface RoomTarget {
  readonly texture: Texture;
  dispose(): void;
}

export interface RoomGenerator {
  fromScene(scene: Scene, sigma: number): RoomTarget;
  fromEquirectangular?(texture: Texture): RoomTarget;
  dispose(): void;
}

export type HdriLoader = (url: string, options?: { readonly signal?: AbortSignal }) => Promise<Texture>;

const TOKEN_HEX: Readonly<Record<RoomColorToken, Hex>> = {
  WHITE,
  BLACK,
  "neutral.ground": neutral.scene.ground,
  "neutral.base": neutral.scene.base,
  "hedronite.sky": hedronite.scene.sky,
  "hedronite.fill": hedronite.scene.fill,
  "dusk.key": duskLightTints.key,
  "dusk.rim": duskLightTints.rim,
  "dusk.ambient": duskLightTints.ambient,
};

const resolveColor = (expr: RoomColorExpr): Hex => (typeof expr === "string" ? TOKEN_HEX[expr] : mixHex(TOKEN_HEX[expr[1]], TOKEN_HEX[expr[2]], expr[3]));

/** Creates one of the four procedural rooms (`studio`, `gallery`, `dusk`, `noir`). */
function createRoom(kind: EnvironmentKind): { readonly scene: Scene & { dispose(): void }; readonly blur: number } {
  if (kind === "studio") return { scene: new RoomEnvironment(), blur: STUDIO_BLUR };
  const spec = ROOM_SPECS[kind];
  const scene = new Scene();
  scene.name = `room-${kind}`;
  scene.position.y = -3.5;

  const geometry = new BoxGeometry();
  geometry.deleteAttribute("uv");
  const wallMat = new MeshStandardMaterial({ color: resolveColor(spec.wall), roughness: spec.roughness, side: BackSide });
  const contactMat = new MeshStandardMaterial({ color: resolveColor(spec.contact), roughness: 1 });
  const materials: (MeshStandardMaterial | MeshLambertMaterial)[] = [wallMat, contactMat];

  const enclosure = new Mesh(geometry, wallMat);
  enclosure.position.set(0, 12, 0);
  enclosure.scale.set(31, 27, 29);
  scene.add(enclosure);

  const contact = new Mesh(geometry, contactMat);
  contact.position.set(0, -1.2, 0);
  contact.scale.set(22, 0.4, 22);
  scene.add(contact);

  const light = new PointLight(resolveColor(spec.point), spec.pointIntensity, 32, 2);
  light.position.set(0.4, 16, 0.3);
  scene.add(light);

  for (const [colorExpr, intensity, x, y, z, sx, sy, sz] of spec.cards) {
    const material = new MeshLambertMaterial({ color: BLACK, emissive: resolveColor(colorExpr), emissiveIntensity: intensity });
    materials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    scene.add(mesh);
  }

  return {
    scene: Object.assign(scene, {
      dispose(): void {
        geometry.dispose();
        for (const material of materials) material.dispose();
      },
    }),
    blur: spec.blur,
  };
}

/** Bakes a procedural room into a PMREM target and frees both the room and generator. */
export function bakeRoom(generator: RoomGenerator, kind: EnvironmentKind = "studio"): RoomTarget {
  const { scene, blur } = createRoom(kind);
  try {
    return generator.fromScene(scene, blur);
  } finally {
    scene.dispose();
    generator.dispose();
  }
}

async function defaultHdriLoader(url: string, options?: { readonly signal?: AbortSignal }): Promise<Texture> {
  const response = await fetch(url, options?.signal === undefined ? {} : { signal: options.signal });
  if (!response.ok) throw new Error(`HDRI load failed (${String(response.status)})`);
  const buffer = await response.arrayBuffer();
  const { HDRLoader } = await import("three/examples/jsm/loaders/HDRLoader.js");
  const texture = new HDRLoader().createDataTexture(buffer);
  if (texture instanceof DataTexture) {
    texture.mapping = EquirectangularReflectionMapping;
    texture.needsUpdate = true;
  }
  return texture;
}

/** Resolves an environment descriptor (optional CC0 HDRI with graceful fallback to procedural room). */
export async function bakeEnvironmentTarget(
  generator: RoomGenerator,
  environment: Pick<SceneEnvironment, "kind" | "hdri">,
  options: { readonly hdriLoader?: HdriLoader; readonly signal?: AbortSignal } = {},
): Promise<{ readonly target: RoomTarget; readonly source: "procedural" | "hdri"; readonly fallbackError?: unknown }> {
  if (environment.hdri !== undefined && generator.fromEquirectangular !== undefined) {
    const loader = options.hdriLoader ?? defaultHdriLoader;
    let equirectangular: Texture | undefined;
    try {
      equirectangular = await loader(environment.hdri.url, options.signal === undefined ? {} : { signal: options.signal });
      if (options.signal?.aborted) {
        equirectangular.dispose();
        generator.dispose();
        throw new Error("environment load aborted");
      }
      const target = generator.fromEquirectangular(equirectangular);
      equirectangular.dispose();
      generator.dispose();
      return { target, source: "hdri" };
    } catch (error) {
      equirectangular?.dispose();
      if (options.signal?.aborted) {
        generator.dispose();
        throw error;
      }
      return { target: bakeRoom(generator, environment.kind), source: "procedural", fallbackError: error };
    }
  }
  return { target: bakeRoom(generator, environment.kind), source: "procedural" };
}
