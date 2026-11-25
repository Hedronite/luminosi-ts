import type { Credit } from "@hedronite/lts-core";
import type { Scene, SceneLook, SceneNode } from "../schema.js";

/** A number as source text: the shortest form that reads back as the same number, negative zero kept. */
export function num(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`${String(value)} has no source form`);
  return Object.is(value, -0) ? "-0" : String(value);
}

/** A list of numbers as an array literal. */
export const vec = (values: readonly number[]): string => `[${values.map(num).join(", ")}]`;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * A JSON value as a TypeScript literal: object keys in alphabetical order, so equal values give equal text. A key that is
 * not a plain name is quoted, and `__proto__` is written as a computed key so it is a key and not the prototype.
 */
export function literal(value: unknown): string {
  if (typeof value === "number") return num(value);
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length === 0) return "{}";
    const key = (name: string): string => (name === "__proto__" ? '["__proto__"]' : IDENTIFIER.test(name) ? name : JSON.stringify(name));
    return `{ ${entries.map(([name, item]) => `${key(name)}: ${literal(item)}`).join(", ")} }`;
  }
  throw new TypeError(`${typeof value} has no source form`);
}

/** One node in the order the code is written: parents before their children, siblings in document order. */
export interface Entry {
  readonly node: SceneNode;
  /** The index of the parent entry, or -1 for a node of the scene's root. */
  readonly parent: number;
  /** The indexes of the child entries. */
  readonly children: number[];
}

/**
 * The nodes as a forest, written parent first. A node whose parent is no node's id stands at the root; a node in a cycle
 * has no way in from the root and is left out. `checkRefs` reports both, and a checked document has neither. A node
 * is never named by its id in code: entries are numbered.
 */
export function forest(scene: Scene): readonly Entry[] {
  const byId = new Map(scene.nodes.map((node, index) => [node.id, index] as const));
  const under = scene.nodes.map((): number[] => []);
  const roots: number[] = [];
  scene.nodes.forEach((node, index) => {
    const parent = node.parent === null ? undefined : byId.get(node.parent);
    if (parent === undefined || parent === index) roots.push(index);
    else under[parent]?.push(index);
  });
  const entries: Entry[] = [];
  const visit = (index: number, parent: number): void => {
    const node = scene.nodes[index];
    if (node === undefined) return;
    const at = entries.length;
    entries.push({ node, parent, children: [] });
    entries[parent]?.children.push(at);
    for (const child of under[index] ?? []) visit(child, at);
  };
  for (const root of roots) visit(root, -1);
  return entries;
}

/** The uniform scale a primitive's or a framed solid's `scale` parameter asks for, or undefined. It scales the asset, not the node's children. */
export function assetScale(node: SceneNode): number | undefined {
  if (node.asset.kind === "object") return undefined;
  const scale = node.asset.params?.["scale"];
  return typeof scale === "number" ? scale : undefined;
}

/** The look as `const palette` source, and the names it needs from the tokens package. */
export function lookSource(look: SceneLook): { readonly values: readonly string[]; readonly types: readonly string[]; readonly lines: readonly string[] } {
  if (typeof look !== "string") {
    const { base, accent, metal, glass, emissive } = look;
    return { values: [], types: ["ScenePalette"], lines: ["const palette: ScenePalette = {", ...Object.entries({ base, accent, metal, glass, emissive }).map(([name, hex]) => `  ${name}: ${JSON.stringify(hex)},`), "};"] };
  }
  if (look === "neutral") return { values: ["neutral"], types: [], lines: ["const palette = neutral.scene;"] };
  // A look the tokens do not have is an error in the module, as it is in `createScene`, not a quiet change of look.
  return {
    values: ["presets"],
    types: [],
    lines: [`const chosen = presets.find((preset) => preset.id === ${JSON.stringify(look)});`, `if (chosen === undefined) throw new Error(${JSON.stringify(`no look named "${look}"`)});`, "const palette = chosen.scene;"],
  };
}

/** `{ a, b, type C }`, the names in order. */
export const names = (values: readonly string[], types: readonly string[] = []): string => `{ ${[...values, ...types.map((name) => `type ${name}`)].join(", ")} }`;

/** One import line. The module comes in as a value, so this package's own source never reads like an import of it. */
export const importLine = (clause: string, module: string): string => `import ${clause} from ${JSON.stringify(module)};`;

/** What an emitter is given besides the document: the credits of what it uses (`creditsFor`), which the code carries. None, and the code has none. */
export interface EmitOptions {
  readonly credits?: readonly Credit[] | undefined;
}

/** Text as one line of a `//` comment: every line break (and every other control character) becomes a space, so nothing a credit says can end the comment and start code. */
const oneLine = (text: string): string => text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();

/** How the scene stands to the credited work, as the label of its line. */
const RELATION = { ported: "ported", adopted: "adopted", inspired: "inspired by" } as const;

/** The header of an emitted module: one `//` line for each credit, saying what it is, how the scene stands to the work (ported, adopted or inspired by), where the work lives and at which pin, under which license, and whose it is. */
export function creditHeader(credits: readonly Credit[]): readonly string[] {
  if (credits.length === 0) return [];
  return [
    "// This scene uses the work of others, credited here:",
    ...credits.map(({ subject, kind, relation, work, source, pin, license, licenseUrl, credit }) => {
      const terms = licenseUrl === undefined ? license : `${license} (${licenseUrl})`;
      return oneLine(`// - ${subject} (${kind}) ${RELATION[relation]}: ${work}; ${source}, pin ${pin}; license ${terms}; credit ${credit}.`);
    }),
  ];
}

/** The same credits as data the module exports, whole: JSON values in a literal, so no text of theirs is ever code. */
export function creditExport(credits: readonly Credit[]): readonly string[] {
  if (credits.length === 0) return [];
  return ["// The credits above, as data.", "export const credits = [", ...credits.map((credit) => `  ${literal(credit)},`), "] as const;"];
}

/** Whether a document has motion to emit: a track, and with it the player both emitters carry. */
export const hasMotion = (scene: Scene): boolean => scene.tracks.length > 0;

/**
 * The document's motion as source: the tracks, the clips and the rest pose as data, and a player with the same
 * semantics as the package's own runtime — the same easing tokens, the same drivers and triggers, and the rest pose
 * under reduced motion. Both emitters carry it, so an emitted scene plays exactly as `createScene` plays the document.
 * The emitter gives the player `motionTargets` (where a value is written) and calls `motionRuntime` and `motionApply`.
 */
export function motionSource(scene: Scene): readonly string[] {
  return [
    "// The document's motion, as data: the tracks, the clips and the pose the scene rests at.",
    "/** A value a track holds: the kinds a property path takes. */",
    "type MotionValue = readonly number[] | number | string | boolean;",
    "interface MotionTrack {",
    "  readonly id: string;",
    "  readonly target: string;",
    "  readonly keyframes: readonly { readonly time: number; readonly value: MotionValue; readonly easing?: string }[];",
    "  readonly driver?: string;",
    "  readonly trigger?: string;",
    "}",
    "interface MotionClip { readonly id: string; readonly tracks: readonly string[]; readonly easing?: string }",
    "interface MotionDocument { readonly tracks: readonly MotionTrack[]; readonly clips: readonly MotionClip[]; readonly rest: Readonly<Record<string, MotionValue>> }",
    "/** What the drivers read each step. */",
    "export interface MotionInput {",
    "  readonly scroll?: { readonly progress: number; readonly smooth: number; readonly direction: -1 | 0 | 1 };",
    "  readonly pointer?: { readonly x: number; readonly y: number };",
    "  readonly hovered?: boolean;",
    "  readonly inView?: boolean;",
    "}",
    "/** Where a value is written: a node's object by id, and the camera. */",
    "interface MotionTargets {",
    "  object(id: string): Object3D | undefined;",
    "  cameraPosition(x: number, y: number, z: number): void;",
    "  cameraTarget(x: number, y: number, z: number): void;",
    "  cameraFov(fov: number): void;",
    "}",
    "",
    `const motionDocument: MotionDocument = ${literal({ tracks: scene.tracks, clips: scene.clips, rest: scene.rest })};`,
    "/** The easing tokens a document names, as curves: the package's own. */",
    "const motionEasings: Readonly<Record<string, (t: number) => number>> = {",
    "  enter: (t) => 1 - (1 - t) ** 3,",
    "  exit: (t) => t ** 3,",
    "  settle: (t) => 1 - (1 - t) ** 2,",
    "  standard: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),",
    "  linear: (t) => t,",
    "};",
    "const motionEasingOf = (token: string | undefined): ((t: number) => number) => (token === undefined ? undefined : motionEasings[token]) ?? motionEasings[\"standard\"] ?? ((t) => t);",
    "const motionMix = (from: number, to: number, t: number): number => from + (to - from) * t;",
    "const motionVec3 = (value: MotionValue): value is readonly [number, number, number] => Array.isArray(value) && value.length === 3 && value.every((one) => typeof one === \"number\");",
    "const motionSpanOf = (track: MotionTrack): number => track.keyframes[track.keyframes.length - 1]?.time ?? 0;",
    "const motionClipEasingOf = (track: MotionTrack): string | undefined => motionDocument.clips.find((clip) => clip.tracks.includes(track.id))?.easing;",
    "/** The value a track has at `time` seconds: before the first keyframe the first, after the last the last, between two the eased interpolation. */",
    "const motionValueAt = (track: MotionTrack, time: number, fallback?: string): MotionValue => {",
    "  const frames = track.keyframes;",
    "  const first = frames[0];",
    "  if (first === undefined) throw new Error(\"a track has keyframes\");",
    "  if (time <= first.time) return first.value;",
    "  for (let at = 1; at < frames.length; at += 1) {",
    "    const previous = frames[at - 1];",
    "    const next = frames[at];",
    "    if (previous === undefined || next === undefined || time > next.time) continue;",
    "    const span = next.time - previous.time;",
    "    const raw = span <= 0 ? 1 : (time - previous.time) / span;",
    "    if (raw >= 1) return next.value;",
    "    const t = motionEasingOf(previous.easing ?? fallback)(raw);",
    "    if (typeof previous.value === \"number\" && typeof next.value === \"number\") return motionMix(previous.value, next.value, t);",
    "    if (motionVec3(previous.value) && motionVec3(next.value)) return [motionMix(previous.value[0], next.value[0], t), motionMix(previous.value[1], next.value[1], t), motionMix(previous.value[2], next.value[2], t)] as const;",
    "    return previous.value;",
    "  }",
    "  return frames[frames.length - 1]?.value ?? first.value;",
    "};",
    "/** The document's tracks played by a clock the caller advances: the package's own runtime, written out. */",
    "function motionRuntime(reducedMotion: boolean) {",
    "  const played = new Map(motionDocument.tracks.map((track) => [track.id, { clock: 0, progress: 0, started: false, fired: false }]));",
    "  const values = new Map<string, MotionValue>();",
    "  for (const track of motionDocument.tracks) {",
    "    const rest = motionDocument.rest[track.target];",
    "    if (rest !== undefined) values.set(track.target, rest);",
    "  }",
    "  const same = (a: MotionValue | undefined, b: MotionValue | undefined): boolean => (Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] && a[2] === b[2] : a === b);",
    "  const startOf = (track: MotionTrack, state: { readonly fired: boolean }, input: MotionInput): boolean => {",
    "    if (reducedMotion) return false;",
    "    switch (track.trigger ?? \"load\") {",
    "      case \"hover\":",
    "        return input.hovered === true;",
    "      case \"in-view\":",
    "        return input.inView === true && !state.fired;",
    "      case \"scroll-scrub\":",
    "        return input.scroll !== undefined;",
    "      default:",
    "        return true;",
    "    }",
    "  };",
    "  /** One step: the seconds since the last, and what the drivers read. */",
    "  const step = (seconds: number, input: MotionInput = {}): void => {",
    "    const dt = Math.max(0, seconds);",
    "    for (const track of motionDocument.tracks) {",
    "      const state = played.get(track.id);",
    "      if (state === undefined) continue;",
    "      const driver = track.driver ?? \"time\";",
    "      const span = motionSpanOf(track);",
    "      const fires = startOf(track, state, input);",
    "      if (driver === \"scroll\") {",
    "        const next = Math.min(1, Math.max(0, input.scroll?.smooth ?? 0));",
    "        state.progress = next;",
    "        state.started = fires && next > 0;",
    "        values.set(track.target, motionValueAt(track, next * span, motionClipEasingOf(track)));",
    "        continue;",
    "      }",
    "      if (track.trigger === \"hover\" && input.hovered !== true) state.started = false;",
    "      if (fires && !state.fired) {",
    "        state.started = true;",
    "        state.fired = true;",
    "        state.clock = 0;",
    "      }",
    "      if (!state.started) {",
    "        const rest = motionDocument.rest[track.target];",
    "        if (rest !== undefined) values.set(track.target, rest);",
    "        continue;",
    "      }",
    "      state.clock += driver === \"pointer\" ? dt * (Math.abs(input.pointer?.x ?? 0) + Math.abs(input.pointer?.y ?? 0)) : dt;",
    "      values.set(track.target, motionValueAt(track, Math.min(state.clock, span), motionClipEasingOf(track)));",
    "      if (driver === \"time\" && state.clock >= span) state.started = false;",
    "    }",
    "  };",
    "  return { step, values };",
    "}",
    "/** Writes every value onto the object or the camera it names. A parameter path is data only: nothing here writes a material's parameters. */",
    "const motionApply = (values: ReadonlyMap<string, MotionValue>, targets: MotionTargets): void => {",
    "  for (const [target, value] of values) {",
    "    if (target === \"camera.position\") {",
    "      if (motionVec3(value)) targets.cameraPosition(value[0], value[1], value[2]);",
    "      continue;",
    "    }",
    "    if (target === \"camera.target\") {",
    "      if (motionVec3(value)) targets.cameraTarget(value[0], value[1], value[2]);",
    "      continue;",
    "    }",
    "    if (target === \"camera.fov\") {",
    "      if (typeof value === \"number\") targets.cameraFov(value);",
    "      continue;",
    "    }",
    "    if (!target.startsWith(\"node.\") || !motionVec3(value)) continue;",
    "    const rest = target.slice(\"node.\".length);",
    "    const dot = rest.indexOf(\".\");",
    "    if (dot < 0) continue;",
    "    const object = targets.object(rest.slice(0, dot));",
    "    if (object === undefined) continue;",
    "    const field = rest.slice(dot + 1);",
    "    if (field === \"position\") object.position.set(value[0], value[1], value[2]);",
    "    else if (field === \"rotation\") object.rotation.set(value[0], value[1], value[2]);",
    "    else if (field === \"scale\") object.scale.set(value[0], value[1], value[2]);",
    "  }",
    "};",
    "",
  ];
}
