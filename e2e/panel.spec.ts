import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { builds, expect, settledBuilds, test } from "./fixtures.js";

// The parameter panel in the detail view: controls made from each asset's schema, edits that move the asset live (a flat
// program count), a parameter baked into the asset that rebuilds it and says so, and an address (`?params=`) that follows every
// edit and is followed back (back and forward).

const errorsOn = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

const number = async (host: Locator, attribute: string): Promise<number> => Number(await host.getAttribute(attribute));
const dialogOf = (page: Page, name: string): Locator => page.getByRole("dialog", { name });
const paramsOf = (page: Page): string => new URL(page.url()).searchParams.get("params") ?? "";

/**
 * Waits until the stage has drawn and its program count has settled: the shader's programs compile over the first frames (a loaded
 * runner shows four, then seven), so the first positive count is no baseline. Settled is the count holding for eight samples in a row.
 */
async function drawn(host: Locator): Promise<number> {
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 20_000 });
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
      { message: "the program count settles", timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(8);
  return last;
}

/** The frame counter moves on after `act`: the stage keeps drawing. */
async function drawsAfter(host: Locator, act: () => Promise<void>): Promise<void> {
  const before = await number(host, "data-frames");
  await act();
  await expect.poll(async () => number(host, "data-frames")).toBeGreaterThan(before);
}

/** Puts a new `params` value in the address the way a link or a script would, and tells the page the address changed. */
const pushParams = (page: Page, value: string): Promise<void> =>
  page.evaluate((next) => {
    const url = new URL(window.location.href);
    url.searchParams.set("params", next);
    window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, value);

test("the panel is a chunk of its own: the gallery never loads it, an asset with parameters does, and one without gets no panel", async ({ page }) => {
  const chunks: string[] = [];
  page.on("request", (request) => {
    if (/\/ParameterPanel-[^/]+\.js$/.test(request.url())) chunks.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "LuminosiTS catalog" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(chunks).toEqual([]);
  await page.goto("/?asset=your-desk-lamp");
  const lamp = dialogOf(page, "Your desk lamp");
  await expect(lamp.getByRole("region", { name: /snippet/ }).first()).toBeVisible();
  await expect(lamp.getByRole("region", { name: "Parameters", exact: true })).toHaveCount(0);
  expect(chunks).toEqual([]);
  await page.goto("/?asset=hologram");
  await expect(dialogOf(page, "Hologram").getByRole("region", { name: "Parameters", exact: true })).toBeVisible();
  expect(chunks.length).toBeGreaterThan(0);
});

test("a shader's panel: typed, labelled controls; live edits keep the program count flat; the address and the snippet follow; reset; axe clean", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?asset=hologram");
  const dialog = dialogOf(page, "Hologram");
  const panel = dialog.getByRole("region", { name: "Parameters", exact: true });
  const host = dialog.getByTestId("viewport");
  const programs = await drawn(host);
  const built = await settledBuilds(host);

  // Controls from the schema: a slider and a number input for each number (with the schema's bounds), a color input for the color.
  const density = panel.getByRole("spinbutton", { name: "Density", exact: true });
  await expect(density).toHaveValue("40");
  await expect(density).toHaveAttribute("min", "5");
  await expect(density).toHaveAttribute("max", "400");
  await expect(panel.getByRole("slider", { name: "Density, slider" })).toHaveValue("40");
  await expect(panel.getByLabel("Color", { exact: true })).toHaveAttribute("type", "color");
  await expect(panel.getByRole("button", { name: "Reset to defaults" })).toBeDisabled();

  // Two live edits, one by the number input and one by the keyboard on the slider: the picture changes, the program count does not.
  const before = await host.locator("canvas").screenshot();
  await drawsAfter(host, async () => {
    await density.fill("300");
  });
  await expect.poll(() => paramsOf(page)).toBe("density=300");
  const slider = panel.getByRole("slider", { name: "Intensity, slider" });
  await slider.focus();
  const frames = await number(host, "data-frames");
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("10");
  await expect.poll(() => paramsOf(page)).toBe("density=300,intensity=10");
  await expect.poll(async () => number(host, "data-frames")).toBeGreaterThan(frames);
  await page.waitForTimeout(500);
  expect(await builds(host), "builds after two live edits").toBe(built);
  expect(await number(host, "data-programs")).toBe(programs);
  expect((await host.locator("canvas").screenshot()).equals(before)).toBe(false);

  // The usage code shows what the view shows, and the panel says nothing was rebuilt.
  await expect(dialog.getByRole("region", { name: "Changed parameters snippet" })).toContainText("density: 300, intensity: 10");
  await expect(panel.getByRole("status")).toHaveText("");

  // Nothing wrong for a viewer who cannot see: every control has a name, and axe is clean.
  const results = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

  // Reset puts every parameter back, in the picture, the address and the code.
  await panel.getByRole("button", { name: "Reset to defaults" }).click();
  await expect.poll(() => paramsOf(page)).toBe("");
  await expect(density).toHaveValue("40");
  await expect(dialog.getByRole("region", { name: "Changed parameters snippet" })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await builds(host), "builds after reset").toBe(built);
  expect(await number(host, "data-programs")).toBe(programs);
  expect(errors).toEqual([]);
});

test("a parameter baked into the shader rebuilds it, and the panel says so", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?asset=toon");
  const dialog = dialogOf(page, "Toon outline");
  const panel = dialog.getByRole("region", { name: "Parameters", exact: true });
  const host = dialog.getByTestId("viewport");
  await drawn(host);
  await expect(panel.getByText("Rebuilds the asset")).toHaveCount(1);
  const before = await host.locator("canvas").screenshot();
  await drawsAfter(host, async () => {
    await panel.getByRole("spinbutton", { name: "Bands", exact: true }).fill("5");
  });
  await expect(panel.getByRole("status")).toHaveText("Bands is built into the shader, so changing it rebuilds the shader.");
  await expect.poll(() => paramsOf(page)).toBe("bands=5");
  await expect.poll(async () => (await host.locator("canvas").screenshot()).equals(before)).toBe(false);
  // A live parameter right after it clears the notice.
  await panel.getByRole("spinbutton", { name: "Outline", exact: true }).fill("0.1");
  await expect(panel.getByRole("status")).toHaveText("");
  await expect.poll(() => paramsOf(page)).toBe("bands=5,outline=0.1");
  expect(errors).toEqual([]);
});

test("a color with no default is set by the panel and cleared back to the look", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?asset=pulse");
  const dialog = dialogOf(page, "Pulse");
  const panel = dialog.getByRole("region", { name: "Parameters", exact: true });
  const host = dialog.getByTestId("viewport");
  await drawn(host);
  await expect(panel.getByRole("button", { name: /^Clear/ })).toHaveCount(0);
  await drawsAfter(host, async () => {
    await panel.getByLabel("Color", { exact: true }).fill("#123456");
  });
  await expect.poll(() => paramsOf(page)).toBe("color=#123456");
  await expect(panel.getByText("#123456")).toBeVisible();
  await drawsAfter(host, async () => {
    await panel.getByRole("button", { name: "Clear Color" }).click();
  });
  await expect.poll(() => paramsOf(page)).toBe("");
  await expect(panel.getByText("from the look")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the address and the panel agree both ways: a link opens with its values, and back and forward restore them", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?asset=hologram&params=density=300");
  const dialog = dialogOf(page, "Hologram");
  const panel = dialog.getByRole("region", { name: "Parameters", exact: true });
  const host = dialog.getByTestId("viewport");
  const density = panel.getByRole("spinbutton", { name: "Density", exact: true });
  const speed = panel.getByRole("spinbutton", { name: "Speed", exact: true });
  await drawn(host);
  await expect(density).toHaveValue("300");
  await expect(speed).toHaveValue("1.5");

  // A new address (a link followed, a script) is read by the panel, the snippet and the view.
  await pushParams(page, "speed=0");
  await expect(density).toHaveValue("40");
  await expect(speed).toHaveValue("0");
  await expect(dialog.getByRole("region", { name: "Changed parameters snippet" })).toContainText("speed: 0");
  await page.goBack();
  await expect(density).toHaveValue("300");
  await expect(speed).toHaveValue("1.5");
  await page.goForward();
  await expect(density).toHaveValue("40");
  await expect(speed).toHaveValue("0");

  // A value the asset does not take is left out, and an edit writes the address without adding a history entry.
  await pushParams(page, "density=99999,nope=1,intensity=4");
  await expect(density).toHaveValue("40");
  await expect(panel.getByRole("spinbutton", { name: "Intensity", exact: true })).toHaveValue("4");
  const length = await page.evaluate(() => window.history.length);
  await density.fill("120");
  await expect.poll(() => paramsOf(page)).toBe("intensity=4,density=120");
  expect(await page.evaluate(() => window.history.length)).toBe(length);

  // Another asset starts from its own defaults.
  await dialog.getByRole("button", { name: "Next asset" }).click();
  await expect.poll(() => paramsOf(page)).toBe("");
  expect(errors).toEqual([]);
});

test("a screen effect's panel moves it live; the ASCII ramp, which is baked in, rebuilds and says so", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?asset=dither");
  const dialog = dialogOf(page, "Dither");
  const panel = dialog.getByRole("region", { name: "Parameters", exact: true });
  const host = dialog.getByTestId("viewport");
  const programs = await drawn(host);
  const built = await settledBuilds(host);
  const cell = panel.getByRole("spinbutton", { name: "Cell", exact: true });
  const first = await host.locator("canvas").screenshot();
  await drawsAfter(host, async () => {
    await cell.fill("9");
  });
  await expect.poll(() => paramsOf(page)).toBe("cell=9");
  await page.waitForTimeout(500);
  expect(await builds(host), "builds after a live edit").toBe(built);
  expect(await number(host, "data-programs")).toBe(programs);
  expect((await host.locator("canvas").screenshot()).equals(first)).toBe(false);

  await page.goto("/?asset=ascii");
  const ascii = dialogOf(page, "ASCII");
  const asciiPanel = ascii.getByRole("region", { name: "Parameters", exact: true });
  await drawn(ascii.getByTestId("viewport"));
  const ramp = asciiPanel.getByRole("textbox", { name: "Ramp", exact: true });
  await ramp.fill(" .:#");
  await ramp.press("Enter");
  await expect(asciiPanel.getByRole("status")).toHaveText("Ramp is built into the screen effect, so changing it rebuilds the screen effect.");
  await expect.poll(() => paramsOf(page)).toBe('{"ramp":" .:#"}');
  expect(errors).toEqual([]);
});

test("an icon's panel changes the icon in the detail view and the code beside it", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?asset=arrow-right");
  const dialog = dialogOf(page, "Arrow right");
  const panel = dialog.getByRole("region", { name: "Parameters", exact: true });
  await expect(panel.getByRole("spinbutton", { name: "Size (px)", exact: true })).toHaveValue("24");
  await panel.getByRole("spinbutton", { name: "Size (px)", exact: true }).fill("96");
  await expect(dialog.locator("svg[width='96']")).toBeVisible();
  await expect.poll(() => paramsOf(page)).toBe("size=96");
  await panel.getByRole("textbox", { name: "Accessible name", exact: true }).fill("Next");
  await panel.getByRole("textbox", { name: "Accessible name", exact: true }).press("Enter");
  await expect(dialog.getByRole("img", { name: "Next" })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "SVG snippet" })).toContainText('width="96"');
  const results = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  expect(errors).toEqual([]);
});

// Phase two: the plain 3D viewport (primitives, objects) takes parameters too. An edit rebuilds the object it shows, so the picture
// changes and nothing leaks on the GPU; a link opens with its values already in the picture.
const objectCases = [
  { name: "a primitive", asset: "platonic-cube", label: "Size", value: "2.5", params: "scale=2.5" },
  { name: "the framed solid", asset: "framed-solid", label: "Radius", value: "0.4", params: "radius=0.4" },
  { name: "the crystal cluster", asset: "crystal-cluster", label: "Crystals", value: "3", params: "count=3" },
  { name: "the lattice", asset: "instanced-lattice", label: "Spacing", value: "0.8", params: "spacing=0.8" },
  { name: "the watch", asset: "dress-watch", label: "Hours", value: "3", params: "hours=3" },
] as const;

for (const { name, asset, label, value, params } of objectCases) {
  test(`${name}: the panel's edit shows in the viewport, the address follows, and a link opens with its values`, async ({ page }) => {
    const errors = errorsOn(page);
    await page.goto(`/?asset=${asset}`);
    const dialog = page.getByRole("dialog");
    const panel = dialog.getByRole("region", { name: "Parameters", exact: true });
    const host = dialog.getByTestId("viewport");
    await drawn(host);
    const geometries = await number(host, "data-gpu-geometries");
    const before = await host.locator("canvas").screenshot();
    await panel.getByRole("spinbutton", { name: label, exact: true }).fill(value);
    await expect.poll(() => paramsOf(page)).toBe(params);
    await expect.poll(async () => (await host.locator("canvas").screenshot()).equals(before), { message: "the picture changes with the parameter" }).toBe(false);
    // The old build is freed: the GPU holds no more geometries than it did.
    await expect.poll(async () => number(host, "data-gpu-geometries")).toBeLessThanOrEqual(geometries);
    const edited = await host.locator("canvas").screenshot();

    // Reset brings the first picture back.
    await panel.getByRole("button", { name: "Reset to defaults" }).click();
    await expect.poll(async () => (await host.locator("canvas").screenshot()).equals(edited)).toBe(false);

    // A link with the values opens on the edited picture, built once.
    await page.goto(`/?asset=${asset}&params=${params}`);
    const linked = page.getByRole("dialog").getByTestId("viewport");
    await drawn(linked);
    await expect(page.getByRole("dialog").getByRole("region", { name: "Parameters", exact: true }).getByRole("spinbutton", { name: label, exact: true })).toHaveValue(value);
    await expect.poll(async () => (await linked.locator("canvas").screenshot()).equals(before)).toBe(false);
    expect(errors).toEqual([]);
  });
}

// The glTF crystal cluster's only parameter is a model URL, which the viewport cannot honour: no panel, and an address cannot set it.
test("the glTF crystal cluster offers no panel for its model URL", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?asset=crystal-cluster-glb&params=url=/elsewhere.glb");
  const dialog = page.getByRole("dialog");
  await drawn(dialog.getByTestId("viewport"));
  await expect(dialog.getByRole("region", { name: "Parameters", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("region", { name: "Changed parameters snippet" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Materials and scene kits take no parameters today, so there is no panel and nothing for an address to carry: the view is as it was.
for (const { name, asset } of [
  { name: "a material", asset: "metal" },
  { name: "a scene kit", asset: "scene-dusk" },
] as const) {
  test(`${name} has no parameters, so no panel, and a params value in the address changes nothing`, async ({ page }) => {
    const errors = errorsOn(page);
    await page.goto(`/?asset=${asset}&params=scale=3`);
    const dialog = page.getByRole("dialog");
    const host = dialog.getByTestId("viewport");
    await drawn(host);
    await expect(dialog.getByRole("region", { name: "Parameters", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
