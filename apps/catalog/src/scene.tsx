import { useReducedMotion } from "@hedronite/lts-adapters";
import { useFrame, useStore, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { MathUtils, Spherical, Vector3, type Object3D } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** The studio environment comes from the adapters, so the catalog uses what consumers use. */
export { StudioEnvironment as Environment } from "@hedronite/lts-adapters";

/** What a stage tells a viewer who cannot drag: the keys, then the pointer. Read as the stage's description. */
const keyHelp = "Arrow keys orbit, + and - zoom, 0 resets the view. Drag to rotate, scroll to zoom.";

/** How far one key press turns or zooms the camera. */
const STEP = MathUtils.degToRad(15);
const ZOOM = 0.85;
/** Keeps the camera off the poles, where azimuth stops meaning anything. */
const POLE = 0.05;

/**
 * Orbit controls for the pointer, and the same moves for the keyboard once `keys` has focus: arrows
 * orbit, `+` and `-` zoom, `0` goes back to where the camera started.
 */
export function Controls({ keys }: { readonly keys: RefObject<HTMLElement | null> }) {
  const { camera, gl, invalidate } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enablePan = false;
    controls.minDistance = 1.8;
    controls.maxDistance = 7;
    controls.saveState();
    const onChange = (): void => {
      invalidate();
    };
    controls.addEventListener("change", onChange);

    const offset = new Vector3();
    const spherical = new Spherical();
    // OrbitControls reads the camera's position on every update, so moving the camera and updating is a turn.
    const move = (turn: number, tilt: number, zoom: number): void => {
      offset.copy(camera.position).sub(controls.target);
      spherical.setFromVector3(offset);
      spherical.theta += turn;
      spherical.phi = MathUtils.clamp(spherical.phi + tilt, POLE, Math.PI - POLE);
      spherical.radius = MathUtils.clamp(spherical.radius * zoom, controls.minDistance, controls.maxDistance);
      camera.position.copy(offset.setFromSpherical(spherical).add(controls.target));
      controls.update();
      invalidate();
    };
    const onKey = (event: KeyboardEvent): void => {
      // Leave the browser's own shortcuts (zoom, find, tab switching) alone.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      switch (event.key) {
        case "ArrowLeft":
          move(-STEP, 0, 1);
          break;
        case "ArrowRight":
          move(STEP, 0, 1);
          break;
        case "ArrowUp":
          move(0, -STEP, 1);
          break;
        case "ArrowDown":
          move(0, STEP, 1);
          break;
        case "+":
        case "=":
          move(0, 0, ZOOM);
          break;
        case "-":
        case "_":
          move(0, 0, 1 / ZOOM);
          break;
        case "0":
          controls.reset();
          invalidate();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    const element = keys.current;
    element?.addEventListener("keydown", onKey);
    return () => {
      element?.removeEventListener("keydown", onKey);
      controls.removeEventListener("change", onChange);
      controls.dispose();
    };
  }, [camera, gl, invalidate, keys]);
  return null;
}

/** The longest stretch of time one frame may add, so a stage that was paused or hidden never jumps on its next frame. */
const MAX_STEP = 0.1;

/**
 * The stage's own animation clock, in seconds. It adds each frame's delta only while `running`, so it
 * holds still across a pause and across the frames the keys and the pointer ask for on a paused
 * stage, and resumes from the value it held. `writeShaderTime`, which sets a stage's time uniform for its surface shaders, is
 * called with it. (R3F's `clock` cannot do this: it restarts at zero
 * when the frame loop changes, and jumps by the whole pause on the next frame.)
 */
export function StageClock({ clockRef, running, writeShaderTime }: { readonly clockRef: RefObject<number>; readonly running: boolean; readonly writeShaderTime?: (seconds: number) => void }) {
  const store = useStore();
  const was = useRef(running);
  useEffect(() => {
    // Pausing leaves one frame owed: the loop is already armed for its next tick, and the switch to on-demand
    // rendering asks for a frame of its own. Where the browser is slow to run animation frames (software WebGL on
    // a busy runner), that tick lands seconds after the pause, and a paused stage then draws on its own. The
    // picture on screen is already the stage as it stands, so the frame is not owed: drop it. Camera moves and
    // pointer moves ask again after this, through `invalidate`.
    if (was.current && !running) store.getState().internal.frames = 0;
    was.current = running;
  }, [running, store]);
  useFrame((_, delta) => {
    if (running) clockRef.current += Math.min(delta, MAX_STEP);
    // The surface shaders read time from this uniform, so they stop where the stage stops, whatever the frame is drawn for.
    writeShaderTime?.(clockRef.current);
  });
  return null;
}

/** How many shader programs the renderer holds: a parameter that moves live adds none. */
const programsOf = (gl: object): number => {
  const info: unknown = "info" in gl ? gl.info : undefined;
  if (typeof info !== "object" || info === null) return 0;
  // The WebGL renderer lists its programs; the WebGPU renderer counts them in its memory report.
  if ("programs" in info && Array.isArray(info.programs)) return info.programs.length;
  const memory: unknown = "memory" in info ? info.memory : undefined;
  return typeof memory === "object" && memory !== null && "programs" in memory && typeof memory.programs === "number" ? memory.programs : 0;
};

/**
 * Adds to `seen` the `uuid` of every drawable object under `root` (anything that carries a material: meshes, lines, points)
 * and of every material those objects hold. It reads the scene graph and nothing else: no name, no type of material.
 */
const noteBuilds = (root: Object3D, seen: Set<string>): void => {
  root.traverse((object) => {
    if (!("material" in object)) return;
    seen.add(object.uuid);
    const held: unknown = object.material;
    const materials: readonly unknown[] = Array.isArray(held) ? held : [held];
    for (const material of materials) if (typeof material === "object" && material !== null && "uuid" in material && typeof material.uuid === "string") seen.add(material.uuid);
  });
};

/**
 * Which backend drew the canvas: `webgpu` when three's renderer is running on the browser's WebGPU,
 * `webgl` for the WebGL renderer and for the WebGPU renderer's WebGL 2 fallback.
 */
const backendOf = (gl: object): "webgpu" | "webgl" => {
  const backend: unknown = "backend" in gl ? gl.backend : undefined;
  return typeof backend === "object" && backend !== null && "isWebGPUBackend" in backend && backend.isWebGPUBackend === true ? "webgpu" : "webgl";
};

/**
 * Writes the scene's rendered frame count, the backend that drew it, live GPU resource counts and
 * camera (azimuth and polar in degrees, distance from the origin), the number of shader programs, the builds (how many distinct meshes
 * and materials the stage has ever attached, by `uuid`, never counting one twice and never going down: a remount raises it, a
 * recolor or a uniform edit leaves it), and the stage's animation
 * clock when it has one (and the time its surface shaders read, when it gave them one), onto `target`, for tests.
 */
export function GpuCounts({ target, clockRef, shaderClock }: { readonly target: RefObject<HTMLDivElement | null>; readonly clockRef?: RefObject<number>; readonly shaderClock?: { readonly value: number } }) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  // useFrame runs once per scene render, so environment baking does not count.
  const frames = useRef(0);
  const [builds] = useState(() => new Set<string>());
  useFrame(() => {
    frames.current += 1;
    // A frame follows every commit that attaches something, so an object that lives for one commit is still seen.
    noteBuilds(scene, builds);
  });
  useEffect(() => {
    const timer = setInterval(() => {
      const element = target.current;
      if (element === null) return;
      noteBuilds(scene, builds);
      const { x, y, z } = camera.position;
      const distance = Math.hypot(x, y, z);
      element.dataset["frames"] = String(frames.current);
      element.dataset["backend"] = backendOf(gl);
      element.dataset["gpuGeometries"] = String(gl.info.memory.geometries);
      element.dataset["gpuTextures"] = String(gl.info.memory.textures);
      element.dataset["programs"] = String(programsOf(gl));
      element.dataset["builds"] = String(builds.size);
      element.dataset["azimuth"] = MathUtils.radToDeg(Math.atan2(x, z)).toFixed(1);
      element.dataset["polar"] = MathUtils.radToDeg(Math.acos(MathUtils.clamp(y / distance, -1, 1))).toFixed(1);
      element.dataset["distance"] = distance.toFixed(2);
      if (clockRef !== undefined) element.dataset["time"] = clockRef.current.toFixed(2);
      if (shaderClock !== undefined) element.dataset["shaderTime"] = shaderClock.value.toFixed(2);
    }, 150);
    return () => {
      clearInterval(timer);
    };
  }, [gl, camera, scene, builds, target, clockRef, shaderClock]);
  return null;
}

export interface Motion {
  /** True when the viewer asked for reduced motion, or paused a stage that animates: hold the frame. */
  readonly still: boolean;
  /** Whether to offer a pause button: the stage animates and the viewer has not asked for less motion. */
  readonly canPause: boolean;
  readonly paused: boolean;
  readonly toggle: () => void;
}

/**
 * Motion state for one stage. `animated` says whether time moves on it at all. A still stage renders
 * on demand, so the frame counter holds until the viewer resumes, moves the camera or points at it.
 */
export function useMotion(animated: boolean): Motion {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const toggle = useCallback(() => {
    setPaused((current) => !current);
  }, []);
  return { still: reduced || (animated && paused), canPause: animated && !reduced, paused, toggle };
}

/**
 * The frame around a 3D stage: a focusable, labelled group (not a picture) whose description names
 * the keys, with a pause button on a stage that animates. `group` is the group; `className` styles it.
 */
export function StageFrame({ group, motion, label, className, testId, children }: { readonly group: RefObject<HTMLDivElement | null>; readonly motion: Motion; readonly label: string; readonly className: string; readonly testId?: string | undefined; readonly children: ReactNode }) {
  const help = useId();
  return (
    <div className="relative">
      <div
        ref={group}
        role="group"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the stage is one keyboard widget: focus is how its arrow, + - and 0 keys are reached
        tabIndex={0}
        aria-label={label}
        aria-describedby={help}
        className={`${className} focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent`}
        {...(testId === undefined ? {} : { "data-testid": testId })}
      >
        {children}
      </div>
      <p id={help} className="sr-only">
        {keyHelp}
      </p>
      {motion.canPause ? (
        <button
          type="button"
          onClick={motion.toggle}
          className="absolute right-2 top-2 min-h-8 rounded-lg border border-line bg-surface px-3 text-sm text-fg hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {motion.paused ? "Resume motion" : "Pause motion"}
        </button>
      ) : null}
    </div>
  );
}
