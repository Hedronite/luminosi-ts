import { expect, test as base, type Locator } from "@playwright/test";

/** Options the Playwright config sets under `use`. */
export interface ConsoleOptions {
  /** Console warnings that may appear: any other warning fails the test that saw it. */
  readonly consoleAllow: readonly RegExp[];
}

/** `test` with one added rule: a console warning on a page the test opened fails it, unless the config allows that message. */
export const test = base.extend<ConsoleOptions>({
  consoleAllow: [[], { option: true }],
  page: async ({ page, consoleAllow }, use) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" && !consoleAllow.some((pattern) => pattern.test(message.text()))) warnings.push(message.text());
    });
    await use(page);
    expect(warnings, "unexpected console warnings (allow-list: consoleAllow in playwright.config.ts)").toEqual([]);
  },
});

/**
 * A stage's `data-builds`: how many distinct meshes and materials it has ever attached, by `uuid`. It never goes down, so a
 * remount raises it and nothing else does: an edit that moves a uniform, a new look and a pause leave it flat.
 */
export const builds = async (host: Locator): Promise<number> => Number(await host.getAttribute("data-builds"));

/**
 * An effects stage's `data-effect-builds`: how many distinct render-target textures its screen-effect pipeline has ever held, by
 * `uuid`. It never goes down either: a new pipeline (an effect added or removed, a new ramp, a remount) raises it, and a
 * parameter, a look, an ink and a pause leave it flat.
 */
export const effectBuilds = (host: Locator): Promise<number> => counted(host, "data-effect-builds");

/**
 * A count the page publishes onto `host`, as a number: 0 until the host and the count are there. It looks for a second at most, not for
 * the test's whole time, so a poll that reads it ends at its own timeout and says what it was waiting for (a bare `getAttribute` on a
 * host that is not there yet waits until the test times out, and the failure names the locator, not the count).
 */
export const counted = async (host: Locator, attribute: string): Promise<number> => Number(await host.getAttribute(attribute, { timeout: 1_000 }).catch(() => null));

/**
 * Waits until the stage has attached everything it will (`attribute`, `data-builds` unless said, is positive and holds across two samples),
 * and returns it: the baseline for a flat check.
 */
export async function settledBuilds(host: Locator, attribute = "data-builds"): Promise<number> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const before = last;
        await host.page().waitForTimeout(400);
        last = await counted(host, attribute);
        return last > 0 && last === before;
      },
      { message: `${attribute} settles`, timeout: 20_000 },
    )
    .toBe(true);
  return last;
}

/** Where the run draws: the WebGPU lane (`bun run e2e:webgpu`, a real GPU) or software WebGL, which is every other run and CI. */
const onWebGPULane = process.env["LTS_WEBGPU_LANE"] === "1";

/** The backends a viewport may report in this run: only `webgpu` on the WebGPU lane, where a fallback is a failure; `webgpu` or `webgl2` elsewhere. */
const allowedRenderers: readonly string[] = onWebGPULane ? ["webgpu"] : ["webgpu", "webgl2"];

/**
 * The viewport's `<canvas>` says which backend drew it: its `data-renderer` is one of `allowed`, which is
 * the lane's own list unless a test passes another. It waits for the attribute and fails on a canvas that never gets one, which is
 * how a viewport still on a classic `WebGLRenderer` is caught, and on one that reports a backend the lane does not allow. An explicit `allowed` wins
 * over the lane's list: the strict golden and stills lanes draw on a real GPU and are not the WebGPU lane, so their specs pass `["webgpu"]`.
 * `timeout` is how long it waits for the attribute (20 s, the first frame of a viewport). Returns what it read.
 */
export async function expectRenderer(locator: Locator, allowed: readonly string[] = allowedRenderers, timeout = 20_000): Promise<string> {
  await expect(locator, "data-renderer: the viewport says which backend drew it").toHaveAttribute("data-renderer", new RegExp(`^(${allowed.join("|")})$`), { timeout });
  return String(await locator.getAttribute("data-renderer"));
}

export { expect };
