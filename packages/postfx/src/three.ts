import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { convertToTexture, pass } from "three/tsl";
import { CanvasTexture, DataTexture, LinearFilter, MathUtils, RedFormat, RenderPipeline, Vector2, type Camera, type Node, type Scene, type Texture, type TextureNode, type WebGPURenderer } from "three/webgpu";
import { orderStack, screenEffectSchemas, type ScreenEffectConfig, type ScreenEffectId } from "./effects.js";
import { inksFor, type InkOptions } from "./inks.js";
import { crtNode, floatUniform, grainNode, printNode, smokeNode, vec2Uniform, type FloatUniform, type PrintUniforms } from "./nodes.js";
import { printSettings } from "./settings.js";

export interface ScreenEffectsOptions extends InkOptions {
  /** Scene colors the inks come from. Default: the neutral token preset. */
  readonly palette?: ScenePalette;
  /** Skip the intro and the scan sweep, and open the lens at once. */
  readonly reducedMotion?: boolean;
}

/** A pointer over the canvas, 0 to 1 from the top left, or null when it is away. */
export type ScreenPointer = { readonly x: number; readonly y: number } | null;

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
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
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

/** A print effect's clocks, and the uniforms they drive. */
interface PrintState {
  readonly uniforms: PrintUniforms;
  readonly intro?: number;
  readonly scan?: { readonly period: number; readonly sweep: number };
  readonly lens: boolean;
  introClock: number;
  scanClock: number;
  lensNow: number;
}

/**
 * Renders a scene through a stack of screen effects on three's WebGPURenderer (WebGPU, or WebGL 2
 * where WebGPU is missing), so surface shaders and screen effects share one renderer. Call
 * `render(delta)` instead of `renderer.render`, `setPointer` for the lens, and `dispose` when done. The
 * stack runs in canonical order: smoke behind, prints, the CRT tube, grain on top.
 */
export class ScreenEffects {
  readonly pipeline: RenderPipeline;
  /** The effect ids in the order their passes run. */
  readonly ids: readonly ScreenEffectId[];
  private readonly renderer: WebGPURenderer;
  private readonly prints: readonly PrintState[];
  private readonly time = floatUniform(0);
  private readonly smokeTime = floatUniform(0);
  private readonly textures: readonly Texture[];
  private readonly smokeSpeed: number;
  /** Pixel ratios the CRT passes size their lines by. */
  private readonly dprs: readonly FloatUniform[];
  private pointer: ScreenPointer = null;

  constructor(renderer: WebGPURenderer, scene: Scene, camera: Camera, stack: readonly ScreenEffectConfig[], options: ScreenEffectsOptions = {}) {
    this.renderer = renderer;
    const inks = inksFor(options.palette ?? neutral.scene, options);
    const reduced = options.reducedMotion === true;
    const ordered = orderStack(stack);
    this.ids = ordered.map((effect) => effect.id);
    const smoke = ordered.find((effect) => effect.id === "smoke");
    this.smokeSpeed = smoke === undefined ? 1 : screenEffectSchemas.smoke.parse(smoke.params ?? {}).speed;

    const prints: PrintState[] = [];
    const textures: Texture[] = [];
    const dprs: FloatUniform[] = [];
    const scenePass = pass(scene, camera);
    // Each effect reads the one before as a texture, since prints sample their input at cell centres.
    let input: TextureNode = scenePass.getTextureNode();
    let output: Node = input;
    for (const effect of ordered) {
      if (effect !== ordered[0]) input = convertToTexture(output);
      if (effect.id === "smoke") {
        output = smokeNode(input, this.smokeTime, inks, screenEffectSchemas.smoke.parse(effect.params ?? {}).intensity);
      } else if (effect.id === "grain") {
        output = grainNode(input, this.time, screenEffectSchemas.grain.parse(effect.params ?? {}).amount);
      } else if (effect.id === "crt") {
        const p = screenEffectSchemas.crt.parse(effect.params ?? {});
        const dpr = floatUniform(renderer.getPixelRatio());
        dprs.push(dpr);
        output = crtNode(input, this.time, dpr, inks, reduced ? { ...p, motion: 0 } : p);
      } else {
        const settings = printSettings(effect, reduced);
        const v = settings.values;
        const uniforms: PrintUniforms = {
          time: this.time,
          dpr: floatUniform(renderer.getPixelRatio()),
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
        output = printNode(input, uniforms, inks, atlas, settings.ramp.length);
        prints.push({
          uniforms,
          ...(settings.intro === undefined ? {} : { intro: settings.intro }),
          ...(settings.scan === undefined ? {} : { scan: settings.scan }),
          lens: settings.lens,
          introClock: 0,
          scanClock: 0,
          lensNow: 0,
        });
      }
    }
    this.prints = prints;
    this.textures = textures;
    this.dprs = dprs;
    this.pipeline = new RenderPipeline(renderer, output);
  }

  setPointer(pointer: ScreenPointer): void {
    this.pointer = pointer;
  }

  /** Call when the canvas or its pixel ratio changes; the pipeline itself follows the renderer's size. */
  setSize(): void {
    const dpr = this.renderer.getPixelRatio();
    for (const state of this.prints) state.uniforms.dpr.value = dpr;
    for (const uniform of this.dprs) uniform.value = dpr;
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
      state.lensNow += ((this.pointer === null ? 0 : 1) - state.lensNow) * Math.min(1, step * 7);
      u.lens.value = state.lensNow;
    }
  }

  dispose(): void {
    for (const texture of this.textures) texture.dispose();
    this.pipeline.dispose();
  }
}
