import type { AssetKind, AssetMeta } from "@hedronite/lts-core";
import { EffectClockProvider, StudioLights, useEffectMaterial } from "@hedronite/lts-adapters";
import { ScreenEffectsPass, WebGPUCanvas, WebGPUStudioEnvironment } from "@hedronite/lts-adapters/webgpu";
import { createRandom } from "@hedronite/lts-core";
import { disposeObject, createStudioLights } from "@hedronite/lts-primitives/three";
import { isScreenEffectId, screenEffectInfo, type ScreenEffectId } from "@hedronite/lts-postfx";
import { effectInfo, isEffectId } from "@hedronite/lts-shaders";
import { loadDescriptors } from "@hedronite/lts-registry";
import { neutral } from "@hedronite/lts-tokens";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Object3D } from "three";
import { BoxGeometry, MeshBasicMaterial, SphereGeometry, WebGPURenderer } from "three/webgpu";
import { registry } from "./registry";
import { buildStage, type StageSubject, type StageSurface } from "./stage";
import { useShaderClock } from "./shaderClock";
import { useStageEffects } from "./stageEffects";
import { buildSubject } from "./subjects";

/**
 * The still-frame rig: one 3D asset, drawn the same way every time, for `bun run stills` to capture. It answers to
 * `still.html?still=<asset id>` and nothing else on the page: a fixed square canvas, device pixel ratio 1, a fixed camera per kind,
 * the stage clock held at a fixed time, the asset's default parameters, the neutral look and no pointer but the one the
 * rig itself places. Frames are stepped by hand (`frameloop="never"`), a fixed number of them, each a fixed step of time,
 * so no wall-clock time reaches the picture. `data-still="ready"` goes on the stage when the asset has loaded and the
 * last frame is drawn.
 */

/** Bump when the rig's picture changes for a reason other than an asset (size, cameras, lights, the look, the time): a poster's input hash carries it. */
const RIG_VERSION = 1;
/** The canvas, in CSS pixels. Device pixel ratio is 1, so a capture is this many pixels square. */
export const SIZE = 512;
/** The frames stepped before the stage is ready, and the time each one adds: the stage clock ends at FRAMES * STEP seconds (2 s). */
export const FRAMES = 60;
export const STEP = 1 / 30;
/** The seed every generator that draws without being given one is lent. The library's generators take their own seeds from their parameters. */
export const SEED = 1;

const look = neutral;

type StillKind = Exclude<AssetKind, "icon">;

interface Rig {
  readonly position: readonly [number, number, number];
  readonly fov: number;
  /** How the asset is turned to the camera, as the catalog's own views turn it. */
  readonly turn: readonly [number, number, number];
}

/** The camera of each kind, as its detail view frames it. */
const rigs: Readonly<Record<StillKind, Rig>> = {
  primitive: { position: [0, 0, 3.4], fov: 35, turn: [0.35, 0.6, 0] },
  material: { position: [0, 0, 3.4], fov: 35, turn: [0.35, 0.6, 0] },
  object: { position: [0, 0, 3.4], fov: 35, turn: [0.35, 0.6, 0] },
  scene: { position: [0, 0, 3.4], fov: 35, turn: [0.25, 0, 0] },
  shader: { position: [0, 0, 3.4], fov: 35, turn: [0, 0, 0] },
  effect: { position: [0, 0, 3.6], fov: 35, turn: [0.3, 0.6, 0] },
};

const isStillKind = (kind: AssetKind): kind is StillKind => kind !== "icon";

interface Outcome {
  readonly status: "ready" | "error";
  readonly frames: number;
  readonly error?: string;
}

const nextAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/**
 * Inside a canvas: once the asset is ready and the canvas has its size, steps the frames by hand and reports the count.
 * On the WebGPU renderer it compiles the scene first, and between frames it lets the browser run one, so the last frame
 * is the one on screen.
 */
function Stepper({ ready, setClock, pointer, done }: { readonly ready: boolean; readonly setClock?: (seconds: number) => void; readonly pointer: boolean; readonly done: (outcome: Outcome) => void }) {
  const advance = useThree((state) => state.advance);
  const gl: unknown = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const sized = useThree((state) => state.size.width === SIZE && state.size.height === SIZE);
  useEffect(() => {
    if (!ready || !sized) return;
    const run = new AbortController();
    void (async () => {
      try {
        if (gl instanceof WebGPURenderer) {
          await gl.compileAsync(scene, camera);
          // The lens screen effect follows the pointer: hold it at the middle of the stage.
          if (pointer) {
            const rect = gl.domElement.getBoundingClientRect();
            gl.domElement.dispatchEvent(new PointerEvent("pointermove", { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, pointerType: "mouse" }));
          }
        }
        for (let frame = 1; frame <= FRAMES && !run.signal.aborted; frame += 1) {
          const seconds = frame * STEP;
          setClock?.(seconds);
          advance(seconds);
          // eslint-disable-next-line no-await-in-loop -- the frames are stepped in order, each given a browser frame to reach the screen
          await nextAnimationFrame();
        }
        if (!run.signal.aborted) done({ status: "ready", frames: FRAMES });
      } catch (error: unknown) {
        if (!run.signal.aborted) done({ status: "error", frames: 0, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      run.abort();
    };
  }, [ready, sized, gl, scene, camera, advance, setClock, pointer, done]);
  return null;
}

/** A primitive, material, object or scene kit: the asset's own build, as the catalog's viewport draws it. */
function Subject({ meta, turn, onBuilt }: { readonly meta: AssetMeta; readonly turn: Rig["turn"]; readonly onBuilt: (built: boolean) => void }) {
  const [object, setObject] = useState<Object3D | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    let built: Object3D | undefined;
    buildSubject(meta, look.scene, controller.signal).then(
      (result) => {
        if (result === undefined) return;
        if (controller.signal.aborted) {
          disposeObject(result);
          return;
        }
        built = result;
        setObject(result);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) console.error(`could not build ${meta.id}`, error);
      },
    );
    return () => {
      controller.abort();
      if (built !== undefined) disposeObject(built);
    };
  }, [meta]);
  useEffect(() => {
    onBuilt(object !== undefined);
  }, [object, onBuilt]);
  return object === undefined ? null : <primitive object={object} rotation={turn} />;
}

function Lights() {
  const rig = useMemo(() => createStudioLights(), []);
  return <primitive object={rig} />;
}

function Meshes({ meta, rig, finish }: { readonly meta: AssetMeta; readonly rig: Rig; readonly finish: (outcome: Outcome) => void }) {
  const [built, setBuilt] = useState(false);
  return (
    <WebGPUCanvas frameloop="never" dpr={1} camera={{ position: [...rig.position], fov: rig.fov }}>
      <WebGPUStudioEnvironment />
      {meta.kind === "scene" ? null : <Lights />}
      <Subject meta={meta} turn={rig.turn} onBuilt={setBuilt} />
      <Stepper ready={built} pointer={false} done={finish} />
    </WebGPUCanvas>
  );
}

/** Stripes behind a see-through shader, as the shader's detail view puts them. */
function Backdrop() {
  const resources = useMemo(() => {
    const light = new MeshBasicMaterial();
    const dark = new MeshBasicMaterial();
    light.color.set(look.scene.accent);
    dark.color.set(look.scene.base);
    return { geometry: new BoxGeometry(0.22, 4, 0.02), light, dark };
  }, []);
  useEffect(
    () => () => {
      resources.geometry.dispose();
      resources.light.dispose();
      resources.dark.dispose();
    },
    [resources],
  );
  return (
    <group position={[0, 0, -1.4]} rotation={[0, 0, 0.35]}>
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={i} geometry={resources.geometry} material={i % 2 === 0 ? resources.light : resources.dark} position={[(i - 5) * 0.44, 0, 0]} dispose={null} />
      ))}
    </group>
  );
}

/** A surface shader on a smooth sphere, at the default parameters. It reads its time from the clock the provider above it holds, which the stepper writes. */
function ShaderSphere({ id, onBuilt }: { readonly id: string; readonly onBuilt: (built: boolean) => void }) {
  const geometry = useMemo(() => new SphereGeometry(0.95, 64, 32), []);
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  const material = useEffectMaterial(isEffectId(id) ? id : undefined, look.scene, undefined);
  useEffect(() => {
    onBuilt(material !== undefined);
  }, [material, onBuilt]);
  return material === undefined ? null : <mesh geometry={geometry} material={material} dispose={null} />;
}

function Shader({ meta, rig, finish }: { readonly meta: AssetMeta; readonly rig: Rig; readonly finish: (outcome: Outcome) => void }) {
  const { clock, write } = useShaderClock();
  const [built, setBuilt] = useState(false);
  return (
    <WebGPUCanvas frameloop="never" dpr={1} camera={{ position: [...rig.position], fov: rig.fov }}>
      <StudioLights />
      {isEffectId(meta.id) && effectInfo[meta.id].seeThrough === true ? <Backdrop /> : null}
      <EffectClockProvider clock={clock}>
        <ShaderSphere id={meta.id} onBuilt={setBuilt} />
      </EffectClockProvider>
      <Stepper ready={built} setClock={write} pointer={false} done={finish} />
    </WebGPUCanvas>
  );
}

const framedDodecahedron: StageSubject = { kind: "solid", id: "platonic-dodecahedron" };
const framed: StageSurface = { kind: "framed" };

/** The effects stage's subject, still: a framed solid, built from the descriptors, turned and scaled as the stage turns it. */
function StageSolid({ turn, onBuilt }: { readonly turn: Rig["turn"]; readonly onBuilt: (built: boolean) => void }) {
  const [object, setObject] = useState<Object3D | undefined>(undefined);
  useEffect(() => {
    let current = true;
    let built: Object3D | undefined;
    buildStage(framedDodecahedron, framed, look.scene).then(
      (result) => {
        if (!current) {
          disposeObject(result);
          return;
        }
        built = result;
        setObject(result);
      },
      (error: unknown) => {
        if (current) console.error("could not build the stage", error);
      },
    );
    return () => {
      current = false;
      if (built !== undefined) disposeObject(built);
    };
  }, []);
  useEffect(() => {
    onBuilt(object !== undefined);
  }, [object, onBuilt]);
  return (
    <group rotation={turn}>
      {object === undefined ? null : <primitive object={object} scale={1.15} dispose={null} />}
    </group>
  );
}

/** A screen effect over the framed solid, with the parameters its descriptor gives a stage; it runs from time zero, so the stage's clock is the frames stepped. */
function Effect({ meta, rig, finish }: { readonly meta: AssetMeta; readonly rig: Rig; readonly finish: (outcome: Outcome) => void }) {
  const id = meta.id;
  const ids = useMemo((): readonly ScreenEffectId[] => (isScreenEffectId(id) ? [id] : []), [id]);
  const effects = useStageEffects(ids);
  // The stage's effects take the descriptor's stage parameters once the descriptors load; wait for them, so the frames are stepped on the final stack.
  const [described, setDescribed] = useState(false);
  useEffect(() => {
    let current = true;
    loadDescriptors().then(
      () => {
        if (current) setDescribed(true);
      },
      () => {
        if (current) finish({ status: "error", frames: 0, error: "the descriptors did not load" });
      },
    );
    return () => {
      current = false;
    };
  }, [finish]);
  const [built, setBuilt] = useState(false);
  return (
    <WebGPUCanvas frameloop="never" dpr={1} camera={{ position: [...rig.position], fov: rig.fov }}>
      <WebGPUStudioEnvironment />
      <StudioLights />
      <StageSolid turn={rig.turn} onBuilt={setBuilt} />
      {effects.length === 0 ? null : <ScreenEffectsPass effects={effects} palette={look.scene} reducedMotion={false} />}
      <Stepper ready={built && described && effects.length > 0} pointer={isScreenEffectId(id) && screenEffectInfo[id].interactive === true} done={finish} />
    </WebGPUCanvas>
  );
}

function Stage({ meta, rig, finish }: { readonly meta: AssetMeta; readonly rig: Rig; readonly finish: (outcome: Outcome) => void }) {
  if (meta.kind === "shader") return <Shader meta={meta} rig={rig} finish={finish} />;
  if (meta.kind === "effect") return <Effect meta={meta} rig={rig} finish={finish} />;
  return <Meshes meta={meta} rig={rig} finish={finish} />;
}

/** The page's one stage. */
function Still({ id }: { readonly id: string }) {
  const meta = registry.get(id);
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  const kind = meta?.kind;
  const rig = kind !== undefined && isStillKind(kind) ? rigs[kind] : undefined;
  const known = rig === undefined ? undefined : meta;
  const status = outcome?.status ?? (known === undefined ? "error" : "loading");
  const error = outcome?.error ?? (known === undefined ? `${id} is not a 3D asset in the registry` : undefined);
  return (
    <div
      data-testid="still"
      data-asset={id}
      data-kind={meta?.kind}
      data-rig={String(RIG_VERSION)}
      data-still={status}
      data-frames={String(outcome?.frames ?? 0)}
      data-time={outcome?.status === "ready" ? (FRAMES * STEP).toFixed(2) : "0.00"}
      data-error={error}
      style={{ position: "fixed", left: 0, top: 0, width: SIZE, height: SIZE, overflow: "hidden", background: look.light.surfaceRaised }}
    >
      {known === undefined || rig === undefined ? null : <Stage key={known.id} meta={known} rig={rig} finish={setOutcome} />}
    </div>
  );
}

/** Mounts the rig for one asset in place of the catalog. Generators that draw numbers without a seed of their own are lent a seeded sequence first. */
export function mountStill(root: HTMLElement, id: string): void {
  const random = createRandom(SEED);
  Math.random = () => random.next();
  createRoot(root).render(<Still id={id} />);
}
