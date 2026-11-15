import { defineConfig, devices } from "@playwright/test";

// Smoke tests run against the built catalog (bun run build first).
export default defineConfig({
  testDir: "e2e",
  forbidOnly: process.env["CI"] !== undefined,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:4173" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bunx vite preview --port 4173 --strictPort",
    cwd: "apps/catalog",
    url: "http://localhost:4173",
    reuseExistingServer: process.env["CI"] === undefined,
  },
});
