import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the built catalog and site (bun run build first).
export default defineConfig({
  testDir: "e2e",
  forbidOnly: process.env["CI"] !== undefined,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:4173" },
  projects: [
    {
      name: "chromium",
      // Software WebGL, so 3D tests run the same on GPU-less CI runners.
      use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
    },
  ],
  webServer: [
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
