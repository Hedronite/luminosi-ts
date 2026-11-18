import { defineConfig, devices } from "@playwright/test";
import type { ConsoleOptions } from "./e2e/fixtures.js";

// Browser tests run against the built catalog and site (bun run build first), served by Playwright,
// or against running servers when E2E_CATALOG_URL and E2E_SITE_URL are set (bun run e2e:container).
// The WebGPU lane (bun run e2e:webgpu, see STACK.md) is a script for a machine with a GPU, never part of the default run or CI:
// it exists only when LTS_WEBGPU_LANE is set, and then it is the only project.
const webgpuLane = process.env["LTS_WEBGPU_LANE"] === "1";
// The lane needs only the catalog, so a catalog URL alone (a tailnet HTTPS address, say) is an external run for it.
const external = process.env["E2E_CATALOG_URL"] !== undefined && (webgpuLane || process.env["E2E_SITE_URL"] !== undefined);

export default defineConfig<ConsoleOptions>({
  testDir: "e2e",
  // Against a deployed container only the served pages are under test; the image-to-object review
  // runs local tooling on the local build, so it stays with the normal run.
  testIgnore: [...(external ? ["**/review.spec.ts"] : []), ...(webgpuLane ? [] : ["**/webgpu.spec.ts"])],
  // Tests, not files, are what workers and CI shards divide: catalog.spec.ts alone is over half the suite.
  fullyParallel: true,
  // Locally every test draws with software WebGL, and each browser's GPU process takes one to three cores, so the default
  // (half the cores) overloads a machine shared with other work and first-frame tests miss the 5 s expect timeout.
  // CI keeps the default: one shard per runner, with the longer timeouts below.
  ...(process.env["CI"] === undefined ? { workers: 2 } : {}),
  forbidOnly: process.env["CI"] !== undefined,
  // On CI the 3D tests draw with software WebGL on shared runners: the first frame of a viewport
  // (three.js loaded, the studio environment baked) can take longer than the 5 s default, and did,
  // intermittently, from Hedronite/luminosi-ts#26 on. Locally the default stays.
  ...(process.env["CI"] === undefined ? {} : { expect: { timeout: 15_000 }, timeout: 60_000 }),
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env["E2E_CATALOG_URL"] ?? (webgpuLane ? "http://localhost:4175" : "http://localhost:4173"),
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
      // The software GL driver (ANGLE on swiftshader) ending a render pass early on a heavy frame.
      /GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): Running out of reserved outsideRenderPass queueSerial/,
    ],
  },
  projects: webgpuLane
    ? [
        {
          name: "webgpu",
          testMatch: "webgpu.spec.ts",
          // The real GPU through Metal, with WebGPU switched on: three's WebGPU renderer must find an adapter, not fall back to WebGL 2.
          // Not the software path the default project uses: a SwiftShader adapter would pass for the wrong reason, so the spec also
          // refuses a software adapter (SwiftShader, LLVM, or one that reports itself as a fallback).
          use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--enable-unsafe-webgpu", "--use-angle=metal"] } },
        },
      ]
    : [
        {
          name: "chromium",
          // Software WebGL, so 3D tests run the same on GPU-less CI runners.
          use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
        },
      ],
  webServer: external
    ? []
    : webgpuLane
      ? [
          // The built catalog on localhost, which is a secure context (navigator.gpu needs one). Its own port and never a reused
          // server, so the lane always runs against the build it just made.
          { command: "bunx vite preview --port 4175 --strictPort", cwd: "apps/catalog", url: "http://localhost:4175", reuseExistingServer: false },
        ]
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
