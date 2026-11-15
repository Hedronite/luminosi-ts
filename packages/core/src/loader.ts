import type { AssetMeta } from "./asset.js";
import type { Registry } from "./registry.js";

/** Thrown when a loader is asked for an id the registry does not know. */
export class UnknownAssetError extends Error {
  override readonly name = "UnknownAssetError";
  readonly id: string;

  constructor(id: string) {
    super(`asset "${id}" is not registered`);
    this.id = id;
  }
}

/** Fetches or builds the value for one asset. `signal` aborts when the load is evicted. */
export type Resolve<T> = (meta: AssetMeta, signal: AbortSignal) => Promise<T>;

export interface LoadOptions {
  /** Stops waiting for this caller only; the shared load continues for others. */
  readonly signal?: AbortSignal;
}

export interface Loader<T> {
  /** Loads `id` once: concurrent and later calls share one result. Failures are not cached. */
  load(id: string, options?: LoadOptions): Promise<T>;
  /** The value for `id` if a load has already finished. */
  peek(id: string): T | undefined;
  /** Forgets `id`, aborting a load still in flight, so the next `load` starts again. */
  evict(id: string): void;
}

interface InFlight<T> {
  readonly promise: Promise<T>;
  readonly controller: AbortController;
}

export function createLoader<T>(registry: Registry, resolve: Resolve<T>): Loader<T> {
  // Boxed, so a resolved value of undefined still counts as loaded.
  const values = new Map<string, { readonly value: T }>();
  const inFlight = new Map<string, InFlight<T>>();

  const start = (meta: AssetMeta): Promise<T> => {
    const controller = new AbortController();
    const promise = resolve(meta, controller.signal).then(
      (value) => {
        if (inFlight.get(meta.id)?.controller === controller) {
          inFlight.delete(meta.id);
          values.set(meta.id, { value });
        }
        return value;
      },
      (error: unknown) => {
        if (inFlight.get(meta.id)?.controller === controller) {
          inFlight.delete(meta.id);
        }
        throw error;
      },
    );
    inFlight.set(meta.id, { promise, controller });
    return promise;
  };

  return {
    load(id, options = {}) {
      const hit = values.get(id);
      if (hit !== undefined) {
        return Promise.resolve(hit.value);
      }
      const meta = registry.get(id);
      if (meta === undefined) {
        return Promise.reject(new UnknownAssetError(id));
      }
      const shared = inFlight.get(id)?.promise ?? start(meta);
      return waitFor(shared, options.signal);
    },
    peek: (id) => values.get(id)?.value,
    evict(id) {
      values.delete(id);
      inFlight.get(id)?.controller.abort(new Error(`asset "${id}" was evicted while loading`));
      inFlight.delete(id);
    },
  };
}

function waitFor<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(toError(signal.reason));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(toError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(toError(error));
      },
    );
  });
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("aborted", { cause: reason });
}
