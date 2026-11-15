import { describe, expect, it, vi } from "vitest";
import { createLoader, UnknownAssetError } from "./loader.js";
import { createRegistry, type Registry } from "./registry.js";

function registryWith(...ids: string[]): Registry {
  const registry = createRegistry();
  for (const id of ids) registry.register({ id, kind: "object", name: id, version: "0.1.0" });
  return registry;
}

/** A resolver whose loads finish only when the test says so. */
function deferredResolver() {
  const pending = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void; signal: AbortSignal }>();
  const resolve = vi.fn((meta: { id: string }, signal: AbortSignal) =>
    new Promise<string>((res, rej) => {
      pending.set(meta.id, { resolve: res, reject: rej, signal });
    }),
  );
  return { resolve, pending };
}

describe("createLoader", () => {
  it("resolves once for concurrent loads of the same id", async () => {
    const { resolve, pending } = deferredResolver();
    const loader = createLoader(registryWith("rock"), resolve);
    const a = loader.load("rock");
    const b = loader.load("rock");
    pending.get("rock")?.resolve("rock-data");
    await expect(Promise.all([a, b])).resolves.toEqual(["rock-data", "rock-data"]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("serves later loads from the cache and exposes the value through peek", async () => {
    const resolve = vi.fn(() => Promise.resolve("value"));
    const loader = createLoader(registryWith("rock"), resolve);
    expect(loader.peek("rock")).toBeUndefined();
    await loader.load("rock");
    await loader.load("rock");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(loader.peek("rock")).toBe("value");
  });

  it("caches a resolved value of undefined", async () => {
    const resolve = vi.fn(() => Promise.resolve(undefined));
    const loader = createLoader(registryWith("rock"), resolve);
    await loader.load("rock");
    await loader.load("rock");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("rejects an id the registry does not know, without resolving", async () => {
    const resolve = vi.fn(() => Promise.resolve("value"));
    await expect(createLoader(registryWith(), resolve).load("missing")).rejects.toThrow(UnknownAssetError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("does not cache failures", async () => {
    const resolve = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce("value");
    const loader = createLoader(registryWith("rock"), resolve);
    await expect(loader.load("rock")).rejects.toThrow("network");
    await expect(loader.load("rock")).resolves.toBe("value");
  });

  it("stops one caller waiting on abort, while others still get the value", async () => {
    const { resolve, pending } = deferredResolver();
    const loader = createLoader(registryWith("rock"), resolve);
    const controller = new AbortController();
    const aborted = loader.load("rock", { signal: controller.signal });
    const kept = loader.load("rock");
    controller.abort(new Error("user left"));
    await expect(aborted).rejects.toThrow("user left");
    expect(pending.get("rock")?.signal.aborted).toBe(false);
    pending.get("rock")?.resolve("rock-data");
    await expect(kept).resolves.toBe("rock-data");
  });

  it("rejects at once when the signal is already aborted", async () => {
    const loader = createLoader(registryWith("rock"), () => Promise.resolve("value"));
    await expect(loader.load("rock", { signal: AbortSignal.abort(new Error("gone")) })).rejects.toThrow("gone");
  });

  it("evict aborts a load in flight and the next load starts again", async () => {
    const { resolve, pending } = deferredResolver();
    const loader = createLoader(registryWith("rock"), resolve);
    const first = loader.load("rock");
    const firstSignal = pending.get("rock")?.signal;
    loader.evict("rock");
    expect(firstSignal?.aborted).toBe(true);
    pending.get("rock")?.resolve("stale");
    await expect(first).resolves.toBe("stale");
    expect(loader.peek("rock")).toBeUndefined();

    const second = loader.load("rock");
    pending.get("rock")?.resolve("fresh");
    await expect(second).resolves.toBe("fresh");
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("evict forgets a cached value", async () => {
    const resolve = vi.fn().mockResolvedValueOnce("one").mockResolvedValueOnce("two");
    const loader = createLoader(registryWith("rock"), resolve);
    await loader.load("rock");
    loader.evict("rock");
    await expect(loader.load("rock")).resolves.toBe("two");
  });
});
