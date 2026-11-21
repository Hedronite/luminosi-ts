import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The scene element's test page (element.html, `@hedronite/lts-scene/element`; see STACK.md), built on its own after the catalog's build and into the same
// dist, as the still-frame rig's page is (vite.still.config.ts). A build of its own, because an entry added to the catalog's build shares modules with
// the 3D views, and the bundler then moves them into shared chunks: the catalog's budgeted bundles would change for a page that is a test harness.
// Its documents and poster are in element-public/, copied into the dist by this build and by no other, so the catalog's own build carries nothing of it.
export default defineConfig({
  publicDir: fileURLToPath(new URL("element-public", import.meta.url)),
  build: {
    emptyOutDir: false,
    rolldownOptions: {
      input: { element: fileURLToPath(new URL("element.html", import.meta.url)) },
    },
  },
});
