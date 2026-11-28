import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { builds, expect, expectRenderer, settledBuilds, test } from "./fixtures.js";

// What every 3D stage owes a viewer who cannot drag or who wants less motion:
//
// - An animated stage has a visible button named "Pause motion" that reads "Resume motion" once
//   pressed. Pausing stops time: the stage's own animation clock (`data-time`, seconds) and its
//   frame counter (`data-frames`) hold still, on a paused stage that redraws for the keyboard too,
//   and resuming carries on from the held value.
// - The stage is a focusable (`tabindex="0"`) `role="group"` with an accessible name and a
//   description that names the keys: arrows orbit, + and - zoom, 0 resets.
// - The stage reports its camera in `data-azimuth` and `data-polar` (degrees) and `data-distance`
//   (scene units), beside `data-frames`, on the element that carries `data-frames`.
// - Under reduced motion nothing animates, so there is nothing to pause and no pause button; the
//   keys still work.

const errorsOn = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

const number = async (host: Locator, attribute: string): Promise<number> => Number(await host.getAttribute(attribute));

/** The frame count once it has held still for `quiet` ms (same bar as stage-quality `held`). */

/** Programs attached and steady: the playground finishes compiling shaders after the first frames land. */
async function programsSettled(host: Locator): Promise<number> {
  let last = -1;
  let steady = 0;
  await expect
    .poll(
      async () => {
        await host.page().waitForTimeout(300);
        const now = await number(host, "data-programs");
        steady = now === last && now > 0 ? steady + 1 : 0;
        last = now;
        return steady;
      },
      { message: "the program count settles before pause", timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(6);
  return last;
}

async function framesHeld(host: Locator, quiet = 900): Promise<number> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const before = await number(host, "data-frames");
        await host.page().waitForTimeout(quiet);
        last = await number(host, "data-frames");
        return last - before;
      },
      { message: "the stage stops drawing after pause", timeout: 20_000 },
    )
    .toBe(0);
  return last;
}

/**
 * The counters of a paused stage. The frame that was in flight when the button was pressed can still land, and on a
 * loaded runner (software WebGL) that takes longer than any fixed wait; so wait until the frame counter has held
 * steady across two samples in a row, then read what it held.
 */
async function heldCounters(host: Locator, steadySamples = 2): Promise<{ readonly frames: number; readonly time: number }> {
  let last = await number(host, "data-frames");
  let steady = 0;
  await expect
    .poll(
      async () => {
        await host.page().waitForTimeout(500);
        const now = await number(host, "data-frames");
        steady = now === last ? steady + 1 : 0;
        last = now;
        return steady;
      },
      { message: "the frame counter settles after a pause", timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(steadySamples);
  return { frames: last, time: await number(host, "data-time") };
}

/** The canvas is on screen for real: opaque all the way up, visible, sized, and nothing sits over its centre. */
async function expectCanvasLive(host: Locator): Promise<void> {
  const canvas = host.locator("canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  await expect
    .poll(async () =>
      canvas.evaluate((element) => {
        let opacity = 1;
        for (let node: Element | null = element; node !== null; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { opacity, visibility: getComputedStyle(element).visibility, sized: box.width > 50 && box.height > 50, onTop: top === element };
      }),
    )
    .toEqual({ opacity: 1, visibility: "visible", sized: true, onTop: true });
}

/** Presses the keys one after another. */
const pressAll = async (page: Page, keys: readonly string[]): Promise<void> => {
  await keys.reduce<Promise<void>>((done, key) => done.then(() => page.keyboard.press(key)), Promise.resolve());
};

/** Tabs from wherever focus is until `target` has it, in at most `limit` presses. */
const tabTo = async (page: Page, target: Locator, limit: number): Promise<boolean> => {
  if (limit === 0) return false;
  await page.keyboard.press("Tab");
  if (await target.evaluate((element) => element === document.activeElement)) return true;
  return tabTo(page, target, limit - 1);
};

interface Stage {
  readonly name: string;
  readonly path: string;
  /** The element that carries `data-frames`, `data-time` and the camera attributes. */
  readonly host: (page: Page) => Locator;
  /** The focusable group; the same element as `host` unless the page wraps the stage. */
  readonly group: (page: Page) => Locator;
  /** Where the stage's pause button lives. */
  readonly scope: (page: Page) => Locator | Page;
  /** Whether time moves on its own, so a pause button is owed. */
  readonly animated: boolean;
}

const inDialog = (name: string) => (page: Page) => page.getByRole("dialog", { name });
const dialogViewport = (name: string) => (page: Page) => inDialog(name)(page).getByTestId("viewport");

const stages: readonly Stage[] = [
  {
    name: "the Effects stage",
    path: "/?view=effects",
    host: (page) => page.getByTestId("effects-stage"),
    group: (page) => page.getByTestId("effects-stage").getByRole("group"),
    scope: (page) => page,
    animated: true,
  },
  {
    name: "a screen effect's viewport",
    path: "/?asset=dither",
    host: dialogViewport("Dither"),
    group: dialogViewport("Dither"),
    scope: inDialog("Dither"),
    animated: true,
  },
  {
    name: "a surface shader's viewport",
    path: "/?asset=hologram",
    host: dialogViewport("Hologram"),
    group: dialogViewport("Hologram"),
    scope: inDialog("Hologram"),
    animated: true,
  },
  {
    name: "the playground viewport",
    path: "/?view=playground",
    host: (page) => page.getByTestId("playground-viewport"),
    group: (page) => page.getByTestId("playground-viewport"),
    scope: (page) => page,
    animated: true,
  },
  {
    name: "a primitive's viewport",
    path: "/?asset=platonic-icosahedron",
    host: dialogViewport("Icosahedron"),
    group: dialogViewport("Icosahedron"),
    scope: inDialog("Icosahedron"),
    animated: false,
  },
];

const effectsStage = stages[0];
const hologramStage = stages[2];
const playgroundStage = stages[3];
const primitiveStage = stages[4];
if (effectsStage === undefined || hologramStage === undefined || playgroundStage === undefined || primitiveStage === undefined) throw new Error("the stage list changed");

const ready = async (stage: Stage, page: Page): Promise<void> => {
  await page.goto(stage.path);
  // The playground only animates once something animated is in it.
  if (stage === playgroundStage) await page.getByRole("checkbox", { name: "Smoke" }).check();
  const host = stage.host(page);
  await expectRenderer(host.locator("canvas"));
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  if (stage === playgroundStage) {
    await settledBuilds(host);
    await programsSettled(host);
  }
};

for (const stage of stages.filter((s) => s.animated)) {
  test(`pausing ${stage.name} stops time, and resuming carries on from where it stopped`, async ({ page }) => {
    const errors = errorsOn(page);
    await ready(stage, page);
    const host = stage.host(page);
    const scope = stage.scope(page);
    const pause = scope.getByRole("button", { name: "Pause motion" });
    await expect(pause).toBeVisible();
    await expect(host).toHaveAttribute("data-time", /^\d/, { timeout: 20_000 });
    // Time advances with drawn frames, which are slow under software rendering on a busy machine: the ceiling that every stage wait in the catalog spec uses.
    await expect.poll(async () => number(host, "data-time"), { timeout: 20_000 }).toBeGreaterThan(0.3);
    await expectCanvasLive(host);

    await pause.click();
    // The label says what the button does next, so it flips instead of carrying a pressed state.
    const resume = scope.getByRole("button", { name: "Resume motion" });
    await expect(resume).toBeVisible();
    const heldFrames = await framesHeld(host);
    const heldTime = await number(host, "data-time");
    await page.waitForTimeout(2000);
    expect(await number(host, "data-frames")).toBe(heldFrames);
    expect(await number(host, "data-time")).toBe(heldTime);
    // The stage stays on screen: pause stops time, it does not hide the picture.
    await expectCanvasLive(host);

    await resume.click();
    await expect(scope.getByRole("button", { name: "Pause motion" })).toBeVisible();
    // It carries on from the held value, not from the wall clock: no jump by the length of the pause.
    await expect.poll(async () => number(host, "data-time"), { timeout: 20_000 }).toBeGreaterThan(heldTime);
    expect((await number(host, "data-time")) - heldTime).toBeLessThan(1.5);
    await expect.poll(async () => number(host, "data-frames"), { timeout: 20_000 }).toBeGreaterThan(heldFrames);
    expect(errors).toEqual([]);
  });
}

test("a paused stage still orbits from the keyboard, redraws, and keeps its time", async ({ page }) => {
  const errors = errorsOn(page);
  const stage = effectsStage;
  await ready(stage, page);
  const host = stage.host(page);
  await stage.scope(page).getByRole("button", { name: "Pause motion" }).click();
  await expect(stage.scope(page).getByRole("button", { name: "Resume motion" })).toBeVisible();
  const { frames: heldFrames, time: heldTime } = await heldCounters(host);
  const azimuth = await number(host, "data-azimuth");
  await stage.group(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  // Time is stopped, but the viewer still moves the camera, and the stage draws the new view.
  await expect.poll(async () => number(host, "data-azimuth")).not.toBe(azimuth);
  await expect.poll(async () => number(host, "data-frames")).toBeGreaterThan(heldFrames);
  await page.waitForTimeout(500);
  expect(await number(host, "data-time")).toBe(heldTime);
  await expectCanvasLive(host);
  expect(errors).toEqual([]);
});

test("a paused surface shader reads no time: its clock holds through key orbit, and resumes from where it stopped", async ({ page }) => {
  const errors = errorsOn(page);
  const stage = hologramStage;
  await ready(stage, page);
  const host = stage.host(page);
  // The shader reads the stage's own clock, not the wall clock: the two move together.
  await expect.poll(async () => number(host, "data-shader-time")).toBeGreaterThan(0.3);
  await expect.poll(async () => (await host.getAttribute("data-shader-time")) === (await host.getAttribute("data-time"))).toBe(true);
  await stage.scope(page).getByRole("button", { name: "Pause motion" }).click();
  await expect(stage.scope(page).getByRole("button", { name: "Resume motion" })).toBeVisible();
  const { frames: heldFrames, time: heldTime } = await heldCounters(host);
  expect(await number(host, "data-shader-time")).toBe(heldTime);
  const azimuth = await number(host, "data-azimuth");
  await stage.group(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowDown");
  // The camera moves and the stage draws the new view, and the shader's time does not move with the wall clock.
  await expect.poll(async () => number(host, "data-azimuth")).not.toBe(azimuth);
  await expect.poll(async () => number(host, "data-frames")).toBeGreaterThan(heldFrames);
  await page.waitForTimeout(1000);
  expect(await number(host, "data-shader-time")).toBe(heldTime);
  await stage.scope(page).getByRole("button", { name: "Resume motion" }).click();
  await expect.poll(async () => number(host, "data-shader-time")).toBeGreaterThan(heldTime);
  expect((await number(host, "data-shader-time")) - heldTime).toBeLessThan(2);
  expect(errors).toEqual([]);
});

/** Puts a new `params` value in the address, the way a link or a script would, and tells the page the address changed. */
const setParams = (page: Page, value: string): Promise<void> =>
  page.evaluate((next) => {
    const url = new URL(window.location.href);
    url.searchParams.set("params", next);
    window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, value);

test("a surface shader's parameters move live from the address: frames keep coming, the program count stays flat, the picture changes", async ({ page }) => {
  const errors = errorsOn(page);
  const stage = hologramStage;
  await ready(stage, page);
  const host = stage.host(page);
  // Held, so the shader's time is fixed and only the parameters can change the picture.
  await stage.scope(page).getByRole("button", { name: "Pause motion" }).click();
  await heldCounters(host);
  await expect.poll(async () => number(host, "data-programs")).toBeGreaterThan(0);
  const programs = await number(host, "data-programs");
  const built = await settledBuilds(host);
  const first = await host.locator("canvas").screenshot();
  await ["density=300", "density=300,intensity=8,speed=0", '{"density":8,"intensity":0.5}'].reduce<Promise<Buffer>>(async (before, value) => {
    const picture = await before;
    const frames = await number(host, "data-frames");
    await setParams(page, value);
    await expect.poll(async () => number(host, "data-frames")).toBeGreaterThan(frames);
    await page.waitForTimeout(500);
    expect(await builds(host), `builds after ${value}`).toBe(built);
    expect(await number(host, "data-programs"), `programs after ${value}`).toBe(programs);
    const next = await host.locator("canvas").screenshot();
    expect(next.equals(picture), `the picture after ${value}`).toBe(false);
    return next;
  }, Promise.resolve(first));
  expect(errors).toEqual([]);
});

for (const stage of stages) {
  test(`${stage.name} is a labelled group that the keyboard orbits and zooms`, async ({ page }) => {
    const errors = errorsOn(page);
    await ready(stage, page);
    const host = stage.host(page);
    const group = stage.group(page);

    // Not a picture: a focusable, labelled group whose description names the keys.
    await expect(group).toHaveAttribute("role", "group");
    await expect(group).toHaveAttribute("tabindex", "0");
    await expect(group).not.toHaveAccessibleName("");
    await expect(group).toHaveAccessibleDescription(/arrow keys orbit/i);
    await expect(group).toHaveAccessibleDescription(/\+ and - zoom/i);
    await expect(group).toHaveAccessibleDescription(/\b0 resets/i);

    // The keys work from focus alone, with no pointer in sight.
    await group.focus();
    await expect(group).toBeFocused();
    await expect(host).toHaveAttribute("data-azimuth", /^-?\d/);
    await expect(host).toHaveAttribute("data-polar", /^-?\d/);
    await expect(host).toHaveAttribute("data-distance", /^\d/);
    const start = { azimuth: await number(host, "data-azimuth"), polar: await number(host, "data-polar"), distance: await number(host, "data-distance") };

    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => number(host, "data-azimuth")).not.toBe(start.azimuth);
    const right = await number(host, "data-azimuth");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => number(host, "data-azimuth")).not.toBe(right);
    // Left undoes right, and then some: the two directions are opposite.
    expect(Math.sign((await number(host, "data-azimuth")) - right)).not.toBe(Math.sign(right - start.azimuth));

    await page.keyboard.press("ArrowUp");
    await expect.poll(async () => number(host, "data-polar")).not.toBe(start.polar);

    await page.keyboard.press("+");
    await expect.poll(async () => number(host, "data-distance")).toBeLessThan(start.distance);
    const closer = await number(host, "data-distance");
    await page.keyboard.press("-");
    await page.keyboard.press("-");
    await expect.poll(async () => number(host, "data-distance")).toBeGreaterThan(closer);

    await page.keyboard.press("0");
    await expect.poll(async () => number(host, "data-azimuth")).toBeCloseTo(start.azimuth, 0);
    await expect.poll(async () => number(host, "data-polar")).toBeCloseTo(start.polar, 0);
    await expect.poll(async () => number(host, "data-distance")).toBeCloseTo(start.distance, 1);
    expect(errors).toEqual([]);
  });
}

test("the camera keys are heard only from the stage", async ({ page }) => {
  // It loads two stages one after the other; on a loaded runner that comes close to the default limit.
  test.slow();
  const errors = errorsOn(page);
  // On the Effects page the focus goes to a checkbox: the arrows and + mean nothing to it, and the stage must not take them.
  await ready(effectsStage, page);
  const host = effectsStage.host(page);
  const start = { azimuth: await number(host, "data-azimuth"), distance: await number(host, "data-distance") };
  const dither = page.getByRole("checkbox", { name: "Dither" });
  await dither.focus();
  await pressAll(page, ["ArrowRight", "ArrowLeft", "ArrowUp", "+", "-", "0"]);
  // Space still belongs to the checkbox, which shows the focus really is there.
  const was = await dither.isChecked();
  await page.keyboard.press("Space");
  await expect(dither).toBeChecked({ checked: !was });
  await page.waitForTimeout(600);
  expect(await number(host, "data-azimuth")).toBe(start.azimuth);
  expect(await number(host, "data-distance")).toBe(start.distance);

  // In the playground a slider takes the arrows.
  await ready(playgroundStage, page);
  const playground = playgroundStage.host(page);
  const before = { azimuth: await number(playground, "data-azimuth"), distance: await number(playground, "data-distance") };
  const slider = page.getByRole("slider").first();
  await slider.focus();
  const level = await slider.inputValue();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await expect(slider).not.toHaveValue(level);
  await page.waitForTimeout(600);
  expect(await number(playground, "data-azimuth")).toBe(before.azimuth);
  expect(await number(playground, "data-distance")).toBe(before.distance);
  expect(errors).toEqual([]);
});

for (const stage of [effectsStage, primitiveStage]) {
  test(`the keyboard reaches ${stage.name} with Tab`, async ({ page }) => {
    await page.goto(stage.path);
    await expect(stage.host(page)).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
    const group = stage.group(page);
    expect(await tabTo(page, group, 150)).toBe(true);
    await expect(group).toBeFocused();
    if (stage.animated) {
      // The pause button is the next stop, so a keyboard viewer finds it beside the stage.
      await page.keyboard.press("Tab");
      await expect(stage.scope(page).getByRole("button", { name: "Pause motion" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(stage.scope(page).getByRole("button", { name: "Resume motion" })).toBeFocused();
    }
  });
}

test.describe("under reduced motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const stage of stages.filter((s) => s.animated)) {
    test(`${stage.name} holds still, offers no pause button, and still takes the keys`, async ({ page }) => {
      const errors = errorsOn(page);
      await ready(stage, page);
      const host = stage.host(page);
      // Nothing moves, so there is nothing to pause.
      await expect(stage.scope(page).getByRole("button", { name: /^(Pause|Resume) motion$/ })).toHaveCount(0);
      // A stage that builds its scene asynchronously (its environment and effects load on demand) draws once more when each build lands, so wait for the counter to hold for three seconds, not for a fixed time.
      const { frames: settledFrames, time: settledTime } = await heldCounters(host, 6);
      await page.waitForTimeout(1500);
      expect(await number(host, "data-frames")).toBe(settledFrames);
      expect(await number(host, "data-time")).toBe(settledTime);
      await expectCanvasLive(host);

      // The keys still move the camera, and the stage draws it, with time still stopped.
      const azimuth = await number(host, "data-azimuth");
      await stage.group(page).focus();
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => number(host, "data-azimuth")).not.toBe(azimuth);
      await expect.poll(async () => number(host, "data-frames")).toBeGreaterThan(settledFrames);
      await page.waitForTimeout(500);
      expect(await number(host, "data-time")).toBe(settledTime);
      expect(errors).toEqual([]);
    });
  }
});

test("the Effects stage's pause and keyboard controls pass axe", async ({ page }) => {
  await ready(effectsStage, page);
  await effectsStage.group(page).focus();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("a stage in a detail dialog passes axe", async ({ page }) => {
  await ready(hologramStage, page);
  await hologramStage.group(page).focus();
  await expect(hologramStage.scope(page).getByRole("button", { name: "Pause motion" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});


const openSourceSkillPages = [
  ["/?view=open-source&set=jakubkrehel-skills&item=better-ui&page=skills/better-ui/SKILL.md", "UI polish"],
  ["/?view=open-source&set=ai-design-skills&item=landing-page-design&page=skills/landing-page-design/SKILL.md", "Landing Page Design"],
  ["/?view=open-source&set=mengto-skills&item=3d-metal-material&page=agent-skills/3d/3d-metal-material/SKILL.md", "3D Metal Material"],
] as const;

for (const [url, title] of openSourceSkillPages) {
  test(`open source (${title}): Markdown task lists and headings pass axe`, async ({ page }) => {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await expect(page.getByText("Loading…")).toHaveCount(0);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
}
