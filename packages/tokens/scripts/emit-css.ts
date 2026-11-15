// Writes dist/theme.css from the presets, after tsc has built dist/.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { presets, themeCss } from "../src/index.js";

await writeFile(join(import.meta.dirname, "../dist/theme.css"), themeCss(presets));
