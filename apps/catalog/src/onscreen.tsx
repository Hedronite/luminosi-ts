import { useThree } from "@react-three/fiber";
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

const subscribeVisibility = (notify: () => void): (() => void) => {
  document.addEventListener("visibilitychange", notify);
  return () => {
    document.removeEventListener("visibilitychange", notify);
  };
};
const tabVisible = (): boolean => document.visibilityState !== "hidden";
const serverVisible = (): boolean => true;

/**
 * Whether a stage should be drawing at all: its element is in the viewport (any part of it) and the tab
 * is showing. A stage that is neither would burn the GPU on frames nobody sees. It starts as not shown
 * where the browser can tell (IntersectionObserver), so a stage below the fold never draws its first frame
 * either; where it cannot, the stage is shown.
 */
export function useStageShown(target: RefObject<Element | null>): boolean {
  const visible = useSyncExternalStore(subscribeVisibility, tabVisible, serverVisible);
  const [inView, setInView] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = target.current;
    if (element === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const latest = entries.at(-1);
      if (latest !== undefined) setInView(latest.isIntersecting);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [target]);
  return visible && inView;
}

/** R3F's frame loop for a stage: none while it is not shown, else `on` (on demand when `still`). */
/** `paused` stops every invalidate until resume; reduced motion alone stays on demand for keyboard draws. */
export const stageFrameloop = (shown: boolean, still: boolean, paused = false): "never" | "demand" | "always" =>
  !shown ? "never" : paused ? "never" : still ? "demand" : "always";

/** Inside the canvas: asks for a frame the moment the stage is shown again, so a size or a camera that changed while it was away is drawn. */
export function WakeOnShow({ shown }: { readonly shown: boolean }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (shown) invalidate();
  }, [shown, invalidate]);
  return null;
}
