// R8 finish measurement harness for e2e (finish-probe.html). Built as its own Vite entry, not part of the catalog app bundle.
import { Color, Mesh, MeshPhysicalMaterial, PMREMGenerator, PerspectiveCamera, Scene, SphereGeometry } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshPhysicalNodeMaterial, WebGPURenderer } from "three/webgpu";
import { finishIds, finishList, type FinishId, type MaterialId } from "@hedronite/lts-materials";
import { createFinishedMaterial } from "@hedronite/lts-materials/finished";
import { createMaterial } from "@hedronite/lts-materials/three";
import { createStudioLights } from "@hedronite/lts-primitives/three";
import { neutral } from "@hedronite/lts-tokens";

const SIZE = 256;
const FINISHES = [...finishIds] as FinishId[];
const SWING_LO = 0.08;

function firstPreset(id: FinishId): MaterialId {
  const meta = finishList.find((row) => row.id === id);
  const preset = meta?.presets[0];
  if (preset === undefined) throw new Error(`no declared preset for ${id}`);
  return preset;
}

function mad(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  let n = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 4) {
    sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    sum += Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0));
    sum += Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0));
    n += 3;
  }
  return n === 0 ? 0 : Number((sum / n).toFixed(3));
}

function meanRgb(buf: Uint8ClampedArray): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = buf.length / 4;
  for (let i = 0; i < buf.length; i += 4) {
    r += buf[i] ?? 0;
    g += buf[i + 1] ?? 0;
    b += buf[i + 2] ?? 0;
  }
  return { r: Number((r / pixels).toFixed(2)), g: Number((g / pixels).toFixed(2)), b: Number((b / pixels).toFixed(2)) };
}

function luminance(buf: Uint8ClampedArray): number {
  const m = meanRgb(buf);
  return Number((0.2126 * m.r + 0.7152 * m.g + 0.0722 * m.b).toFixed(2));
}

async function grab(canvas: HTMLCanvasElement): Promise<Uint8ClampedArray> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value === null) reject(new Error("toBlob failed"));
      else resolve(value);
    }, "image/png");
  });
  const bitmap = await createImageBitmap(blob);
  const off = new OffscreenCanvas(SIZE, SIZE);
  const ctx = off.getContext("2d");
  if (ctx === null) throw new Error("2d");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

export async function runR8(forceWebGL: boolean): Promise<Record<string, unknown>> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(new Color(0xf5f5f5), 1);
  await renderer.init();
  const backend = renderer.backend as { isWebGPUBackend?: boolean; isWebGLBackend?: boolean };
  const backendInfo = {
    forceWebGL,
    isWebGPUBackend: backend?.isWebGPUBackend === true,
    isWebGLBackend: backend?.isWebGLBackend === true,
  };

  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 20);
  camera.position.set(0, 0.35, 3.1);
  camera.lookAt(0, 0, 0);
  scene.add(createStudioLights({ palette: neutral.scene }));
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = env.texture;
  const geometry = new SphereGeometry(0.95, 64, 48);
  const mesh = new Mesh(geometry);
  scene.add(mesh);

  const draw = async (material: { uuid?: string }): Promise<Uint8ClampedArray> => {
    mesh.material = material as never;
    const asyncRenderer = renderer as WebGPURenderer & { renderAsync?: (s: Scene, c: PerspectiveCamera) => Promise<void> };
    if (typeof asyncRenderer.renderAsync === "function") await asyncRenderer.renderAsync(scene, camera);
    else renderer.render(scene, camera);
    return grab(canvas);
  };

  const failures: { name: string; value: unknown; min?: number; max?: number }[] = [];
  const check = (name: string, value: number, min: number, max?: number) => {
    const ok = max === undefined ? value >= min : value >= min && value <= max;
    if (!ok) failures.push(max === undefined ? { name, value, min } : { name, value, min, max });
  };

  const finishes: Record<string, Record<string, unknown>> = {};
  const defaultFrames: Record<string, Uint8ClampedArray> = {};
  for (const id of FINISHES) {
    const preset = firstPreset(id);
    const atDefault = createFinishedMaterial(preset, id, {}, neutral.scene);
    const atS0 = createFinishedMaterial(preset, id, { strength: 0 }, neutral.scene);
    const atLo = createFinishedMaterial(preset, id, { strength: SWING_LO }, neutral.scene);
    const atHi = createFinishedMaterial(preset, id, { strength: 1 }, neutral.scene);
    const classic = createMaterial(preset, neutral.scene);
    const bufPlain = await draw(atS0.material);
    const plainLum = luminance(bufPlain);
    const bufDefault = await draw(atDefault.material);
    const bufLo = await draw(atLo.material);
    const bufHi = await draw(atHi.material);
    const bufClassic = await draw(classic);
    defaultFrames[id] = bufDefault;
    const vsPlain = mad(bufPlain, bufDefault);
    const swing = mad(bufLo, bufHi);
    const npc = mad(bufPlain, bufClassic);
    const lumD = luminance(bufDefault);
    finishes[id] = {
      preset,
      vsPlainDefault: { meanAbsDiff: vsPlain },
      strengthSwing: { meanAbsDiff: swing },
      nodePlainVsClassic: { meanAbsDiff: npc },
      meanRgbDefault: meanRgb(bufDefault),
      meanRgbPlain: meanRgb(bufPlain),
      lumDefault: lumD,
      lumPlain: plainLum,
      plainIsNode: atS0.material instanceof MeshPhysicalNodeMaterial,
      plainIsClassicOnly: atS0.material instanceof MeshPhysicalMaterial && !(atS0.material instanceof MeshPhysicalNodeMaterial),
    };
    const floor = Math.max(10, 0.1 * plainLum);
    if (plainLum < 10) failures.push({ name: `${id}.plainEmpty`, value: plainLum, min: 10 });
    if (lumD < floor) failures.push({ name: `${id}.blackOrEmpty`, value: lumD, min: floor });
    check(`${id}.vsPlainDefault`, vsPlain, 3);
    check(`${id}.strengthSwing`, swing, 2);
    check(`${id}.nodePlainVsClassic`, npc, 0, 1.5);
    atDefault.dispose();
    atS0.dispose();
    atLo.dispose();
    atHi.dispose();
    classic.dispose();
  }

  const pairwise: { anchorPreset: string; a: string; b: string; meanAbsDiff: number }[] = [];
  const anchors = [...new Set(FINISHES.map(firstPreset))];
  for (const preset of anchors) {
    const shots: Record<string, Uint8ClampedArray> = {};
    const handles = FINISHES.map((id) => ({ id, handle: createFinishedMaterial(preset, id, {}, neutral.scene) }));
    for (const row of handles) shots[row.id] = await draw(row.handle.material);
    for (let i = 0; i < FINISHES.length; i += 1) {
      for (let j = i + 1; j < FINISHES.length; j += 1) {
        const a = FINISHES[i];
        const b = FINISHES[j];
        if (a === undefined || b === undefined) continue;
        const pa = shots[a];
        const pb = shots[b];
        if (pa === undefined || pb === undefined) continue;
        const value = mad(pa, pb);
        pairwise.push({ anchorPreset: preset, a, b, meanAbsDiff: value });
        check(`pairwise.${preset}.${a}.${b}`, value, 3);
      }
    }
    for (const row of handles) row.handle.dispose();
  }

  const grainH = createFinishedMaterial("satin", "grain", {}, neutral.scene);
  const weaveH = createFinishedMaterial("satin", "weave", {}, neutral.scene);
  const grainWeaveSatin = mad(await draw(grainH.material), await draw(weaveH.material));
  check("grain|weave.satin", grainWeaveSatin, 3);
  grainH.dispose();
  weaveH.dispose();

  if (backendInfo.forceWebGL && !backendInfo.isWebGLBackend) failures.push({ name: "backend.webgl2", value: backendInfo });
  if (!backendInfo.forceWebGL && !backendInfo.isWebGPUBackend) failures.push({ name: "backend.webgpu", value: backendInfo });

  const npcValues = FINISHES.map((id) => (finishes[id]?.nodePlainVsClassic as { meanAbsDiff: number }).meanAbsDiff);
  const harnessUnshaded = npcValues.some((v) => v > 1.5);
  let allIdentical = true;
  const ids = FINISHES;
  for (let i = 0; i < ids.length && allIdentical; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      if (a === undefined || b === undefined) continue;
      const pa = defaultFrames[a];
      const pb = defaultFrames[b];
      if (pa === undefined || pb === undefined) continue;
      if (mad(pa, pb) > 0.01) {
        allIdentical = false;
        break;
      }
    }
  }

  env.texture.dispose();
  env.dispose();
  pmrem.dispose();
  geometry.dispose();
  renderer.dispose();
  canvas.remove();

  return {
    backend: backendInfo,
    finishes,
    pairwiseDefaults: pairwise,
    grainWeaveSatin: { meanAbsDiff: grainWeaveSatin },
    harnessUnshaded,
    allFinishesIdentical: allIdentical,
    r8: { failures, pass: failures.length === 0 && !harnessUnshaded && !allIdentical },
  };
}

declare global {
  interface Window {
    __runR8?: typeof runR8;
  }
}

window.__runR8 = runR8;
const status = document.getElementById("status");
if (status !== null) status.textContent = "Harness ready (call window.__runR8).";