import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const postersDir = fileURLToPath(new URL("../../assets/posters", import.meta.url));

const posterFiles = (): readonly string[] =>
  existsSync(postersDir)
    ? readdirSync(postersDir)
        .filter((name) => /^[a-z0-9-]+\.webp$/.test(name))
        .sort()
    : [];

/**
 * The gallery's posters, served under their own names at `/posters/<id>.webp` and not hashed into the script, so the page carries no
 * list of them. In `dev` the folder is served as it is; a build copies it into `dist/posters`. `postersVersion` goes on every request
 * (a hash of their bytes), so a poster that changed is fetched again.
 */
function posters(): Plugin {
  return {
    name: "lts-posters",
    configureServer(server) {
      server.middlewares.use("/posters", (request, response, next) => {
        const name = (request.url ?? "").slice(1).split("?")[0] ?? "";
        if (!posterFiles().includes(name)) {
          next();
          return;
        }
        response.setHeader("Content-Type", "image/webp");
        response.end(readFileSync(join(postersDir, name)));
      });
    },
    generateBundle() {
      for (const name of posterFiles()) this.emitFile({ type: "asset", fileName: `posters/${name}`, source: readFileSync(join(postersDir, name)) });
    },
  };
}

const postersVersion = (): string => {
  const hash = createHash("sha256");
  for (const name of posterFiles()) hash.update(name).update(readFileSync(join(postersDir, name)));
  return hash.digest("hex").slice(0, 8);
};

export default defineConfig({
  define: { __POSTERS_VERSION__: JSON.stringify(postersVersion()) },
  plugins: [react(), tailwindcss(), posters()],
  build: {
    rolldownOptions: {
      // The catalog, and the chrome-less embed page the image-to-object review renders with.
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        embed: fileURLToPath(new URL("embed.html", import.meta.url)),
      },
    },
  },
});
