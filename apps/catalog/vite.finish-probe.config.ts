import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The finish R8 harness (finish-probe.html). Built on its own after the catalog's main build and into the same dist, so the
// probe's three/finished graph does not share chunks with the playground or gallery bundles (see vite.element.config.ts).
export default defineConfig({
  build: {
    emptyOutDir: false,
    rolldownOptions: {
      input: { "finish-probe": fileURLToPath(new URL("finish-probe.html", import.meta.url)) },
    },
  },
});