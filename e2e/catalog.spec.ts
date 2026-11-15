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

test("the embed page draws a spec framed into the box it is given", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const spec = {
    format: "lts-object-spec",
    version: 1,
    id: "your-block",
    name: "Your block",
    materials: { body: { preset: "matte" } },
    parts: [{ id: "body", shape: { type: "box", size: [1, 1, 1] }, material: "body" }],
  };
  await page.route("**/review-spec.json", (route) => route.fulfill({ json: spec }));
  await page.goto("/embed.html?spec=/review-spec.json&width=320&height=240&bg=%23000000&fit=0.25,0.25,0.75,0.75");
  const status = async (): Promise<string> =>
    page.evaluate(() => {
      const state: unknown = Reflect.get(window, "__ltsEmbed");
      return typeof state === "object" && state !== null && "status" in state ? String(state.status) : "missing";
    });
  await expect.poll(status, { timeout: 15_000 }).not.toBe("loading");
  expect(await status()).toBe("drawn");
  // The lit box against black: its pixels must span the box it was given, height to height.
  const extent = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const image = new Image();
    image.src = canvas.toDataURL();
    await image.decode();
    const context = new OffscreenCanvas(canvas.width, canvas.height).getContext("2d");
    if (context === null) return null;
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let top = height;
    let bottom = -1;
    let left = width;
    let right = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 60) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
    }
    return { y0: top / height, y1: (bottom + 1) / height, cx: (left + right + 1) / 2 / width };
  });
  expect(extent).not.toBeNull();
  expect(extent?.y0).toBeCloseTo(0.25, 1);
  expect(extent?.y1).toBeCloseTo(0.75, 1);
  expect(extent?.cx).toBeCloseTo(0.5, 1);
  expect(errors).toEqual([]);
});
