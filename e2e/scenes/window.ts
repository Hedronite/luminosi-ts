/** The counts of what the renderer holds, from `renderer.info.memory`, as the rig's scene page reports them. */
export type Memory = Readonly<Record<string, number>>;

declare global {
  interface Window {
    /** The rig's scene page (apps/catalog/src/sceneStill.ts): the renderer's counts when it drew an empty scene, now, after freeing the scene, and after one more build and free. */
    stillScene?: {
      readonly baseline: Memory;
      readonly memory: () => Memory;
      readonly dispose: () => Promise<Memory>;
      readonly cycle: () => Promise<Memory>;
    };
  }
}
