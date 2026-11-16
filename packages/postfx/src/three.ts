import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { CanvasTexture, Color, DataTexture, LinearFilter, MathUtils, RedFormat, Uniform, Vector2, type Camera, type Scene, type Texture, type WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { orderStack, screenEffectSchemas, type ScreenEffectConfig, type ScreenEffectId } from "./effects.js";
import { printSettings } from "./settings.js";
import { grainFragment, printFragment, smokeFragment, vertexShader } from "./glsl.js";
import { inksFor, type InkOptions, type Inks } from "./inks.js";

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
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

const color = (hex: string): Color => new Color(hex);

function inkUniforms(inks: Inks): Record<string, Uniform> {
  return {
    uCool0: new Uniform(color(inks.cool[0])),
    uCool1: new Uniform(color(inks.cool[1])),
    uCool2: new Uniform(color(inks.cool[2])),
    uWarm0: new Uniform(color(inks.warm[0])),
    uWarm1: new Uniform(color(inks.warm[1])),
    uWarm2: new Uniform(color(inks.warm[2])),
    uHot: new Uniform(color(inks.hot)),
    uRule: new Uniform(color(inks.rule)),
    uChroma: new Uniform(inks.chroma),
  };
}

/** What a print pass does each frame: its clocks, and the uniforms they drive. */
interface PrintState {
  readonly kind: "print";
  readonly id: ScreenEffectId;
  readonly pass: ShaderPass;
  readonly intro?: number;
  readonly scan?: { readonly period: number; readonly sweep: number };
  readonly lens: boolean;
  introClock: number;
  scanClock: number;
  lensNow: number;
}

interface SimpleState {
  readonly kind: "simple";
  readonly id: ScreenEffectId;
  readonly pass: ShaderPass;
}

type PassState = PrintState | SimpleState;

const uniform = (pass: ShaderPass, name: string): { value: unknown } => {
  const found = pass.uniforms[name];
  if (found === undefined) throw new Error(`the pass has no uniform ${name}`);
  return found;
};

function setNumber(pass: ShaderPass, name: string, value: number): void {
  uniform(pass, name).value = value;
}

/** A print pass configured for one effect: which levels it raises, where, and when. */
function printPass(effect: ScreenEffectConfig, inks: Inks, reduced: boolean): PrintState {
  const { values, ramp, intro, scan, lens } = printSettings(effect, reduced);
  const atlas = glyphAtlas(ramp);
  const uniforms: Record<string, Uniform> = {
    tDiffuse: new Uniform(null),
    uAtlas: new Uniform(atlas),
    uCount: new Uniform(ramp.length),
    uResolution: new Uniform(new Vector2(1, 1)),
    uDpr: new Uniform(1),
    uTime: new Uniform(0),
    uMouse: new Uniform(new Vector2(-10, -10)),
    ...Object.fromEntries(Object.entries(values).map(([name, value]) => [name, new Uniform(value)])),
    ...inkUniforms(inks),
  };
  const pass = new ShaderPass({ name: `screen-${effect.id}`, uniforms, vertexShader, fragmentShader: printFragment });
  return { kind: "print", id: effect.id, pass, ...(intro === undefined ? {} : { intro }), ...(scan === undefined ? {} : { scan }), lens, introClock: 0, scanClock: 0, lensNow: 0 };
}

function simplePass(effect: ScreenEffectConfig, inks: Inks): SimpleState {
  if (effect.id === "grain") {
    const p = screenEffectSchemas.grain.parse(effect.params ?? {});
    const uniforms = { tDiffuse: new Uniform(null), uResolution: new Uniform(new Vector2(1, 1)), uTime: new Uniform(0), uAmount: new Uniform(p.amount) };
    return { kind: "simple", id: "grain", pass: new ShaderPass({ name: "screen-grain", uniforms, vertexShader, fragmentShader: grainFragment }) };
  }
  if (effect.id === "smoke") {
    const p = screenEffectSchemas.smoke.parse(effect.params ?? {});
    const uniforms = {
      tDiffuse: new Uniform(null),
      uResolution: new Uniform(new Vector2(1, 1)),
      uTime: new Uniform(0),
      uIntensity: new Uniform(p.intensity),
      uCool: new Uniform(color(inks.cool[1])),
      uWarm: new Uniform(color(inks.warm[1])),
    };
    return { kind: "simple", id: "smoke", pass: new ShaderPass({ name: "screen-smoke", uniforms, vertexShader, fragmentShader: smokeFragment }) };
  }
  throw new Error(`${effect.id} is a print effect`);
}

const isPrint = (id: ScreenEffectId): boolean => id !== "smoke" && id !== "grain";

/**
 * Renders a scene through a stack of screen effects. Call `render(delta)` instead of
 * `renderer.render`, `setSize` when the canvas changes, `setPointer` for the lens, and `dispose` when
 * done. The stack is put in canonical order (smoke behind, prints, grain on top).
 */
export class ScreenEffects {
  readonly composer: EffectComposer;
  private readonly passes: readonly PassState[];
  private readonly renderer: WebGLRenderer;
  private readonly atlases: readonly Texture[];
  private pointer: ScreenPointer = null;
  private time = 0;
  private smokeSpeed = 1;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, stack: readonly ScreenEffectConfig[], options: ScreenEffectsOptions = {}) {
    this.renderer = renderer;
    const inks = inksFor(options.palette ?? neutral.scene, options);
    const reduced = options.reducedMotion === true;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    const ordered = orderStack(stack);
    this.passes = ordered.map((effect) => (isPrint(effect.id) ? printPass(effect, inks, reduced) : simplePass(effect, inks)));
    for (const state of this.passes) this.composer.addPass(state.pass);
    this.composer.addPass(new OutputPass());
    this.atlases = this.passes.flatMap((state) => {
      const atlas: unknown = state.pass.uniforms["uAtlas"]?.value;
      return atlas instanceof CanvasTexture || atlas instanceof DataTexture ? [atlas] : [];
    });
    const smoke = ordered.find((effect) => effect.id === "smoke");
    if (smoke !== undefined) this.smokeSpeed = screenEffectSchemas.smoke.parse(smoke.params ?? {}).speed;
    const size = renderer.getSize(new Vector2());
    this.setSize(size.x, size.y);
  }

  /** The effect ids in the order their passes run. */
  get ids(): readonly ScreenEffectId[] {
    return this.passes.map((state) => state.id);
  }

  /** Matches the canvas: width and height in CSS pixels. */
  setSize(width: number, height: number): void {
    const dpr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    for (const { pass } of this.passes) {
      const resolution: unknown = pass.uniforms["uResolution"]?.value;
      if (resolution instanceof Vector2) resolution.set(width * dpr, height * dpr);
      if (pass.uniforms["uDpr"] !== undefined) setNumber(pass, "uDpr", dpr);
    }
  }

  setPointer(pointer: ScreenPointer): void {
    this.pointer = pointer;
  }

  /** Advances the clocks by `delta` seconds and renders one frame. */
  render(delta: number): void {
    const step = Math.min(Math.max(delta, 0), 0.05);
    this.time += step;
    for (const state of this.passes) {
      if (state.pass.uniforms["uTime"] !== undefined) setNumber(state.pass, "uTime", state.id === "smoke" ? this.time * this.smokeSpeed : this.time);
      if (state.kind === "print") this.advance(state, step);
    }
    this.composer.render(step);
  }

  private advance(state: PrintState, step: number): void {
    const { pass } = state;
    let settled = true;
    if (state.intro !== undefined) {
      // Scatter in over 0.6 s, hold, then resolve; the whole intro takes `intro` seconds.
      state.introClock += step;
      const appear = Math.min(1, state.introClock / 0.6);
      const resolve = MathUtils.clamp((state.introClock - 0.9) / Math.max(0.1, state.intro - 0.9), 0, 1);
      setNumber(pass, "uAppear", appear);
      setNumber(pass, "uIntro", resolve * resolve * (3 - 2 * resolve));
      settled = state.introClock >= state.intro;
    }
    let scan = -1;
    if (state.scan !== undefined && settled) {
      state.scanClock = (state.scanClock + step) % state.scan.period;
      const progress = state.scanClock / state.scan.sweep;
      if (progress < 1) scan = 1.15 - progress * 1.3;
    }
    setNumber(pass, "uScan", scan);
    if (state.lens) {
      const mouse = uniform(pass, "uMouse").value;
      const target = this.pointer === null ? 0 : 1;
      if (this.pointer !== null && mouse instanceof Vector2) mouse.set(this.pointer.x, 1 - this.pointer.y);
      state.lensNow += (target - state.lensNow) * Math.min(1, step * 7);
      setNumber(pass, "uLens", state.lensNow);
    }
  }

  dispose(): void {
    for (const atlas of this.atlases) atlas.dispose();
    for (const { pass } of this.passes) pass.dispose();
    this.composer.dispose();
  }
}
