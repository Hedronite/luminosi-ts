import type { Scene, Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * The studio room both environments bake, WebGL's (`StudioEnvironment`) and the WebGPU renderer's (`WebGPUStudioEnvironment`): moving a
 * viewport from one renderer to the other changes the renderer and not its lighting. The prefilter's sigma for the room is the one value
 * they share in code. The other two parts of the look are shared by leaving them alone: neither environment sets the scene's
 * `environmentIntensity` (three's default, 1) or the renderer's tone mapping (React Three Fiber's canvas sets ACES filmic, on either renderer).
 * A unit test mounts both and pins all three.
 */
export const STUDIO_BLUR = 0.04;

/** What bakes the room: three's `PMREMGenerator`, WebGL's or the WebGPU renderer's. */
export interface RoomGenerator {
  fromScene(scene: Scene, sigma: number): { readonly texture: Texture; dispose(): void };
  dispose(): void;
}

/** The studio room, prefiltered by `generator`, which is disposed with the room itself: the caller keeps the target and frees it. */
export function bakeStudioRoom(generator: RoomGenerator): { readonly texture: Texture; dispose(): void } {
  const room = new RoomEnvironment();
  const target = generator.fromScene(room, STUDIO_BLUR);
  room.dispose();
  generator.dispose();
  return target;
}
