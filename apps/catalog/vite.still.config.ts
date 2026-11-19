import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The still-frame rig's page (bun run stills, see STACK.md), built on its own after the catalog's build and into the same
// dist. A build of its own, because an entry added to the catalog's build shares modules with the 3D views, and the
// bundler then moves them into shared chunks: the catalog's budgeted bundles would change for a page nobody visits.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    emptyOutDir: false,
    rolldownOptions: {
      input: { still: fileURLToPath(new URL("still.html", import.meta.url)) },
    },
  },
});
