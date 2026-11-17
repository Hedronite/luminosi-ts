import ReactThreeTestRenderer from "@react-three/test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducedMotion } from "./motion.js";

type Listener = () => void;

/** A stand-in for the media query list a browser keeps, which the test flips by hand. */
function fakeMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const state = { matches: initial };
  const queries: string[] = [];
  const matchMedia = (query: string) => {
    queries.push(query);
    return {
      get matches() {
        return state.matches;
      },
      addEventListener: (_type: string, listener: Listener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: Listener) => {
        listeners.delete(listener);
      },
    };
  };
  vi.stubGlobal("window", { matchMedia });
  return {
    queries,
    listeners,
    set(next: boolean) {
      state.matches = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function Probe({ seen }: { readonly seen: boolean[] }) {
  seen.push(useReducedMotion());
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useReducedMotion", () => {
  it("asks for the reduced-motion preference and reports it", async () => {
    const media = fakeMedia(true);
    const seen: boolean[] = [];
    const renderer = await ReactThreeTestRenderer.create(<Probe seen={seen} />);
    expect(seen.at(-1)).toBe(true);
    expect(media.queries.length).toBeGreaterThan(0);
    expect(media.queries.every((query) => query === "(prefers-reduced-motion: reduce)")).toBe(true);
    await renderer.unmount();
  });

  it("is false when the viewer has not asked", async () => {
    fakeMedia(false);
    const seen: boolean[] = [];
    const renderer = await ReactThreeTestRenderer.create(<Probe seen={seen} />);
    expect(seen.at(-1)).toBe(false);
    await renderer.unmount();
  });

  it("follows the setting while mounted", async () => {
    const media = fakeMedia(false);
    const seen: boolean[] = [];
    const renderer = await ReactThreeTestRenderer.create(<Probe seen={seen} />);
    await ReactThreeTestRenderer.act(() => {
      media.set(true);
      return Promise.resolve();
    });
    expect(seen.at(-1)).toBe(true);
    await ReactThreeTestRenderer.act(() => {
      media.set(false);
      return Promise.resolve();
    });
    expect(seen.at(-1)).toBe(false);
    await renderer.unmount();
  });

  it("stops listening when it unmounts", async () => {
    const media = fakeMedia(false);
    const renderer = await ReactThreeTestRenderer.create(<Probe seen={[]} />);
    expect(media.listeners.size).toBe(1);
    await renderer.unmount();
    expect(media.listeners.size).toBe(0);
  });
});
