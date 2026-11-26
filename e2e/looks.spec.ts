import type { Locator, Page } from "@playwright/test";
import { presets, sceneLighting, type SceneLightRole } from "../packages/tokens/src/index.js";
import { builds, expect, expectRenderer, settledBuilds, test } from "./fixtures.js";

// A change of look is a write to colors and uniforms: nothing on the GPU is rebuilt. Each stage below holds the same
// geometries and the same shader programs across three looks, keeps drawing, and shows a different picture.

const number = async (host: Locator, attribute: string): Promise<number> => Number(await host.getAttribute(attribute));

/** The picture, as bytes: held still first, so a difference is the look and nothing else. */
const picture = (host: Locator): Promise<Buffer> => host.locator("canvas").screenshot();

/** Waits until the stage has built everything it will (the geometry count has held for two samples). */
async function settled(host: Locator): Promise<void> {
  let last = -1;
  let steady = 0;
  await expect
    .poll(
      async () => {
        await host.page().waitForTimeout(500);
        const now = await number(host, "data-gpu-geometries");
        steady = now === last && now > 0 ? steady + 1 : 0;
        last = now;
        return steady;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(2);
}

/** Switches the look through each of `looks` in turn, and checks the GPU holds the same geometries, programs and builds, and draws a new picture, after every one. */
async function expectLooksInPlace(page: Page, host: Locator, looks: readonly string[]): Promise<void> {
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15_000 });
  await settled(host);
  const built = await settledBuilds(host);
  // An animated stage is held, so only the look can change the picture.
  const pause = page.getByRole("button", { name: "Pause motion" });
  if (await pause.isVisible()) {
    await pause.click();
    await expect(page.getByRole("button", { name: "Resume motion" })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await builds(host), "builds after a pause").toBe(built);
  }
  const geometries = await number(host, "data-gpu-geometries");
  const programs = await number(host, "data-programs");
  expect(geometries).toBeGreaterThan(0);
  expect(programs).toBeGreaterThan(0);
  await looks.reduce<Promise<Buffer>>(async (before, look) => {
    const was = await before;
    const frames = await number(host, "data-frames");
    await page.getByLabel("Look").selectOption(look);
    await expect(page.locator("html")).toHaveAttribute("data-preset", look);
    await expect.poll(async () => number(host, "data-frames"), { message: `a frame after ${look}` }).toBeGreaterThan(frames);
    await page.waitForTimeout(600);
    expect(await number(host, "data-gpu-geometries"), `geometries after ${look}`).toBe(geometries);
    expect(await number(host, "data-programs"), `programs after ${look}`).toBe(programs);
    expect(await builds(host), `builds after ${look}`).toBe(built);
    const now = await picture(host);
    expect(now.equals(was), `the picture after ${look}`).toBe(false);
    return now;
  }, picture(host));
}

const looks = ["hedronite", "tokyo-night", "hedron-light"] as const;

test("the playground keeps its geometry and programs across looks: solids, the watch, a surface shader and the print effects", async ({ page }) => {
  await page.goto("/?view=playground");
  const scene = page.getByRole("list", { name: "Scene" }).getByRole("listitem");
  await expect(scene).toHaveCount(3);
  await page.getByLabel("Add", { exact: true }).selectOption("framed");
  await page.getByLabel("Primitive", { exact: true }).selectOption("catalan-rhombic-triacontahedron");
  await page.getByRole("button", { name: "Add to scene" }).click();
  await page.getByLabel("Add", { exact: true }).selectOption("object");
  await page.getByLabel("Object", { exact: true }).selectOption("dress-watch");
  await page.getByRole("button", { name: "Add to scene" }).click();
  await page.getByLabel("Add", { exact: true }).selectOption("primitive");
  await page.getByLabel("Primitive", { exact: true }).selectOption("platonic-icosahedron");
  await page.getByLabel("Surface", { exact: true }).selectOption("shader:dissolve");
  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(scene).toHaveCount(6);
  await page.getByRole("checkbox", { name: "Dither" }).check();
  await expectLooksInPlace(page, page.getByTestId("playground-viewport"), looks);
  await expectRenderer(page.getByTestId("playground-viewport").locator("canvas"));
});

test("a surface shader's detail view recolors in place", async ({ page }) => {
  await page.goto("/?asset=hologram");
  await expectLooksInPlace(page, page.getByRole("dialog", { name: "Hologram" }).getByTestId("viewport"), looks);
  await expectRenderer(page.getByRole("dialog", { name: "Hologram" }).getByTestId("viewport").locator("canvas"));
});

test("a material's detail view recolors in place", async ({ page }) => {
  await page.goto("/?asset=metal");
  await expectLooksInPlace(page, page.getByRole("dialog", { name: "Metal" }).getByTestId("viewport"), looks);
  await expectRenderer(page.getByRole("dialog", { name: "Metal" }).getByTestId("viewport").locator("canvas"));
});

test("a scene kit's detail view recolors in place, its lights and materials with no rebuild", async ({ page }) => {
  await page.goto("/?asset=scene-dusk");
  await expectLooksInPlace(page, page.getByRole("dialog", { name: "Dusk" }).getByTestId("viewport"), looks);
  await expectRenderer(page.getByRole("dialog", { name: "Dusk" }).getByTestId("viewport").locator("canvas"));
});

test("the material lineup recolors in place: the same geometry and programs, a new picture", async ({ page }) => {
  await page.goto("/?view=playground");
  const lineup = page.getByTestId("material-lineup");
  await expectRenderer(lineup.locator("canvas"));
  await lineup.scrollIntoViewIfNeeded();
  await expectLooksInPlace(page, lineup, looks);
});

test("the Effects stage recolors its subject and prints in place", async ({ page }) => {
  await page.goto("/?view=effects");
  await expectLooksInPlace(page, page.getByTestId("effects-stage"), looks);
});

// A new picture does not say what changed it: materials alone would draw one over lights still in the old look. So the
// stages below are read from three itself, light by light and material by material, against the look's own tokens.

type SceneColor = "base" | "accent" | "metal" | "glass";

/** Which scene color each material preset on these stages takes. */
const materialColor = { matte: "base", ceramic: "base", satin: "accent", metal: "metal", glass: "glass" } as const satisfies Record<string, SceneColor>;

/** A light by its three.js type and the lighting token it takes; a hemisphere light takes a second one for the ground. */
type LightToken = readonly [type: string, color: SceneLightRole, ground?: SceneLightRole];

interface Lit {
  readonly lights: readonly LightToken[];
  readonly materials: readonly (keyof typeof materialColor)[];
}

const threePoint: readonly LightToken[] = [
  ["DirectionalLight", "key"],
  ["DirectionalLight", "fill"],
  ["DirectionalLight", "rim"],
  ["AmbientLight", "ambient"],
];

interface Painted {
  readonly id: string;
  readonly what: string;
  readonly color: string;
}

interface Colors {
  readonly lights: readonly Painted[];
  readonly materials: readonly Painted[];
}

/** Keeps every `Scene` three makes: three announces each one to `__THREE_DEVTOOLS__` when that exists. Call before the page loads. */
async function watchScenes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scenes: unknown[] = [];
    const hook = new EventTarget();
    hook.addEventListener("observe", (event) => {
      if (event instanceof CustomEvent) scenes.push(event.detail);
    });
    Object.assign(window, { __THREE_DEVTOOLS__: hook, watchedScenes: scenes });
  });
}

/** Every light, and every mesh's material, in the page's scenes now: `uuid`, what it is, and its color as `#rrggbb`. The environment's baking room is not a stage. */
const colorsOn = (page: Page): Promise<Colors> =>
  page.evaluate(() => {
    const get = (target: unknown, key: string): unknown => (typeof target === "object" && target !== null ? Reflect.get(target, key) : undefined);
    const call = (target: unknown, key: string, ...args: readonly unknown[]): unknown => {
      const method = get(target, key);
      return typeof method === "function" ? Reflect.apply(method, target, args) : undefined;
    };
    const hex = (color: unknown): string => `#${String(call(color, "getHexString"))}`;
    const lights = new Map<string, { id: string; what: string; color: string }>();
    const materials = new Map<string, { id: string; what: string; color: string }>();
    const scenes: unknown = Reflect.get(window, "watchedScenes");
    for (const scene of Array.isArray(scenes) ? scenes : []) {
      if (get(scene, "isScene") !== true || get(scene, "name") === "RoomEnvironment") continue;
      call(scene, "traverse", (node: unknown) => {
        const id = String(get(node, "uuid"));
        if (get(node, "isLight") === true) {
          const ground = get(node, "groundColor");
          const color = ground === undefined ? hex(get(node, "color")) : `${hex(get(node, "color"))} over ${hex(ground)}`;
          lights.set(id, { id, what: String(get(node, "type")), color });
        } else if (get(node, "isMesh") === true) {
          const material = get(node, "material");
          const own = String(get(material, "uuid"));
          materials.set(own, { id: own, what: String(get(material, "name")), color: hex(get(material, "color")) });
        }
      });
    }
    return { lights: [...lights.values()], materials: [...materials.values()] };
  });

/** What a stage's lights and materials should read under look `id`, as `what color`, in the order the stage adds them. */
function tokensFor(id: string, stage: Lit): { readonly lights: readonly string[]; readonly materials: readonly string[] } {
  const preset = presets.find((each) => each.id === id);
  if (preset === undefined) throw new Error(`no look "${id}"`);
  const lighting = sceneLighting(preset.scene);
  return {
    lights: stage.lights.map(([type, role, ground]) => `${type} ${lighting[role]}${ground === undefined ? "" : ` over ${lighting[ground]}`}`.toLowerCase()),
    materials: stage.materials.map((name) => `${name} ${preset.scene[materialColor[name]]}`.toLowerCase()),
  };
}

const read = (painted: readonly Painted[]): string[] => painted.map(({ what, color }) => `${what} ${color}`.toLowerCase());
const ids = (colors: Colors): readonly (readonly string[])[] => [colors.lights.map((light) => light.id), colors.materials.map((material) => material.id)];

/**
 * Takes a stage from the neutral look through three others and back. After each, every light and material reads that
 * look's tokens, they are the same objects as before (`uuid`), and the stage has built nothing more (`data-builds`).
 */
async function expectLightsAndMaterialsInPlace(page: Page, host: Locator, stage: Lit, pick: (look: string) => Promise<void>): Promise<void> {
  const looks = ["hedronite", "tokyo-night", "hedron-light", "neutral"];
  // The check says something only if every light and every material takes another color somewhere along the way.
  const wanted = ["neutral", ...looks].map((look) => tokensFor(look, stage));
  for (const index of stage.lights.keys()) expect(new Set(wanted.map((each) => each.lights[index])).size, `light ${String(index)} differs between looks`).toBeGreaterThan(1);
  for (const index of stage.materials.keys()) expect(new Set(wanted.map((each) => each.materials[index])).size, `material ${String(index)} differs between looks`).toBeGreaterThan(1);

  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 20_000 });
  const built = await settledBuilds(host);
  await expect.poll(async () => read((await colorsOn(page)).lights), { message: "lights in the neutral look" }).toEqual(tokensFor("neutral", stage).lights);
  await expect.poll(async () => read((await colorsOn(page)).materials), { message: "materials in the neutral look" }).toEqual(tokensFor("neutral", stage).materials);
  const first = ids(await colorsOn(page));
  await looks.reduce<Promise<void>>(async (before, look) => {
    await before;
    const frames = await number(host, "data-frames");
    await pick(look);
    await expect.poll(async () => read((await colorsOn(page)).lights), { message: `lights under ${look}` }).toEqual(tokensFor(look, stage).lights);
    await expect.poll(async () => read((await colorsOn(page)).materials), { message: `materials under ${look}` }).toEqual(tokensFor(look, stage).materials);
    await expect.poll(async () => number(host, "data-frames"), { message: `a frame after ${look}` }).toBeGreaterThan(frames);
    expect(ids(await colorsOn(page)), `the same lights and materials under ${look}`).toEqual(first);
    expect(await builds(host), `builds after ${look}`).toBe(built);
  }, Promise.resolve());
}

const kits: readonly (Lit & { readonly asset: string; readonly name: string })[] = [
  { asset: "scene-studio", name: "Studio", lights: threePoint, materials: ["matte", "satin"] },
  {
    asset: "scene-gallery",
    name: "Gallery",
    lights: [
      ["HemisphereLight", "sky", "ground"],
      ["DirectionalLight", "key"],
    ],
    materials: ["matte", "ceramic", "satin"],
  },
];

for (const kit of kits) {
  test(`the catalog's ${kit.name} scene takes each look's tokens in its lights and materials, with no rebuild`, async ({ page }) => {
    await watchScenes(page);
    await page.goto(`/?asset=${kit.asset}`);
    const host = page.getByRole("dialog", { name: kit.name }).getByTestId("viewport");
    await expectLightsAndMaterialsInPlace(page, host, kit, async (look) => {
      await page.getByLabel("Look").selectOption(look);
      await expect(page.locator("html")).toHaveAttribute("data-preset", look);
    });
  });
}

test("the site's scene element takes each look's tokens in its lights and materials, with no rebuild", async ({ page }) => {
  await watchScenes(page);
  await page.goto(process.env["E2E_SITE_URL"] ?? "http://localhost:4174");
  const host = page.getByTestId("island").locator("lts-scene");
  await host.scrollIntoViewIfNeeded();
  await expect(host).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expectLightsAndMaterialsInPlace(page, host, { lights: threePoint, materials: ["metal", "glass", "satin"] }, async (look) => {
    // The page has no picker of its own: its look is `data-preset` on the root, which its script mirrors onto the element.
    await page.evaluate((id) => {
      document.documentElement.dataset["preset"] = id;
    }, look);
    await expect(host).toHaveAttribute("look", look);
  });
});
