// Studying vendored work: what each module in a vendored project is, what it leans on, and what it could
// become in the library. Reads source text only (the TypeScript parser, no type checking, nothing run).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, posix, relative } from "node:path";
import ts from "typescript";

/** Techniques a module shows, read from its imports and its text. */
export const techniques = [
  "tsl",
  "glsl",
  "fullscreen",
  "r3f",
  "react",
  "raw-webgl",
  "canvas-2d",
  "web-audio",
  "worker",
  "instancing",
  "post-processing",
  "noise",
  "raycasting",
  "geometry",
  "animation",
  "dom-ui",
] as const;
export type Technique = (typeof techniques)[number];

/** What a module most likely is, for adoption. */
export type Role = "tsl-material" | "glsl-shader" | "screen-shader" | "geometry" | "component" | "audio" | "ui" | "logic" | "types";

/** The library kind a role ports to, and the package that would hold it. */
export const roleTargets: Partial<Record<Role, { readonly kind: string; readonly package: string }>> = {
  "tsl-material": { kind: "shader", package: "@hedronite/lts-shaders" },
  "glsl-shader": { kind: "shader", package: "@hedronite/lts-shaders" },
  "screen-shader": { kind: "effect", package: "@hedronite/lts-postfx" },
  geometry: { kind: "primitive", package: "@hedronite/lts-primitives" },
  component: { kind: "object", package: "@hedronite/lts-adapters" },
};

export interface SourceFile {
  /** Relative to the studied folder, with forward slashes. */
  readonly path: string;
  readonly text: string;
}

export interface StudiedModule {
  readonly path: string;
  readonly lines: number;
  readonly role: Role;
  readonly techniques: readonly Technique[];
  readonly exports: readonly string[];
  /** Other modules in the folder this one imports, resolved to their paths. */
  readonly local: readonly string[];
  /** Packages it imports, by name (`three/tsl` counts as `three`). */
  readonly packages: readonly string[];
  /** Every module it pulls in, itself included, following local imports. */
  readonly closure: readonly string[];
  /** Imports nothing but three, React and R3F beyond its own folder: a candidate to port as it stands. */
  readonly selfContained: boolean;
}

export interface Study {
  readonly modules: readonly StudiedModule[];
  /** Packages across the folder and how many modules import each, most used first. */
  readonly packages: readonly { readonly name: string; readonly modules: number }[];
  readonly techniques: readonly { readonly technique: Technique; readonly modules: number }[];
  /** Modules worth porting first: self-contained, with a role the library has a kind for, smallest closure first. */
  readonly candidates: readonly { readonly path: string; readonly role: Role; readonly kind: string; readonly package: string; readonly closure: number }[];
}

const SOURCE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "public", ".git", ".github", ".claude", "coverage", "target"]);
/** Packages a self-contained module may use: the ones LuminosiTS already builds on. */
const BASE = new Set(["three", "react", "react-dom", "@react-three/fiber"]);

const packageName = (specifier: string): string => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
};

/** The module specifiers a file imports or re-exports, and the names it exports. */
function scan(file: SourceFile): { readonly specifiers: readonly string[]; readonly exports: readonly string[]; readonly onlyTypes: boolean } {
  const kind = file.path.endsWith(".tsx") || file.path.endsWith(".jsx") ? ts.ScriptKind.TSX : file.path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, false, kind);
  const specifiers: string[] = [];
  const exports: string[] = [];
  let values = 0;
  const exported = (node: ts.Node): boolean => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of source.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
      specifiers.push(statement.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exports.push(element.name.text);
      if (!statement.isTypeOnly) values++;
    } else if (ts.isExportAssignment(statement)) {
      exports.push("default");
      values++;
    } else if (exported(statement)) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) exports.push(declaration.name.text);
        values++;
      } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name !== undefined) {
        exports.push(statement.name.text);
        values++;
      } else if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && ts.isIdentifier(statement.name)) {
        exports.push(statement.name.text);
        if (ts.isEnumDeclaration(statement)) values++;
      }
    }
  }
  // Dynamic imports and workers: `import("./x")`, `new URL("./x.worklet.ts", import.meta.url)`.
  for (const match of file.text.matchAll(/(?:import\(|new URL\()\s*["'`](\.{1,2}\/[^"'`]+)["'`]/g)) if (match[1] !== undefined) specifiers.push(match[1]);
  return { specifiers, exports, onlyTypes: exports.length > 0 && values === 0 };
}

function detect(file: SourceFile, packages: readonly string[], specifiers: readonly string[]): readonly Technique[] {
  const text = file.text;
  const found = new Set<Technique>();
  const imports = (prefix: string) => specifiers.some((s) => s === prefix || s.startsWith(`${prefix}/`));
  if (specifiers.some((s) => s === "three/tsl" || s === "three/webgpu") || /\bNodeMaterial\b/.test(text)) found.add("tsl");
  if (/gl_FragColor|gl_FragCoord|void\s+main\s*\(|#version\s+\d|precision\s+(high|medium)p\s+float|\.(glsl|frag|vert)["'`]/.test(text)) found.add("glsl");
  // A pass over the whole frame: a full-screen triangle or quad, or the fragment's position over the
  // resolution. gl_FragCoord alone is often a surface shader's dither or noise seed, so it doesn't count.
  if (/-1,\s*-1,\s*3,\s*-1|PlaneGeometry\(\s*2\s*,\s*2\s*\)|gl_FragCoord\.xy\s*\/\s*u?(res|resolution|size|viewport)\b|\bfull-?screen\b/i.test(text)) found.add("fullscreen");
  if (imports("@react-three/fiber") || imports("@react-three/drei")) found.add("r3f");
  if (packages.includes("react")) found.add("react");
  if (/getContext\(\s*["'`](webgl2?|experimental-webgl)["'`]/.test(text)) found.add("raw-webgl");
  if (/getContext\(\s*["'`]2d["'`]/.test(text)) found.add("canvas-2d");
  if (/\b(AudioContext|AudioWorklet|OscillatorNode|AudioWorkletProcessor)\b/.test(text)) found.add("web-audio");
  if (/new\s+Worker\(|\.worklet\.|registerProcessor\(/.test(text)) found.add("worker");
  if (/\bInstanced(Mesh|BufferGeometry|BufferAttribute)\b|instanceMatrix/.test(text)) found.add("instancing");
  if (/\b(EffectComposer|RenderPipeline|PostProcessing|ShaderPass|RenderPass)\b|postprocessing/.test(text)) found.add("post-processing");
  if (/mx_noise|simplex|perlin|\bfbm\b|\bnoise\s*\(/i.test(text)) found.add("noise");
  if (/\bRaycaster\b|\.raycast\(|onPointer(Down|Move|Over)/.test(text)) found.add("raycasting");
  if (/\bBufferGeometry\b|setAttribute\(|\bBufferAttribute\b|\bGeometry\(/.test(text)) found.add("geometry");
  if (/requestAnimationFrame|useFrame\(|\.clock\b|\bClock\b/.test(text)) found.add("animation");
  if (/document\.(createElement|querySelector|getElementById)|\.innerHTML\b|addEventListener\(\s*["'`](click|input|change)/.test(text)) found.add("dom-ui");
  return techniques.filter((t) => found.has(t));
}

function roleOf(file: SourceFile, found: readonly Technique[], exports: readonly string[], onlyTypes: boolean): Role {
  const has = (t: Technique) => found.includes(t);
  if (onlyTypes) return "types";
  if (has("tsl") && /new\s+\w*NodeMaterial\b/.test(file.text)) return "tsl-material";
  if (has("glsl")) return has("fullscreen") ? "screen-shader" : "glsl-shader";
  if (has("web-audio")) return "audio";
  const tsx = file.path.endsWith(".tsx") || file.path.endsWith(".jsx");
  if (tsx && exports.some((name) => /^[A-Z]/.test(name)) && (has("r3f") || /<mesh|<group|<Canvas/.test(file.text))) return "component";
  if (has("geometry") && !has("dom-ui") && !tsx) return "geometry";
  if (has("dom-ui") || tsx) return "ui";
  return "logic";
}

/** The path a relative specifier in `from` points at, among `known`, trying the extensions a bundler would. */
function resolveLocal(from: string, specifier: string, known: ReadonlySet<string>): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  const stem = base.replace(/\.(js|jsx|mjs)$/, "");
  const tries = [base, ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].map((ext) => `${stem}${ext}`), ...["index.ts", "index.tsx", "index.js"].map((name) => `${base}/${name}`)];
  return tries.find((candidate) => known.has(candidate));
}

function count<T>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/** Studies a set of source files from one folder. Pure: give it the files. */
export function studyFiles(files: readonly SourceFile[]): Study {
  const known = new Set(files.map((file) => file.path));
  const scanned = files.map((file) => {
    const { specifiers, exports, onlyTypes } = scan(file);
    const local = [...new Set(specifiers.filter((s) => s.startsWith(".")).map((s) => resolveLocal(file.path, s, known)).filter((p) => p !== undefined))].sort();
    const packages = [...new Set(specifiers.filter((s) => !s.startsWith(".") && !s.startsWith("/") && !/^[a-z]+:/.test(s)).map(packageName))].sort();
    const found = detect(file, packages, specifiers);
    return { file, exports, local, packages, techniques: found, role: roleOf(file, found, exports, onlyTypes) };
  });
  const byPath = new Map(scanned.map((entry) => [entry.file.path, entry]));
  const closureOf = (start: string): readonly string[] => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      for (const dep of byPath.get(next)?.local ?? []) stack.push(dep);
    }
    return [...seen].sort();
  };
  const modules: StudiedModule[] = scanned
    .map((entry) => {
      const closure = closureOf(entry.file.path);
      const outside = new Set(closure.flatMap((path) => byPath.get(path)?.packages ?? []));
      return {
        path: entry.file.path,
        lines: entry.file.text.split("\n").length,
        role: entry.role,
        techniques: entry.techniques,
        exports: entry.exports,
        local: entry.local,
        packages: entry.packages,
        closure,
        selfContained: [...outside].every((name) => BASE.has(name)),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const packageCounts = count(modules.flatMap((m) => m.packages));
  const techniqueCounts = count(modules.flatMap((m) => m.techniques));
  const candidates = modules
    .flatMap((m) => {
      const target = roleTargets[m.role];
      return target === undefined || !m.selfContained ? [] : [{ path: m.path, role: m.role, kind: target.kind, package: target.package, closure: m.closure.length }];
    })
    .sort((a, b) => a.closure - b.closure || a.path.localeCompare(b.path));
  return {
    modules,
    packages: [...packageCounts].map(([name, n]) => ({ name, modules: n })).sort((a, b) => b.modules - a.modules || a.name.localeCompare(b.name)),
    techniques: techniques.filter((t) => techniqueCounts.has(t)).map((t) => ({ technique: t, modules: techniqueCounts.get(t) ?? 0 })).sort((a, b) => b.modules - a.modules),
    candidates,
  };
}

/** The source files under `dir` (skipping dependencies, build output and assets), relative to `dir`. */
export function readSources(dir: string, limitBytes = 400_000): readonly SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(join(at, entry.name));
      } else if (entry.isFile() && SOURCE.has(extname(entry.name)) && !entry.name.endsWith(".d.ts") && !/\.(test|spec)\.[jt]sx?$/.test(entry.name)) {
        const path = join(at, entry.name);
        // Bundled or minified output is not source to learn from.
        if (statSync(path).size > limitBytes) continue;
        files.push({ path: relative(dir, path).split("\\").join("/"), text: readFileSync(path, "utf8") });
      }
    }
  };
  walk(dir);
  return files;
}

/** The folder a vendored path studies from: the path itself if it is a folder, else the folder holding it. */
export function studyRoot(vendorDir: string, target: string): { readonly dir: string; readonly file?: string } | undefined {
  const full = join(vendorDir, target);
  if (!existsSync(full)) return undefined;
  return statSync(full).isDirectory() ? { dir: full } : { dir: dirname(full), file: relative(dirname(full), full).split("\\").join("/") };
}
