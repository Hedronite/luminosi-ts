import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { decodePng } from "../tools/stills/src/png.js";
import { expect, expectRenderer, settledBuilds, test } from "./fixtures.js";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** How long a stage may take to draw: it waits on the stage's own counters, and this is only the ceiling that makes a stage that never draws fail. */
const STAGE_WAIT = 20_000;

/** The dialog's "3 / 12", as a pattern that does not match "13 / 12" or "3 / 120". */
const position = (at: number, total: number): RegExp => new RegExp(`(?<!\\d)${String(at)} / ${String(total)}(?!\\d)`);

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

type ClipboardCase = "absent" | "rejects" | "throws";

/**
 * Breaks the async clipboard API three ways: absent (a page on plain http:// has no navigator.clipboard),
 * or present and refusing the write, by a rejected promise (permission denied, page not focused) or a throw.
 */
const breakClipboard = async (page: Page, clipboard: ClipboardCase, execCommand: "works" | "refused"): Promise<void> => {
  await page.addInitScript(
    ({ clipboard: mode, execCommand: exec }) => {
      const refuse = {
        absent: undefined,
        rejects: { writeText: () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")) },
        throws: {
          writeText: (): Promise<void> => {
            throw new TypeError("clipboard is not available");
          },
        },
      };
      Object.defineProperty(navigator, "clipboard", { value: refuse[mode], configurable: true });
      const copied: string[] = [];
      Object.defineProperty(window, "__copied", { value: copied });
      // What the page asked the browser to copy: the selection of the focused textarea at the moment of the copy.
      document.addEventListener("copy", () => {
        const element = document.activeElement;
        if (element instanceof HTMLTextAreaElement) copied.push(element.value.slice(element.selectionStart, element.selectionEnd));
      });
      if (exec === "refused") Object.defineProperty(document, "execCommand", { value: () => false });
    },
    { clipboard, execCommand },
  );
};

const quietPage = (page: Page): string[] => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  return problems;
};

const brokenClipboards: readonly (readonly [ClipboardCase, string])[] = [
  ["absent", "there is no navigator.clipboard"],
  ["rejects", "navigator.clipboard rejects the write"],
  ["throws", "navigator.clipboard throws on the write"],
];

for (const [clipboard, when] of brokenClipboards) {
  test(`when ${when}, the snippet still copies, by the older route, with a clean console`, async ({ page }) => {
    await breakClipboard(page, clipboard, "works");
    const problems = quietPage(page);
    await page.goto("/?asset=arrow-right");
    const react = page.getByRole("dialog", { name: "Arrow right" }).getByRole("region", { name: "React snippet" });
    await react.getByRole("button", { name: "Copy: React snippet" }).click();
    await expect(react.getByRole("button", { name: "Copied: React snippet" })).toBeVisible();
    const copied: unknown = await page.evaluate((): unknown => Reflect.get(window, "__copied"));
    expect(copied).toEqual([expect.stringContaining('import { ArrowRight } from "@hedronite/lts-icons/react";')]);
    // The helper textarea is gone, and focus is back on the button that was pressed.
    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(react.getByRole("button", { name: "Copied: React snippet" })).toBeFocused();
    expect(problems).toEqual([]);
  });

  test(`when ${when} and the browser refuses the older route too, the text is selected for a copy by hand, with a clean console`, async ({ page }) => {
    await breakClipboard(page, clipboard, "refused");
    const problems = quietPage(page);
    await page.goto("/?asset=arrow-right");
    const react = page.getByRole("dialog", { name: "Arrow right" }).getByRole("region", { name: "React snippet" });
    await react.getByRole("button", { name: "Copy: React snippet" }).click();
    // The live label says what to do, and the snippet is on show, selected.
    await expect(react.getByText("Press ⌘C / Ctrl+C to copy")).toBeVisible();
    await expect(react.getByText("Copy failed")).toHaveCount(0);
    const box = react.getByRole("textbox", { name: "React snippet, selected" });
    await expect(box).toBeVisible();
    await expect(box).toBeFocused();
    await expect(box).toHaveValue(/import \{ ArrowRight \} from "@hedronite\/lts-icons\/react";/);
    expect(await box.evaluate((element) => (element instanceof HTMLTextAreaElement ? element.selectionStart === 0 && element.selectionEnd === element.value.length : false))).toBe(true);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    // Escape ends it and hands focus back to the button, without closing the dialog.
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
    await expect(react.getByRole("button", { name: "Copy: React snippet" })).toBeFocused();
    expect(problems).toEqual([]);
  });
}

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
  const look = page.getByLabel("Look");
  await look.selectOption("hedronite");
  await expect(page.locator("html")).toHaveAttribute("data-preset", "hedronite");
  await expect(look).toHaveValue("hedronite");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("a paired look follows the viewer's scheme", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Look").selectOption("catppuccin");
  const surface = (): Promise<string> => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--lts-surface").trim());
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(surface).toBe("#eff1f5");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(surface).toBe("#1e1e2e");
});

test("looks are grouped by category, and a one-scheme look keeps its scheme", async ({ page }) => {
  await page.goto("/");
  const look = page.getByLabel("Look");
  const groups = await look.locator("optgroup").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("label")));
  expect(groups).toEqual(["Core", "VirtualMachinist", "Omarchy"]);
  const vm = await look.locator('optgroup[label="VirtualMachinist"] option').allTextContents();
  expect(vm).toEqual(["Hedronite", "Hedron (dark)", "Hedron Light (light)"]);
  // 24 themes, with Catppuccin and Catppuccin Latte paired into one look.
  await expect(look.locator('optgroup[label="Omarchy"] option')).toHaveCount(23);
  // A light-scheme viewer picking a dark Omarchy theme still gets it dark.
  await page.emulateMedia({ colorScheme: "light" });
  await look.selectOption("tokyo-night");
  await expect(page.locator("html")).toHaveAttribute("data-preset", "tokyo-night");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--lts-surface").trim())).toBe("#1a1b26");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("a primitive opens in an interactive 3D viewport", async ({ page }) => {
  await page.goto("/?asset=platonic-icosahedron");
  const viewport = page.getByRole("dialog", { name: "Icosahedron" }).getByTestId("viewport");
  await expectRenderer(viewport.locator("canvas"));
  await expect(viewport.locator("canvas")).toBeVisible();
  await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/);
  // A frame was drawn without any interaction: on-demand rendering must not wait for input. The geometry
  // count is read once it has held across two samples: the WebGPU renderer registers one of its own after
  // the first frame, so a first reading can still be one short (R21).
  expect(await settledBuilds(viewport, "data-gpu-geometries")).toBeGreaterThan(0);
});

test("a material renders with its environment", async ({ page }) => {
  await page.goto("/?asset=glass");
  const viewport = page.getByRole("dialog", { name: "Glass" }).getByTestId("viewport");
  await expectRenderer(viewport.locator("canvas"));
  await expect(viewport.locator("canvas")).toBeVisible();
  await expect(viewport).toHaveAttribute("data-gpu-textures", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
});

test("stepping through 3D assets frees each geometry it replaces", async ({ page }) => {
  // Every 3D asset in turn, each drawn with software rendering: the run is long by nature, and longer on a busy machine.
  test.slow();
  await page.goto("/");
  const primitives = page.getByRole("group", { name: "Filter by kind" }).getByRole("button", { name: /^Primitives/ });
  const total = Number(/\d+/.exec((await primitives.textContent()) ?? "")?.[0] ?? "0");
  expect(total).toBeGreaterThan(30);
  await primitives.click();
  await gallery(page).first().click();
  const viewport = page.getByTestId("viewport");
  await expectRenderer(viewport.locator("canvas"));
  // The first asset is drawn when the stage has counted a frame; its geometry count is the baseline. A slow machine takes longer to get here, never reads early.
  await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  // The baseline is read once the count has held across two samples: the WebGPU renderer registers one of
  // its own geometry after the first frame, and on a loaded runner that can land after the stage reports
  // frames, so a first reading can be one short (R21).
  const baseline = await settledBuilds(viewport, "data-gpu-geometries");

  const next = page.getByRole("button", { name: "Next asset" });
  for (let i = 0; i < total; i++) {
    // eslint-disable-next-line no-await-in-loop -- each click replaces the asset the stage shows, so the stage loads one asset and frees the last
    await next.click();
  }
  // Back at the first asset. The stage may have been mounted again on the way, so its counters can be missing until it reports: the wait is on them.
  await expect(page.getByRole("dialog")).toContainText(position(1, total), { timeout: STAGE_WAIT });
  await expect.poll(async () => Number(await viewport.getAttribute("data-gpu-geometries")), { message: "the geometry count is back at the first asset's", timeout: STAGE_WAIT }).toBe(baseline);
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
    await expectRenderer(viewport.locator("canvas"));
    await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
    expect(await settledBuilds(viewport, "data-gpu-geometries")).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

for (const [id, name] of [
  ["fresnel-glow", "Fresnel glow"],
  ["height-gradient", "Height gradient"],
  ["pulse", "Pulse"],
  ["toon", "Toon outline"],
  ["refraction", "Refraction"],
  ["dissolve", "Dissolve"],
  ["hologram", "Hologram"],
] as const) {
  test(`the ${id} shader compiles and renders`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/?asset=${id}`);
    const viewport = page.getByRole("dialog", { name }).getByTestId("viewport");
    await expectRenderer(viewport.locator("canvas"));
    await expect(viewport.locator("canvas")).toBeVisible();
    await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
    expect(errors).toEqual([]);
  });
}

test("a scene kit renders with its own lights", async ({ page }) => {
  await page.goto("/?asset=scene-dusk");
  const viewport = page.getByRole("dialog", { name: "Dusk" }).getByTestId("viewport");
  await expectRenderer(viewport.locator("canvas"));
  // A kit builds its lights and every object in it before it draws; that first frame is slow under software rendering and under load.
  await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  expect(await settledBuilds(viewport, "data-gpu-geometries")).toBeGreaterThan(0);
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
  // The lit box against black: its pixels must span the box it was given, height to height. The frame is
  // read from a screenshot (decoded with the still rig's own PNG reader), not the canvas's buffer: a
  // WebGPU-drawn canvas holds nothing to `toDataURL` after G2 moves the embed to the WebGPU renderer.
  const png = await page.locator("canvas").screenshot();
  const extent = ((): { y0: number; y1: number; cx: number } | null => {
    const frame = decodePng(new Uint8Array(png));
    const { rgba, width, height } = frame;
    let top = height;
    let bottom = -1;
    let left = width;
    let right = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if ((rgba[i] ?? 0) + (rgba[i + 1] ?? 0) + (rgba[i + 2] ?? 0) > 60) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
    }
    if (bottom === -1) return null;
    return { y0: top / height, y1: (bottom + 1) / height, cx: (left + right + 1) / 2 / width };
  })();
  expect(extent).not.toBeNull();
  expect(extent?.y0).toBeCloseTo(0.25, 1);
  expect(extent?.y1).toBeCloseTo(0.75, 1);
  expect(extent?.cx).toBeCloseTo(0.5, 1);
  expect(errors).toEqual([]);
});

test("the embed page shows the glass its background, and paints the page colour exactly around it", async ({ page }) => {
  // The glass block fills the frame, so its interior is what transmission makes of the background: on white
  // it reads blue (blue 104 above red before the renderer swap; 38 with the background lost, which Wave 8
  // shipped as a follow-up), on black it is dark. The page still paints `bg` exactly outside it.
  const spec = {
    format: "lts-object-spec",
    version: 1,
    id: "glass-block",
    name: "Glass block",
    materials: { body: { preset: "glass" } },
    parts: [{ id: "body", shape: { type: "box", size: [1, 1, 1] }, material: "body" }],
  };
  await page.route("**/glass-spec.json", (route) => route.fulfill({ json: spec }));
  const shoot = async (background: string): Promise<ReturnType<typeof decodePng>> => {
    await page.goto(`/embed.html?spec=/glass-spec.json&width=360&height=360&bg=${encodeURIComponent(background)}`);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const state: unknown = Reflect.get(window, "__ltsEmbed");
            return typeof state === "object" && state !== null && "status" in state ? String(state.status) : "missing";
          }),
        { timeout: 20_000 },
      )
      .toBe("drawn");
    const png = await page.locator("canvas").screenshot({ animations: "disabled" });
    return decodePng(new Uint8Array(png));
  };
  const pixel = (frame: ReturnType<typeof decodePng>, x: number, y: number): readonly number[] => {
    const at = (y * frame.width + x) * 4;
    return [frame.rgba[at] ?? 0, frame.rgba[at + 1] ?? 0, frame.rgba[at + 2] ?? 0];
  };
  const white = await shoot("#ffffff");
  const black = await shoot("#000000");
  // The page's background, untouched, at the corners of the frame.
  for (const [x, y] of [[1, 1], [white.width - 2, 1], [1, white.height - 2], [white.width - 2, white.height - 2]] as const) {
    expect(pixel(white, x, y), "white background").toEqual([255, 255, 255]);
    expect(pixel(black, x, y), "black background").toEqual([0, 0, 0]);
  }
  // The object holds the background: on white its interior is the blue the pre-swap picture had.
  const [red, , blue] = pixel(white, Math.floor(white.width / 2), Math.floor(white.height / 2));
  expect((blue ?? 0) - (red ?? 0), "the glass transmits the white background").toBeGreaterThan(70);
});

test("icons: the core set comes first, then open-source packs with their credit", async ({ page }) => {
  await page.goto("/?view=icons");
  await expect(page.getByRole("heading", { name: "Icons", exact: true })).toBeVisible();
  const pack = page.getByRole("combobox", { name: "Pack", exact: true });
  await expect(pack).toHaveValue("core");
  const groups = await pack.locator("optgroup").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("label")));
  expect(groups).toEqual(["LuminosiTS", "Open source"]);
  await expect(page.getByText("37 icons")).toBeVisible();
  await page.getByRole("list", { name: "LuminosiTS core icons" }).getByRole("button", { name: "Icosahedron", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Icosahedron, from LuminosiTS core" })).toContainText('import { Icosahedron } from "@hedronite/lts-icons/react";');
});

test("the old icon-packs link opens the Icons view", async ({ page }) => {
  await page.goto("/?view=icon-packs&pack=lucide");
  await expect(page.getByRole("combobox", { name: "Pack", exact: true })).toHaveValue("lucide");
  await expect(page.getByRole("button", { name: "Icons", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("icon packs: pick a pack, see its credit, search it and copy an icon", async ({ page }) => {
  await page.goto("/?view=icons&pack=lucide");
  await expect(page.getByText("1808 icons")).toBeVisible();
  await expect(page.getByTestId("pack-credit")).toContainText("ISC");
  await expect(page.getByTestId("pack-credit")).toContainText("Lucide Icons and contributors");
  await page.getByRole("searchbox", { name: "Search this pack" }).fill("arrow-right");
  await expect(page.getByText(/^\d+ of 1808 icons$/)).toBeVisible();
  await page.getByRole("list", { name: "Lucide icons" }).getByRole("button", { name: "Arrow right", exact: true }).click();
  const detail = page.getByRole("complementary", { name: "Arrow right, from Lucide" });
  await expect(detail).toContainText('import { arrowRight } from "@hedronite/lts-icons/packs/lucide";');
  await page.getByRole("combobox", { name: "Pack", exact: true }).selectOption("isocons-rounded-left");
  await expect(page.getByTestId("pack-credit")).toContainText("CC-BY-4.0");
  await expect(page.getByRole("list", { name: "Isocons rounded left icons" }).locator("svg").first()).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("looks: every look as a card, and picking one applies it", async ({ page }) => {
  await page.goto("/?view=looks");
  await expect(page.getByRole("heading", { name: "Looks", exact: true })).toBeVisible();
  await Promise.all(["Core", "VirtualMachinist", "Omarchy"].map(async (group) => expect(page.getByRole("heading", { name: new RegExp(`^${group}`) })).toBeVisible()));
  const card = page.getByRole("button", { name: /^Hedron Light/ });
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-preset", "hedron-light");
  await expect(page.getByLabel("Look", { exact: true })).toHaveValue("hedron-light");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("open source: folders by kind, each with its credit, and their pages readable in place", async ({ page }) => {
  await page.goto("/?view=open-source");
  await expect(page.getByRole("heading", { name: "Open source", exact: true })).toBeVisible();
  await Promise.all(["Icon sets", "Components", "Demos", "Agent skills"].map(async (kind) => expect(page.getByRole("heading", { name: kind })).toBeVisible()));

  await page.getByRole("button", { name: /^Interface skills/ }).click();
  await expect(page).toHaveURL(/set=jakubkrehel-skills/);
  await expect(page.getByTestId("folder-credit")).toContainText("Jakub Krehel");
  await expect(page.getByTestId("folder-credit")).toContainText("MIT");
  await page.getByRole("button", { name: "Read better-ui" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "UI polish" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Page" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // A deep link lands on the same page; back goes up a level.
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "UI polish" })).toBeVisible();
  await page.getByRole("button", { name: "Interface skills", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Interface skills" })).toBeVisible();
});

test("open source: an icon set leads to its packs in the Icons view", async ({ page }) => {
  await page.goto("/?view=open-source&set=isocons");
  await page.getByRole("button", { name: /^Isocons rounded left/ }).click();
  await expect(page.getByRole("combobox", { name: "Pack", exact: true })).toHaveValue("isocons-rounded-left");
  await expect(page).not.toHaveURL(/set=/);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  for (const view of ["assets", "icons", "looks", "effects", "open-source", "playground", "growth"] as const) {
    test(`the ${view} view fits the screen width`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(view === "assets" ? "/" : `/?view=${view}`);
      await expect(page.getByRole("button", { name: view === "open-source" ? "Open source" : new RegExp(`^${view}$`, "i") })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("main")).not.toBeEmpty();
      // Let lazy views render before measuring.
      await expect(page.getByText(/^Loading/)).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }

  test("the views stay in reach while scrolling", async ({ page }) => {
    await page.goto("/?view=looks");
    await page.mouse.wheel(0, 2000);
    await expect(page.getByRole("navigation", { name: "Views" })).toBeInViewport();
  });

  test("a skill page reads without sideways scrolling", async ({ page }) => {
    await page.goto("/?view=open-source&set=ai-design-skills&item=landing-page-design&page=skills/landing-page-design/SKILL.md");
    await expect(page.getByRole("heading", { level: 2, name: "Landing Page Design" })).toBeVisible();
    // The page's Markdown loads on its own; measure once it is in.
    await expect(page.getByText("Loading…")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

for (const [id, name] of [
  ["clearcoat", "Clearcoat"],
  ["fabric", "Fabric"],
  ["glass-frosted", "Frosted glass"],
  ["iridescent", "Iridescent"],
  ["metal-anodized", "Anodized metal"],
  ["rubber", "Rubber"],
] as const) {
  test(`the ${id} material renders`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/?asset=${id}`);
    const viewport = page.getByRole("dialog", { name }).getByTestId("viewport");
    await expectRenderer(viewport.locator("canvas"));
    await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/);
    expect(await settledBuilds(viewport, "data-gpu-geometries")).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}
