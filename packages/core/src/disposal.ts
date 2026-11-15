/** Anything that frees itself: three.js geometries, materials, textures and render targets all qualify. */
export interface DisposableResource {
  dispose(): void;
}

/** Owns resources and frees them together, newest first. */
export interface DisposalScope extends DisposableResource {
  /** Takes ownership of `resource` and returns it. Throws if the scope is already disposed. */
  track<T extends DisposableResource>(resource: T): T;
  /** How many resources the scope currently owns. */
  readonly size: number;
  readonly disposed: boolean;
}

/** Thrown by `track` on a scope that has already been disposed. */
export class DisposedScopeError extends Error {
  override readonly name = "DisposedScopeError";

  constructor() {
    super("cannot track a resource on a disposed scope");
  }
}

export function createDisposalScope(): DisposalScope {
  let resources: DisposableResource[] = [];
  let disposed = false;

  return {
    track(resource) {
      if (disposed) {
        // Free it anyway, so a late resource cannot leak.
        resource.dispose();
        throw new DisposedScopeError();
      }
      resources.push(resource);
      return resource;
    },
    get size() {
      return resources.length;
    },
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      const owned = resources;
      resources = [];
      const errors: unknown[] = [];
      for (const resource of owned.reverse()) {
        try {
          resource.dispose();
        } catch (error: unknown) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, `${String(errors.length)} resource(s) failed to dispose`);
      }
    },
  };
}
