import { expect, test as base } from "@playwright/test";

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

export { expect };
