import { readFileSync } from "node:fs";

const texturePatterns = [
  /\bTextureLoader\b/,
  /\btexture\s*\(/,
  /\.(png|jpg|jpeg|webp|ktx2|hdr)\b/i,
  /\bfrom\s+["'][^"']+\.(png|jpg|jpeg|webp|hdr)["']/i,
];

const rawColorPatterns = [
  /#[0-9a-f]{6}\b/i,
  /\bnew\s+Color\s*\(\s*["'#]/i,
  /\bnew\s+Color\s*\(\s*0x[0-9a-f]/i,
  /\bcolor\s*\(\s*0x[0-9a-f]/i,
  /\brgb\s*\(/i,
];

const noopPattern = /modulates:\s*\[\s*\]|modulates\s*=\s*\[\s*\]/;

export interface FinishScanHit {
  readonly rule: "texture" | "raw-color" | "no-op";
  readonly line: number;
  readonly text: string;
}

/** Scans finish graph sources for tripwires; used in unit tests and temporary plants. */
export function scanFinishSource(source: string, rules: readonly ("texture" | "raw-color" | "no-op")[]): FinishScanHit[] {
  const lines = source.split("\n");
  const hits: FinishScanHit[] = [];
  for (const rule of rules) {
    const patterns = rule === "texture" ? texturePatterns : rule === "raw-color" ? rawColorPatterns : [noopPattern];
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i] ?? "";
      if (text.trimStart().startsWith("//")) continue;
      if (patterns.some((pattern) => pattern.test(text))) hits.push({ rule, line: i + 1, text: text.trim() });
    }
  }
  return hits;
}

export function scanFinishFiles(files: readonly string[], rules: readonly ("texture" | "raw-color" | "no-op")[]): FinishScanHit[] {
  return files.flatMap((file) => scanFinishSource(readFileSync(file, "utf8"), rules));
}