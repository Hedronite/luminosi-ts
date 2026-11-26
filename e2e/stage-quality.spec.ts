import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { builds, expect, expectRenderer, settledBuilds, test } from "./fixtures.js";

// The stage controls (room, quality, shadows, bloom, depth of field, tone mapping, exposure) write to a stage that is already built:
// nothing is built again. Each switch below must also show that it did something (the scene graph, the render targets or the picture),
// so a control wired to nothing fails as surely as one that rebuilds. The shadow catcher is the one thing a switch adds: a mesh, its
// geometry and its material, freed again when it goes.

const number = async (host: Locator, attribute: string): Promise<number> => Number(await host.getAttribute(attribute));

const errorsOn = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

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

interface StageState {
  /** The `uuid` of the environment texture the stage is lit by, or "" for none. */
  readonly room: string;
  readonly keyCasts: boolean;
  readonly casting: number;
  readonly catchers: number;
  /** Every mesh but the catcher, with its material: `mesh uuid:material uuid`, sorted. */
  readonly meshes: readonly string[];
}

/**
 * The stage's own scene as three holds it: the one with a light named `key` and a mesh. A page can hold other stages (the playground's
 * material lineup has a key light too), so `holding` narrows to the scene that has an object of that name.
 */
const stateOf = (page: Page, holding?: string): Promise<StageState> =>
  page.evaluate((name) => {
    const get = (target: unknown, key: string): unknown => (typeof target === "object" && target !== null ? Reflect.get(target, key) : undefined);
    const call = (target: unknown, key: string, ...args: readonly unknown[]): unknown => {
      const method = get(target, key);
      return typeof method === "function" ? Reflect.apply(method, target, args) : undefined;
    };
    const scenes: unknown = Reflect.get(window, "watchedScenes");
    let found = { room: "", keyCasts: false, casting: 0, catchers: 0, meshes: new Array<string>() };
    for (const scene of Array.isArray(scenes) ? scenes : []) {
      if (get(scene, "isScene") !== true || get(scene, "name") === "RoomEnvironment") continue;
      if (name !== null && call(scene, "getObjectByName", name) === undefined) continue;
      const key = call(scene, "getObjectByName", "key");
      if (key === undefined) continue;
      const state = { room: "", keyCasts: get(key, "castShadow") === true, casting: 0, catchers: 0, meshes: new Array<string>() };
      const environment = get(scene, "environment");
      if (environment !== null && environment !== undefined) state.room = String(get(environment, "uuid"));
      call(scene, "traverse", (node: unknown) => {
        if (get(node, "isMesh") !== true) return;
        if (get(node, "name") === "shadow-catcher") state.catchers += 1;
        else {
          state.meshes.push(`${String(get(node, "uuid"))}:${String(get(get(node, "material"), "uuid"))}`);
          if (get(node, "castShadow") === true) state.casting += 1;
        }
      });
      if (state.meshes.length > 0) found = { ...state, meshes: state.meshes.sort() };
    }
    return found;
  }, holding ?? null);

const picture = (host: Locator): Promise<Buffer> => host.locator("canvas").screenshot();

/** The render targets and the frames once the stage has held both for a few reports. */
async function settled(host: Locator): Promise<number> {
  let last = "";
  let steady = 0;
  await expect
    .poll(
      async () => {
        await host.page().waitForTimeout(300);
        const now = `${String(await number(host, "data-frames"))} ${String(await number(host, "data-targets"))}`;
        steady = now === last ? steady + 1 : 0;
        last = now;
        return steady;
      },
      { message: "the stage settles", timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(2);
  return number(host, "data-targets");
}

/** Makes one change, waits for the frame it draws, and holds the builds where they were. */
async function inPlace(host: Locator, what: string, built: number, act: () => Promise<unknown>, repaints = true): Promise<void> {
  await settled(host);
  const before = await picture(host);
  const frames = await number(host, "data-frames");
  await act();
  await expect.poll(async () => number(host, "data-frames"), { message: `a frame after ${what}` }).toBeGreaterThan(frames);
  if (repaints) await expect.poll(async () => (await picture(host)).equals(before), { message: `a new picture after ${what}` }).toBe(false);
  await settled(host);
  expect(await builds(host), `builds after ${what}`).toBe(built);
}

interface Staged {
  readonly name: string;
  readonly path: string;
  readonly host: (page: Page) => Locator;
  /** The name of an object only this stage's scene holds, when the page has other stages. */
  readonly holding?: string;
}

const staged: readonly Staged[] = [
  { name: "the playground", path: "/?view=playground", host: (page) => page.getByTestId("playground-viewport"), holding: "scene" },
  { name: "a material's detail view", path: "/?asset=metal", host: (page) => page.getByRole("dialog", { name: "Metal" }).getByTestId("viewport") },
];

const room = (page: Page): Locator => page.getByLabel("Room", { exact: true });
const quality = (page: Page): Locator => page.getByLabel("Quality", { exact: true });
const tone = (page: Page): Locator => page.getByLabel("Tone mapping", { exact: true });
const exposure = (page: Page): Locator => page.getByRole("slider", { name: /^Exposure/ });
const box = (page: Page, name: string): Locator => page.getByRole("checkbox", { name, exact: true });

async function open(page: Page, stage: Staged): Promise<Locator> {
  await page.goto(stage.path);
  const host = stage.host(page);
  // A stage below the fold draws nothing until it is in view.
  await host.scrollIntoViewIfNeeded();
  await expectRenderer(host.locator("canvas"));
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 20_000 });
  return host;
}

for (const stage of staged) {
  test(`${stage.name} changes room, tone mapping, exposure and look in place`, async ({ page }) => {
    test.slow();
    const errors = errorsOn(page);
    await watchScenes(page);
    const host = await open(page, stage);
    const built = await settledBuilds(host);
    const read = (): Promise<StageState> => stateOf(page, stage.holding);
    const first = await read();
    expect(first.meshes.length, "the stage's own meshes are found").toBeGreaterThan(0);

    const rooms = [first.room];
    for (const kind of ["gallery", "dusk", "noir"]) {
      // eslint-disable-next-line no-await-in-loop -- one room after another, each read on its own
      await inPlace(host, `the ${kind} room`, built, () => room(page).selectOption(kind));
      // eslint-disable-next-line no-await-in-loop -- see above
      rooms.push((await read()).room);
    }
    expect(new Set(rooms).size, "four rooms, four environments").toBe(4);
    await inPlace(host, "the studio again", built, () => room(page).selectOption("studio"));

    await inPlace(host, "a full stage", built, () => quality(page).selectOption("full"), false);
    for (const mode of ["agx", "neutral", "aces"]) {
      // eslint-disable-next-line no-await-in-loop -- one mapping after another
      await inPlace(host, `${mode} tone mapping`, built, () => tone(page).selectOption(mode));
    }
    await inPlace(host, "the look's own tone mapping", built, () => tone(page).selectOption(""), false);
    await inPlace(host, "a brighter exposure", built, () => exposure(page).fill("2.4"));
    await inPlace(host, "the look's exposure", built, () => page.getByRole("button", { name: "Use the look's exposure" }).click());

    await inPlace(host, "no stage", built, () => quality(page).selectOption("off"), false);
    await inPlace(host, "the hedronite look", built, () => page.getByLabel("Look").selectOption("hedronite"));
    await inPlace(host, "the neutral look", built, () => page.getByLabel("Look").selectOption("neutral"));
    expect((await read()).meshes, "the same meshes and materials from first to last").toEqual(first.meshes);
    expect(errors).toEqual([]);
  });

  test(`${stage.name} changes shadows, bloom, depth of field and the quality tier in place`, async ({ page }) => {
    test.slow();
    const errors = errorsOn(page);
    await watchScenes(page);
    const host = await open(page, stage);
    const built = await settledBuilds(host);
    const read = (): Promise<StageState> => stateOf(page, stage.holding);
    const first = await read();
    expect(first.meshes.length, "the stage's own meshes are found").toBeGreaterThan(0);
    await inPlace(host, "a full stage", built, () => quality(page).selectOption("full"), false);

    await inPlace(host, "shadows on", built, () => box(page, "Shadows").check(), false);
    await expect.poll(async () => (await read()).keyCasts, { message: "the key light casts" }).toBe(true);
    expect((await read()).casting, "every mesh casts").toBe(first.meshes.length);
    await inPlace(host, "shadows off", built, () => box(page, "Shadows").uncheck(), false);
    await expect.poll(async () => (await read()).keyCasts).toBe(false);
    expect((await read()).casting).toBe(0);

    const plain = await settled(host);
    // Bloom takes only what is brighter than its threshold, which may be nothing here: its targets say it runs.
    await inPlace(host, "bloom on", built, () => box(page, "Bloom").check(), false);
    const bloomed = await settled(host);
    expect(bloomed, "bloom draws into render targets of its own").toBeGreaterThan(plain);
    await inPlace(host, "depth of field on", built, () => box(page, "Depth of field").check());
    expect(await settled(host)).toBeGreaterThan(bloomed);

    // Lite keeps the lighting and the tone mapping, and turns the rest off, their targets with them.
    await box(page, "Shadows").check();
    await expect.poll(async () => (await read()).keyCasts).toBe(true);
    await inPlace(host, "lite", built, () => quality(page).selectOption("lite"));
    await expect.poll(async () => (await read()).keyCasts, { message: "lite casts no shadow" }).toBe(false);
    expect(await settled(host), "lite holds no bloom or depth-of-field targets").toBe(plain);
    for (const name of ["Shadows", "Bloom", "Depth of field"]) {
      // eslint-disable-next-line no-await-in-loop -- three controls, read one by one
      await expect(box(page, name)).toBeDisabled();
    }
    await inPlace(host, "full again", built, () => quality(page).selectOption("full"));
    await expect.poll(async () => (await read()).keyCasts, { message: "full restores what was chosen" }).toBe(true);
    await box(page, "Bloom").uncheck();
    await box(page, "Depth of field").uncheck();
    await box(page, "Shadows").uncheck();
    await inPlace(host, "no stage", built, () => quality(page).selectOption("off"), false);
    expect((await read()).meshes, "the same meshes and materials from first to last").toEqual(first.meshes);
    expect(errors).toEqual([]);
  });

  test(`${stage.name}'s shadow catcher adds its mesh, geometry and material, nothing else, and frees them`, async ({ page }) => {
    test.slow();
    const errors = errorsOn(page);
    await watchScenes(page);
    const host = await open(page, stage);
    await settledBuilds(host);
    const read = (): Promise<StageState> => stateOf(page, stage.holding);
    await quality(page).selectOption("full");
    await box(page, "Shadows").check();
    await settled(host);
    const built = await settledBuilds(host);
    const geometries = await number(host, "data-geometries");
    const { meshes } = await read();

    // A mesh, a plane and a shadow material: three more, and a second catcher is another three, since the first was freed.
    for (const round of [1, 2]) {
      // eslint-disable-next-line no-await-in-loop -- the second round starts from what the first left
      await inPlace(host, `the catcher on, round ${String(round)}`, built + 3 * round, () => box(page, "Shadow catcher").check());
      // eslint-disable-next-line no-await-in-loop -- see above
      const on = await read();
      expect(on.catchers).toBe(1);
      expect(on.meshes, "no node is built again").toEqual(meshes);
      // eslint-disable-next-line no-await-in-loop -- see above
      await inPlace(host, `the catcher off, round ${String(round)}`, built + 3 * round, () => box(page, "Shadow catcher").uncheck());
      // eslint-disable-next-line no-await-in-loop -- see above
      expect((await read()).catchers).toBe(0);
      // eslint-disable-next-line no-await-in-loop -- see above
      await expect.poll(async () => number(host, "data-geometries"), { message: "the catcher's geometry is freed" }).toBe(geometries);
    }
    expect(errors).toEqual([]);
  });
}

/** The playground's stage with every feature on. */
async function everything(page: Page): Promise<void> {
  await quality(page).selectOption("full");
  for (const name of ["Shadows", "Shadow catcher", "Bloom", "Depth of field"]) {
    // eslint-disable-next-line no-await-in-loop -- one control at a time: the catcher is enabled once shadows are
    await box(page, name).check();
  }
  await room(page).selectOption("noir");
}

/** The frame count, once it has held still for `quiet` ms. A stage that never stops drawing fails here, and says so. */
async function held(host: Locator, quiet = 900): Promise<number> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const before = await number(host, "data-frames");
        await host.page().waitForTimeout(quiet);
        last = await number(host, "data-frames");
        return last - before;
      },
      { message: "the stage stops drawing", timeout: 20_000 },
    )
    .toBe(0);
  return last;
}

test("an animated playground with every stage feature draws nothing out of view, and resumes when it returns", async ({ page }) => {
  test.slow();
  // Narrow, so the stage is not held in view beside the controls.
  await page.setViewportSize({ width: 900, height: 700 });
  const host = await open(page, { name: "playground", path: "/?view=playground", host: (p) => p.getByTestId("playground-viewport") });
  await everything(page);
  await page.getByRole("checkbox", { name: "Smoke" }).check();
  await host.scrollIntoViewIfNeeded();
  const on = await number(host, "data-frames");
  await expect.poll(() => number(host, "data-frames"), { message: "it animates while in view" }).toBeGreaterThan(on + 2);

  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await expect(host).not.toBeInViewport();
  const away = await held(host);
  await page.waitForTimeout(1500);
  expect(await number(host, "data-frames"), "no frames out of view").toBe(away);

  await host.scrollIntoViewIfNeeded();
  await expect.poll(() => number(host, "data-frames")).toBeGreaterThan(away);
});

test.describe("under reduced motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const stage of staged) {
    test(`${stage.name} with every stage feature draws no frames of its own`, async ({ page }) => {
      test.slow();
      const errors = errorsOn(page);
      const host = await open(page, stage);
      await everything(page);
      // An animated screen effect on top, where the stage takes one: it holds still too.
      if (stage.holding !== undefined) await page.getByRole("checkbox", { name: "Smoke" }).check();
      await settled(host);
      const still = await held(host, 1500);
      await page.waitForTimeout(1500);
      expect(await number(host, "data-frames"), "no animation frames").toBe(still);
      await expect(page.getByRole("button", { name: /^(Pause|Resume) motion$/ })).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
});

/** Tabs from wherever focus is until `target` has it, in at most `limit` presses. */
const tabTo = async (page: Page, target: Locator, limit: number): Promise<boolean> => {
  if (limit === 0) return false;
  await page.keyboard.press("Tab");
  if (await target.evaluate((element) => element === document.activeElement)) return true;
  return tabTo(page, target, limit - 1);
};

for (const stage of staged) {
  test(`${stage.name}'s stage controls are labelled, reached by Tab, at least 24 by 24, and pass axe`, async ({ page }) => {
    test.slow();
    await open(page, stage);
    // With a full stage, shadows and an exposure of its own, every control is enabled and on the page.
    await quality(page).selectOption("full");
    await box(page, "Shadows").check();
    await exposure(page).fill("1.5");
    const controls = [
      room(page),
      quality(page),
      box(page, "Shadows"),
      box(page, "Shadow catcher"),
      box(page, "Bloom"),
      box(page, "Depth of field"),
      tone(page),
      exposure(page),
      page.getByRole("button", { name: "Use the look's exposure" }),
    ];
    await controls[0]?.focus();
    for (const [index, control] of controls.entries()) {
      // eslint-disable-next-line no-await-in-loop -- Tab order is a sequence
      if (index > 0) expect(await tabTo(page, control, 3), `control ${String(index)} is the next stop`).toBe(true);
      // eslint-disable-next-line no-await-in-loop -- see above
      const size = await control.boundingBox();
      expect(size?.width ?? 0, `control ${String(index)} width`).toBeGreaterThanOrEqual(24);
      expect(size?.height ?? 0, `control ${String(index)} height`).toBeGreaterThanOrEqual(24);
    }
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
}

test("a scene kit offers a room and quality but no shadows, and shader and effect views offer neither", async ({ page }) => {
  await page.goto("/?asset=scene-studio");
  const kit = page.getByRole("dialog", { name: "Studio" });
  await expect(kit.getByRole("group", { name: "Stage" })).toBeVisible();
  await expect(kit.getByRole("checkbox", { name: "Bloom" })).toHaveCount(1);
  await expect(kit.getByRole("checkbox", { name: /^Shadow/ })).toHaveCount(0);
  for (const [path, name] of [
    ["/?asset=hologram", "Hologram"],
    ["/?asset=dither", "Dither"],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop -- one page at a time
    await page.goto(path);
    // eslint-disable-next-line no-await-in-loop -- see above
    await expectRenderer(page.getByRole("dialog", { name }).getByTestId("viewport").locator("canvas"));
    // eslint-disable-next-line no-await-in-loop -- see above
    await expect(page.getByRole("dialog", { name }).getByRole("group", { name: "Stage" })).toHaveCount(0);
  }
});

// A narrow phone: nothing scrolls sideways, and no control runs past the page's padding (the detail view's box would clip it unseen).
for (const stage of staged) {
  test(`${stage.name}'s stage controls fit a screen 320 px wide`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await open(page, stage);
    await quality(page).selectOption("full");
    for (const control of [room(page), quality(page), box(page, "Bloom"), tone(page), exposure(page)]) {
      // eslint-disable-next-line no-await-in-loop -- read one control at a time
      const at = await control.boundingBox();
      expect((at?.x ?? 0) + (at?.width ?? 321), "the control ends inside the page's padding").toBeLessThanOrEqual(304.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll").toBeLessThanOrEqual(320);
  });
}
