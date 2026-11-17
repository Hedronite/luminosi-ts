import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Written against the DOM G2 plans for every 3D stage, before the catalog has it:
//
// - A visible button named "Pause motion" stops time on an animated stage and then reads
//   "Resume motion". Time stopped means the stage's `data-frames` counter stays flat.
// - The stage is a focusable (`tabindex="0"`) `role="group"` with an accessible name and an
//   accessible description that names the keys: arrows orbit, + and - zoom, 0 resets.
// - The stage reports its camera in `data-azimuth` and `data-polar` (degrees) and `data-distance`
//   (scene units), beside `data-frames`, on the element that carries `data-frames`.

const errorsOn = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

const number = async (host: Locator, attribute: string): Promise<number> => Number(await host.getAttribute(attribute));

interface Stage {
  readonly name: string;
  readonly path: string;
  /** The element that carries `data-frames` and the camera attributes. */
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

const ready = async (stage: Stage, page: Page): Promise<void> => {
  await page.goto(stage.path);
  // The playground only animates once something animated is in it.
  if (stage.name === "the playground viewport") {
    await page.getByRole("checkbox", { name: "Smoke" }).check();
  }
  await expect(stage.host(page)).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
};

for (const stage of stages.filter((s) => s.animated)) {
  test(`pausing ${stage.name} stops time, and resuming restarts it`, async ({ page }) => {
    const errors = errorsOn(page);
    await ready(stage, page);
    const host = stage.host(page);
    const scope = stage.scope(page);
    const pause = scope.getByRole("button", { name: "Pause motion" });
    await expect(pause).toBeVisible();
    await expect.poll(async () => number(host, "data-frames")).toBeGreaterThan(0);

    await pause.click();
    // The label says what the button does next, so it flips instead of carrying a pressed state.
    const resume = scope.getByRole("button", { name: "Resume motion" });
    await expect(resume).toBeVisible();
    // Let the frame in flight and the counter's own sampling settle, then nothing may advance.
    await page.waitForTimeout(500);
    const held = await number(host, "data-frames");
    await page.waitForTimeout(1200);
    expect(await number(host, "data-frames")).toBe(held);
    // The canvas stays on screen: pause stops time, it does not hide the stage.
    await expect(host.locator("canvas")).toBeVisible();

    await resume.click();
    await expect(scope.getByRole("button", { name: "Pause motion" })).toBeVisible();
    await expect.poll(async () => number(host, "data-frames")).toBeGreaterThan(held);
    expect(errors).toEqual([]);
  });
}

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
    await expect(group).toHaveAccessibleDescription(/arrow/i);
    await expect(group).toHaveAccessibleDescription(/\+/);
    await expect(group).toHaveAccessibleDescription(/-/);
    await expect(group).toHaveAccessibleDescription(/\b0\b/);

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

test("a paused stage still orbits from the keyboard", async ({ page }) => {
  const errors = errorsOn(page);
  const stage = stages[0];
  if (stage === undefined) throw new Error("no stage");
  await ready(stage, page);
  const host = stage.host(page);
  await stage.scope(page).getByRole("button", { name: "Pause motion" }).click();
  await expect(stage.scope(page).getByRole("button", { name: "Resume motion" })).toBeVisible();
  await page.waitForTimeout(500);
  const held = await number(host, "data-frames");
  const azimuth = await number(host, "data-azimuth");
  await stage.group(page).focus();
  await page.keyboard.press("ArrowRight");
  // Time is stopped, but the viewer still moves the camera, and the stage draws the new view.
  await expect.poll(async () => number(host, "data-azimuth")).not.toBe(azimuth);
  await expect.poll(async () => number(host, "data-frames")).toBeGreaterThan(held);
  expect(errors).toEqual([]);
});

test("the stage's pause and keyboard controls pass axe", async ({ page }) => {
  const stage = stages[0];
  if (stage === undefined) throw new Error("no stage");
  await ready(stage, page);
  await stage.group(page).focus();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});
