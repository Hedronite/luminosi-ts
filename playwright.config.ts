import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the built catalog and site (bun run build first), served by Playwright,
// or against running servers when E2E_CATALOG_URL and E2E_SITE_URL are set (bun run e2e:container).
const external = process.env["E2E_CATALOG_URL"] !== undefined && process.env["E2E_SITE_URL"] !== undefined;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: process.env["CI"] !== undefined,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: { baseURL: process.env["E2E_CATALOG_URL"] ?? "http://localhost:4173" },
  projects: [
    {
      name: "chromium",
      // Software WebGL, so 3D tests run the same on GPU-less CI runners.
      use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
    },
  ],
  webServer: external
    ? []
    : [
    {
      command: "bunx vite preview --port 4173 --strictPort",
      cwd: "apps/catalog",
      url: "http://localhost:4173",
      reuseExistingServer: process.env["CI"] === undefined,
    },
    {
      command: "bunx astro preview --port 4174",
      cwd: "apps/site",
      url: "http://localhost:4174",
      reuseExistingServer: process.env["CI"] === undefined,
    },
  ],
});
