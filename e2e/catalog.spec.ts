import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const gallery = (page: Page) => page.getByRole("main").getByRole("list").getByRole("button");

async function assetCount(page: Page): Promise<number> {
  const summary = await page.getByText(/^\d+ assets?, typed and importable\.$/).textContent();
  return Number.parseInt(summary ?? "0", 10);
}

test("the gallery lists every asset with no page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "LuminosiTS catalog" })).toBeVisible();
  const total = await assetCount(page);
  expect(total).toBeGreaterThanOrEqual(20);
  await expect(gallery(page)).toHaveCount(total);
  expect(errors).toEqual([]);
});

test("search narrows the gallery and says how many match", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search assets" }).fill("arrow");
  await expect(gallery(page)).toHaveCount(4);
  await expect(page.getByText("4 results")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search assets" }).fill("no-such-asset");
  await expect(page.getByText("Nothing matches “no-such-asset”.")).toBeVisible();
});

test("the kind filter is a set of toggle buttons", async ({ page }) => {
  await page.goto("/");
  const icons = page.getByRole("group", { name: "Filter by kind" }).getByRole("button", { name: /^Icons/ });
  await icons.click();
  await expect(icons).toHaveAttribute("aria-pressed", "true");
});

test("an asset opens in a dialog with snippets that copy", async ({ page }) => {
  await page.goto("/");
  const trigger = gallery(page).filter({ hasText: "Arrow right" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Arrow right" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\?asset=arrow-right$/);
  const react = dialog.getByRole("region", { name: "React snippet" });
  await expect(react.locator("code")).toContainText('import { ArrowRight } from "@hedronite/lts-icons/react";');

  await react.getByRole("button", { name: "Copy: React snippet" }).click();
  await expect(react.getByRole("button", { name: "Copied: React snippet" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("<ArrowRight");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).not.toHaveURL(/asset=/);
});

test("a deep link opens its asset", async ({ page }) => {
  await page.goto("/?asset=moon");
  await expect(page.getByRole("dialog", { name: "Moon" })).toBeVisible();
});

for (const [name, path] of [["gallery", "/"], ["detail dialog", "/?asset=cube"]] as const) {
  test(`the ${name} has no serious or critical accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

test("the look switcher swaps the token preset and keeps contrast", async ({ page }) => {
  await page.goto("/");
  const look = page.getByRole("group", { name: "Look" });
  await look.getByRole("button", { name: "Hedronite" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-preset", "hedronite");
  await expect(look.getByRole("button", { name: "Hedronite" })).toHaveAttribute("aria-pressed", "true");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("a primitive opens in an interactive 3D viewport", async ({ page }) => {
  await page.goto("/?asset=platonic-icosahedron");
  const viewport = page.getByRole("dialog", { name: "Icosahedron" }).getByTestId("viewport");
  await expect(viewport.locator("canvas")).toBeVisible();
  await expect(viewport).toHaveAttribute("data-gpu-geometries", /^[1-9]\d*$/);
  // A frame was drawn without any interaction: on-demand rendering must not wait for input.
  await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/);
});

test("a material renders with its environment", async ({ page }) => {
  await page.goto("/?asset=glass");
  const viewport = page.getByRole("dialog", { name: "Glass" }).getByTestId("viewport");
  await expect(viewport.locator("canvas")).toBeVisible();
  await expect(viewport).toHaveAttribute("data-gpu-textures", /^[1-9]\d*$/);
});

test("stepping through 3D assets frees each geometry it replaces", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("group", { name: "Filter by kind" }).getByRole("button", { name: /^Primitives/ }).click();
  await gallery(page).first().click();
  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-gpu-geometries", /^[1-9]\d*$/);
  await expect.poll(() => viewport.getAttribute("data-gpu-geometries"), { intervals: [300] }).toBe(await viewport.getAttribute("data-gpu-geometries"));
  const baseline = await viewport.getAttribute("data-gpu-geometries");

  const next = page.getByRole("button", { name: "Next asset" });
  for (let i = 0; i < 9; i++) {
    // eslint-disable-next-line no-await-in-loop -- each step must render before the next, to load and free one geometry at a time
    await next.click();
  }
  await expect(page.getByRole("dialog")).toContainText("1 / 9");
  await expect.poll(() => viewport.getAttribute("data-gpu-geometries"), { timeout: 5000 }).toBe(baseline);
});

for (const [id, name] of [
  ["crystal-cluster", "Crystal cluster"],
  ["instanced-lattice", "Instanced lattice"],
  ["crystal-cluster-glb", "Crystal cluster (glTF)"],
] as const) {
  test(`the ${id} object renders in the viewport`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`/?asset=${id}`);
    const viewport = page.getByRole("dialog", { name }).getByTestId("viewport");
    await expect(viewport).toHaveAttribute("data-gpu-geometries", /^[1-9]\d*$/);
    await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/);
    expect(errors).toEqual([]);
  });
}

for (const [id, name] of [
  ["fresnel-glow", "Fresnel glow"],
  ["height-gradient", "Height gradient"],
  ["pulse", "Pulse"],
] as const) {
  test(`the ${id} shader compiles and renders`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/?asset=${id}`);
    const viewport = page.getByRole("dialog", { name }).getByTestId("viewport");
    await expect(viewport.locator("canvas")).toBeVisible();
    await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
    expect(errors).toEqual([]);
  });
}

test("the playground composes primitives and exports the scene", async ({ page }) => {
  await page.goto("/?view=playground");
  await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();
  const scene = page.getByRole("list", { name: "Scene" }).getByRole("listitem");
  const before = await scene.count();

  await page.getByLabel("Primitive").selectOption("hexagonal-bipyramid");
  await page.getByLabel("Material").selectOption("glass");
  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(scene).toHaveCount(before + 1);

  await expect(page.getByRole("region", { name: "JSON export" }).locator("code")).toContainText('"primitive": "hexagonal-bipyramid"');
  await expect(page.getByRole("region", { name: "React export" }).locator("code")).toContainText('<PrimitiveMesh primitive="hexagonal-bipyramid" material="glass"');
  await expect(page.getByTestId("playground-viewport")).toHaveAttribute("data-frames", /^[1-9]\d*$/);

  await page.getByRole("button", { name: "Remove Hexagonal bipyramid, Glass" }).click();
  await expect(scene).toHaveCount(before);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("a scene kit renders with its own lights", async ({ page }) => {
  await page.goto("/?asset=scene-dusk");
  const viewport = page.getByRole("dialog", { name: "Dusk" }).getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-gpu-geometries", /^[1-9]\d*$/);
  await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/);
});

test("the growth view groups assets by the day they were added", async ({ page }) => {
  await page.goto("/?view=growth");
  await expect(page.getByRole("heading", { name: "Growth" })).toBeVisible();
  await expect(page.locator("time").first()).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  await page.getByRole("button", { name: "Dusk" }).click();
  await expect(page.getByRole("dialog", { name: "Dusk" })).toBeVisible();
});
