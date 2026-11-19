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

/** Waits until the stage has attached everything it will (the count is positive and holds across two samples), and returns it: the baseline for a flat check. */
export async function settledBuilds(host: Locator): Promise<number> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const before = last;
        await host.page().waitForTimeout(400);
        last = await builds(host);
        return last > 0 && last === before;
      },
      { message: "the build count settles", timeout: 20_000 },
    )
    .toBe(true);
  return last;
}

export { expect };
