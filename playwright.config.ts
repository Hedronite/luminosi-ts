import { defineConfig, devices } from "@playwright/test";
import type { ConsoleOptions } from "./e2e/fixtures.js";

// Browser tests run against the built catalog and site (bun run build first), served by Playwright,
// or against running servers when E2E_CATALOG_URL and E2E_SITE_URL are set (bun run e2e:container).
const external = process.env["E2E_CATALOG_URL"] !== undefined && process.env["E2E_SITE_URL"] !== undefined;

export default defineConfig<ConsoleOptions>({
  testDir: "e2e",
  // Against a deployed container only the served pages are under test; the image-to-object review
  // runs local tooling on the local build, so it stays with the normal run.
  testIgnore: external ? ["**/review.spec.ts"] : [],
  forbidOnly: process.env["CI"] !== undefined,
  // On CI the 3D tests draw with software WebGL on shared runners: the first frame of a viewport
  // (three.js loaded, the studio environment baked) can take longer than the 5 s default, and did,
  // intermittently, from Hedronite/luminosi-ts#26 on. Locally the default stays.
  ...(process.env["CI"] === undefined ? {} : { expect: { timeout: 15_000 }, timeout: 60_000 }),
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env["E2E_CATALOG_URL"] ?? "http://localhost:4173",
    // Console warnings a test may see; any other warning fails it (see e2e/fixtures.ts). Each entry is a message
    // the app does not cause: nothing in apps/ or packages/ builds a THREE.Clock or sets a shadow map type.
    consoleAllow: [
      // three.js, through @react-three/fiber's render loop.
      /^THREE\.Clock: This module has been deprecated/,
      // @react-three/fiber asks for its default soft shadow map; WebGPURenderer swaps it for PCFShadowMap and says so.
      /^THREE\.WebGPURenderer: PCFSoftShadowMap has been removed/,
      // The runners and the test browser have no WebGPU: the renderer says so and draws through WebGL2 (swiftshader).
      /^THREE\.WebGPURenderer: WebGPU is not available, running under WebGL2 backend\./,
      /^No available adapters\.$/,
      // Chromium's own performance note when a test reads pixels back from the canvas.
      /GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels/,
    ],
  },
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
