import { BLACK, neutral, WHITE, type ScenePalette } from "@hedronite/lts-tokens";
import type { z } from "zod";
import { convertToTexture, pass, viewportOpaqueMipTexture } from "three/tsl";
import { CanvasTexture, DataTexture, LinearFilter, MathUtils, RedFormat, RenderPipeline, TextureNode, Vector2, ViewportTextureNode, type Camera, type Node, type RenderTarget, type Scene, type Texture, type WebGPURenderer } from "three/webgpu";
import { orderStack, screenEffectSchemas, type ScreenEffectConfig, type ScreenEffectId } from "./effects.js";
import { inksFor, type InkOptions, type Inks } from "./inks.js";
import { crtNode, floatUniform, grainNode, inkUniforms, printNode, smokeField, smokeNode, vec2Uniform, writeInks, type CrtUniforms, type FloatUniform, type InkUniforms, type PrintUniforms } from "./nodes.js";
import { isPrintId, mergePrintSettings, printGroups, resolveValues, type PrintId, type PrintSettings, type ScreenEffectUpdate, type ScreenEffectValues, type StackValues } from "./settings.js";

export type { ScreenEffectUpdate, ScreenEffectValues };

export interface ScreenEffectsOptions extends InkOptions {
  /** Scene colors the inks come from. Default: the neutral token preset. */
  readonly palette?: ScenePalette;
  /** Skip the intro and the scan sweep, and open the lens at once. */
  readonly reducedMotion?: boolean;
}

/** A pointer over the canvas, 0 to 1 from the top left, or null when it is away. */
export type ScreenPointer = { readonly x: number; readonly y: number } | null;

/**
 * What a stack is built from: the effects in order, and each ASCII ramp. Two stacks with the same
 * structure differ only in values `setParams` and `setInks` write, so one `ScreenEffects` serves both.
 * Pass the same `reducedMotion` as the options: it is structure too.
 */
export function stackStructure(stack: readonly ScreenEffectConfig[], reducedMotion = false): string {
  const ordered = orderStack(stack).map((effect) => (effect.id === "ascii" ? [effect.id, screenEffectSchemas.ascii.parse(effect.params ?? {}).ramp] : [effect.id]));
  return JSON.stringify([reducedMotion, ordered]);
}

/** Every parameter of every effect in `stack`, defaults filled in: `setParams` takes it to bring a built stack to these values. */
export function stackValues(stack: readonly ScreenEffectConfig[]): ScreenEffectUpdate {
  const { smoke, crystallize, dither, ascii, scan, lens, crt, grain } = resolveValues(stack);
  return { ...(smoke === undefined ? {} : { smoke }), ...(crystallize === undefined ? {} : { crystallize }), ...(dither === undefined ? {} : { dither }), ...(ascii === undefined ? {} : { ascii }), ...(scan === undefined ? {} : { scan }), ...(lens === undefined ? {} : { lens }), ...(crt === undefined ? {} : { crt }), ...(grain === undefined ? {} : { grain }) };
}

/** `current` with `update` laid over it and checked against the effect's schema; `current` itself when there is nothing to lay over. */
function merged<T extends object>(schema: z.ZodType<T>, current: T | undefined, update: Partial<T> | undefined): T | undefined {
  return current === undefined || update === undefined ? current : schema.parse({ ...current, ...update });
}

/**
 * Recolors a running stack's inks from a look, in place: its uniforms are written and nothing is rebuilt (the same passes, the same
 * programs). `options` are the same ink choices `inksFor` takes, such as a single `monochrome` ink. The caller asks for a new frame.
 */
export function applyPalette(effects: ScreenEffects, palette: ScenePalette, options: InkOptions = {}): void {
  effects.setInks(inksFor(palette, options));
}

/** A glyph atlas for the ASCII print: one cell per ramp character, white on black. */
function glyphAtlas(ramp: string): Texture {
  const cell = 48;
  const canvas = typeof document === "undefined" ? undefined : document.createElement("canvas");
  const context = canvas?.getContext("2d") ?? null;
  if (canvas === undefined || context === null) {
    // No 2D canvas (a worker, a test): a blank atlas, so ASCII prints nothing rather than failing.
    const blank = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat);
    blank.needsUpdate = true;
    return blank;
  }
  canvas.width = cell * ramp.length;
  canvas.height = cell;
  context.fillStyle = BLACK;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = WHITE;
  context.font = `600 ${String(cell * 0.9)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  // The ramp is printable ASCII (the schema checks), so one character is one glyph.
  for (let i = 0; i < ramp.length; i++) context.fillText(ramp.charAt(i), i * cell + cell / 2, cell / 2 + cell * 0.04);
  const atlas = new CanvasTexture(canvas);
  atlas.minFilter = LinearFilter;
  atlas.magFilter = LinearFilter;
  atlas.generateMipmaps = false;
  return atlas;
}

/** The `uuid` of each texture of the render target a pass or a texture node owns; none for a node that owns no target. */
function textureIds(owner: object): string[] {
  const target: unknown = Reflect.get(owner, "renderTarget");
  const held: unknown = typeof target === "object" && target !== null ? Reflect.get(target, "textures") : undefined;
  return Array.isArray(held) ? held.flatMap((texture: unknown) => (typeof texture === "object" && texture !== null && "uuid" in texture && typeof texture.uuid === "string" ? [texture.uuid] : [])) : [];
}

/** One print pass's clocks, and the uniforms they drive. `members` are the effects it does the work of. */
interface PrintState {
  readonly uniforms: PrintUniforms;
  readonly members: readonly PrintId[];
  intro: number | undefined;
  scan: { readonly period: number; readonly sweep: number } | undefined;
  lens: boolean;
  introClock: number;
  scanClock: number;
  lensNow: number;
}

/** Writes the values of a print pass that do not move with a clock. The clocks own intro, appear, scan and the lens opening. */
function writeStatic(u: PrintUniforms, settings: PrintSettings): void {
  const v = settings.values;
  u.base.value = v.uBase;
  u.scanDepth.value = v.uScanDepth;
  u.lensRadius.value = v.uLensRadius;
  u.lensDepth.value = v.uLensDepth;
  u.grain.value = v.uGrain;
  u.ditherPx.value = v.uDitherPx;
  u.asciiPx.value = v.uAsciiPx;
}

/**
 * A glass (transmission) material reads what is behind it from a copy of the frame, and three keeps one shared node for that
 * (`viewportOpaqueMipTexture`) that makes a framebuffer texture for every render target it is drawn into and never frees it. A
 * pipeline's scene pass has a target of its own, so every pipeline built over a glass node left one texture on the renderer for good.
 * Frees the copy made for `target`, the one this pipeline's scene pass drew into; a target that never drew a glass node has none, and nothing is made.
 */
function freeViewportCopy(target: RenderTarget): void {
  const sample = viewportOpaqueMipTexture();
  const shared = sample instanceof TextureNode ? sample.referenceNode : null;
  if (shared instanceof ViewportTextureNode) shared.getTextureForReference(target).dispose();
}

/**
 * Renders a scene through a stack of screen effects on three's WebGPURenderer (WebGPU, or WebGL 2
 * where WebGPU is missing), so surface shaders and screen effects share one renderer. Call
 * `render(delta)` instead of `renderer.render`, `setPointer` for the lens, and `dispose` when done. The
 * stack runs in canonical order: smoke behind, prints, the CRT tube, grain on top.
 *
 * The print effects (crystallize, dither, ASCII, scan, lens) share one pass, and print the highest
 * level each pixel asks for; before, each was a pass of its own over the one before, so a lens over
 * a scan printed a print of a print. Dither and ASCII both on the whole frame keep two passes, the
 * ASCII reading the dithered frame. The smoke is drawn at half size and upsampled.
 *
 * Values move without a rebuild: `setParams` writes effect parameters and `setInks` the inks into
 * uniforms. Only the structure (`stackStructure`: which effects, each ASCII ramp, reduced motion)
 * needs a new `ScreenEffects`.
 */
export class ScreenEffects {
  readonly pipeline: RenderPipeline;
  /** The effect ids in the order their passes run. */
  readonly ids: readonly ScreenEffectId[];
  /** The full-screen passes after the scene's own, in order: "smoke", "print" (one per print pass), "crt", "grain". */
  readonly passes: readonly string[];
  private readonly renderer: WebGPURenderer;
  private readonly prints: readonly PrintState[];
  private readonly time = floatUniform(0);
  private readonly smokeTime = floatUniform(0);
  private readonly textures: readonly Texture[];
  /** The targets between passes, and the smoke's own, which this owns. */
  private readonly targets: readonly TextureNode[];
  private readonly smokeIntensity = floatUniform(1);
  private readonly grainAmount = floatUniform(0);
  private readonly crt: CrtUniforms = { curvature: floatUniform(1), pitch: floatUniform(2), aberration: floatUniform(1), motion: floatUniform(1) };
  private readonly inks: InkUniforms;
  /** The parameters now in force for each effect in the stack, complete. */
  private values: StackValues;
  /** The ramp the ASCII pass was built with: the one parameter that cannot change in place. */
  private readonly ramp: string | undefined;
  /** Pixel ratio the print and CRT passes size their cells and lines by. */
  private readonly dpr: FloatUniform;
  private pointer: ScreenPointer = null;
  private readonly reduced: boolean;
  /** The pass that draws the scene, with the render target it owns: freed by `dispose`. */
  private readonly scenePass: ReturnType<typeof pass>;
  /** The `uuid` of every render-target texture this pipeline holds, read once from the objects it built (see `targetIds`). */
  private readonly held: readonly string[];

  constructor(renderer: WebGPURenderer, scene: Scene, camera: Camera, stack: readonly ScreenEffectConfig[], options: ScreenEffectsOptions = {}) {
    this.renderer = renderer;
    this.inks = inkUniforms(inksFor(options.palette ?? neutral.scene, options));
    this.dpr = floatUniform(renderer.getPixelRatio());
    this.reduced = options.reducedMotion === true;
    this.values = resolveValues(stack);
    this.ids = orderStack(stack).map((effect) => effect.id);
    this.ramp = this.values.ascii?.ramp;

    const prints: PrintState[] = [];
    const textures: Texture[] = [];
    const targets: TextureNode[] = [];
    const passes: string[] = [];
    const scenePass = pass(scene, camera);
    this.scenePass = scenePass;
    // Each pass reads the one before as a texture, since prints sample their input at cell centres.
    let output: Node = scenePass.getTextureNode();
    let first = true;
    const source = (): TextureNode => {
      if (first) {
        first = false;
        return scenePass.getTextureNode();
      }
      const target = convertToTexture(output);
      // Only a target this made is this's to free: a node that already was a texture comes back as it is.
      if ("isRTTNode" in target) targets.push(target);
      return target;
    };
    let printed = false;
    for (const id of this.ids) {
      if (isPrintId(id)) {
        if (printed) continue;
        printed = true;
        for (const members of printGroups(this.ids)) {
          const settings = mergePrintSettings(this.values, members, this.reduced);
          const v = settings.values;
          const uniforms: PrintUniforms = {
            time: this.time,
            dpr: this.dpr,
            base: floatUniform(v.uBase),
            intro: floatUniform(v.uIntro),
            appear: floatUniform(v.uAppear),
            scan: floatUniform(v.uScan),
            scanDepth: floatUniform(v.uScanDepth),
            lens: floatUniform(v.uLens),
            lensRadius: floatUniform(v.uLensRadius),
            lensDepth: floatUniform(v.uLensDepth),
            grain: floatUniform(v.uGrain),
            ditherPx: floatUniform(v.uDitherPx),
            asciiPx: floatUniform(v.uAsciiPx),
            mouse: vec2Uniform(new Vector2(-10, -10)),
          };
          const atlas = glyphAtlas(settings.ramp);
          textures.push(atlas);
          output = printNode(source(), uniforms, this.inks, atlas, settings.ramp.length);
          passes.push("print");
          prints.push({ uniforms, members, intro: settings.intro, scan: settings.scan, lens: settings.lens, introClock: 0, scanClock: 0, lensNow: 0 });
        }
      } else if (id === "smoke") {
        // The field is its own half-size target; the scene's pixels meet it in the pass that follows.
        const field = smokeField(this.smokeTime, this.inks, this.smokeIntensity);
        targets.push(field);
        output = smokeNode(source(), field);
        passes.push("smoke");
      } else if (id === "grain") {
        output = grainNode(source(), this.time, this.grainAmount);
        passes.push("grain");
      } else {
        output = crtNode(source(), this.time, this.dpr, this.inks, this.crt);
        passes.push("crt");
      }
    }
    this.writeValues();
    this.prints = prints;
    this.textures = textures;
    this.targets = targets;
    this.passes = passes;
    this.pipeline = new RenderPipeline(renderer, output);
    this.held = [this.scenePass, ...this.targets].flatMap(textureIds);
  }

  /**
   * The `uuid` of every render-target texture this pipeline holds: the scene pass's own, the smoke field's, and the targets between passes.
   * A build gives it new ones and nothing else does (a parameter, a palette and a size are written into what is already there), so a
   * counter that keeps every uuid it has seen counts builds of the pipeline. Read-only; it reads the objects and never a name.
   */
  get targetIds(): readonly string[] {
    return this.held;
  }

  /** The speed the smoke's clock runs at. */
  private get smokeSpeed(): number {
    return this.values.smoke?.speed ?? 1;
  }

  /** Writes the effect values into the uniforms the non-print passes read. */
  private writeValues(): void {
    const v = this.values;
    this.smokeIntensity.value = v.smoke?.intensity ?? 1;
    this.grainAmount.value = v.grain?.amount ?? 0;
    this.crt.curvature.value = v.crt?.curvature ?? 1;
    this.crt.pitch.value = v.crt?.pitch ?? 2;
    this.crt.aberration.value = v.crt?.aberration ?? 1;
    // Reduced motion holds the tube still.
    this.crt.motion.value = this.reduced ? 0 : (v.crt?.motion ?? 1);
  }

  /**
   * Brings parameters of effects in the stack to new values without rebuilding a pass: the uniforms
   * take them on the next frame. A parameter you leave out keeps its value, and an effect that is not in
   * the stack is ignored. Values are checked against each effect's schema, and a bad one throws before
   * anything changes. An ASCII `ramp` is part of the structure (see `stackStructure`): a different one
   * throws, and wants a new `ScreenEffects`.
   */
  setParams(update: ScreenEffectUpdate): void {
    const v = this.values;
    const next: StackValues = {
      smoke: merged(screenEffectSchemas.smoke, v.smoke, update.smoke),
      crystallize: merged(screenEffectSchemas.crystallize, v.crystallize, update.crystallize),
      dither: merged(screenEffectSchemas.dither, v.dither, update.dither),
      ascii: merged(screenEffectSchemas.ascii, v.ascii, update.ascii),
      scan: merged(screenEffectSchemas.scan, v.scan, update.scan),
      lens: merged(screenEffectSchemas.lens, v.lens, update.lens),
      crt: merged(screenEffectSchemas.crt, v.crt, update.crt),
      grain: merged(screenEffectSchemas.grain, v.grain, update.grain),
    };
    if (next.ascii !== undefined && next.ascii.ramp !== this.ramp) throw new Error("setParams cannot change the ASCII ramp: build a new ScreenEffects");
    this.values = next;
    this.writeValues();
    for (const state of this.prints) {
      if (!state.members.some((id) => next[id] !== v[id])) continue;
      const settings = mergePrintSettings(next, state.members, this.reduced);
      writeStatic(state.uniforms, settings);
      state.intro = settings.intro;
      state.scan = settings.scan;
      state.lens = settings.lens;
    }
  }

  /** Recolours every pass in place, from inks made with `inksFor`. */
  setInks(inks: Inks): void {
    writeInks(this.inks, inks);
  }

  setPointer(pointer: ScreenPointer): void {
    this.pointer = pointer;
  }

  /** Call when the canvas or its pixel ratio changes; the pipeline itself follows the renderer's size. */
  setSize(): void {
    this.dpr.value = this.renderer.getPixelRatio();
  }

  /** Advances the clocks by `delta` seconds and renders one frame. */
  render(delta: number): void {
    const step = Math.min(Math.max(delta, 0), 0.05);
    this.time.value += step;
    this.smokeTime.value += step * this.smokeSpeed;
    for (const state of this.prints) this.advance(state, step);
    this.pipeline.render();
  }

  private advance(state: PrintState, step: number): void {
    const u = state.uniforms;
    let settled = true;
    if (state.intro !== undefined) {
      // Scatter in over 0.6 s, hold, then resolve; the whole intro takes `intro` seconds.
      state.introClock += step;
      u.appear.value = Math.min(1, state.introClock / 0.6);
      const resolve = MathUtils.clamp((state.introClock - 0.9) / Math.max(0.1, state.intro - 0.9), 0, 1);
      u.intro.value = resolve * resolve * (3 - 2 * resolve);
      settled = state.introClock >= state.intro;
    }
    let scan = -1;
    if (state.scan !== undefined && settled) {
      state.scanClock = (state.scanClock + step) % state.scan.period;
      const progress = state.scanClock / state.scan.sweep;
      // screenUV runs from the top: the band enters above the frame and sweeps down, as on hedronite.com.
      if (progress < 1) scan = -0.15 + progress * 1.3;
    }
    u.scan.value = scan;
    if (state.lens) {
      // Both the pointer and screenUV run from the top left.
      if (this.pointer !== null) u.mouse.value.set(this.pointer.x, this.pointer.y);
      const open = this.pointer === null ? 0 : 1;
      // Reduced motion: the lens is there or not, with no ease (and no frames needed to settle).
      state.lensNow = this.reduced ? open : state.lensNow + (open - state.lensNow) * Math.min(1, step * 7);
      u.lens.value = state.lensNow;
    }
  }

  dispose(): void {
    for (const texture of this.textures) texture.dispose();
    for (const target of this.targets) target.dispose();
    this.pipeline.dispose();
    freeViewportCopy(this.scenePass.renderTarget);
    this.scenePass.dispose();
  }
}
