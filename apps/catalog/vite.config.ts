import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      // The catalog, the chrome-less embed page the image-to-object review renders with, and the still-frame rig (bun run stills).
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        embed: fileURLToPath(new URL("embed.html", import.meta.url)),
        still: fileURLToPath(new URL("still.html", import.meta.url)),
      },
    },
  },
});
