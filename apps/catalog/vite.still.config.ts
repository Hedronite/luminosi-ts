import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The still-frame rig's page (bun run stills, see STACK.md), built on its own after the catalog's build and into the same
// dist. A build of its own, because an entry added to the catalog's build shares modules with the 3D views, and the
// bundler then moves them into shared chunks: the catalog's budgeted bundles would change for a page nobody visits.
// The modules emitted for the scene fixtures (e2e/scenes/generated, see STACK.md) sit outside this package and import the libraries by name:
// they are resolved from the catalog's own modules, as the rig's scene page resolves them.
const fromCatalog: Plugin = {
  name: "scene-modules-resolve-from-the-catalog",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !/[\\/]e2e[\\/]scenes[\\/]/.test(importer) || source.startsWith(".") || source.startsWith("/")) return null;
    return this.resolve(source, fileURLToPath(new URL("src/sceneStill.ts", import.meta.url)), { ...options, skipSelf: true });
  },
};

export default defineConfig({
  plugins: [react(), fromCatalog],
  publicDir: false,
  build: {
    emptyOutDir: false,
    rolldownOptions: {
      input: { still: fileURLToPath(new URL("still.html", import.meta.url)) },
    },
  },
});
