import { describe, expect, it } from "vitest";
import { createDisposalScope, DisposedScopeError } from "./disposal.js";

function resource(log: string[], name: string, fail = false) {
  return {
    dispose: () => {
      log.push(name);
      if (fail) throw new Error(`${name} failed`);
    },
  };
}

describe("createDisposalScope", () => {
  it("returns the tracked resource and counts it", () => {
    const scope = createDisposalScope();
    const r = resource([], "a");
    expect(scope.track(r)).toBe(r);
    expect(scope.size).toBe(1);
  });

  it("disposes newest first, then owns nothing", () => {
    const log: string[] = [];
    const scope = createDisposalScope();
    scope.track(resource(log, "geometry"));
    scope.track(resource(log, "material"));
    scope.track(resource(log, "mesh"));
    scope.dispose();
    expect(log).toEqual(["mesh", "material", "geometry"]);
    expect(scope.size).toBe(0);
    expect(scope.disposed).toBe(true);
  });

  it("is idempotent", () => {
    const log: string[] = [];
    const scope = createDisposalScope();
    scope.track(resource(log, "a"));
    scope.dispose();
    scope.dispose();
    expect(log).toEqual(["a"]);
  });

  it("disposes everything even when some fail, then reports every failure", () => {
    const log: string[] = [];
    const scope = createDisposalScope();
    scope.track(resource(log, "a", true));
    scope.track(resource(log, "b"));
    scope.track(resource(log, "c", true));
    expect(() => {
      scope.dispose();
    }).toThrow(AggregateError);
    expect(log).toEqual(["c", "b", "a"]);
  });

  it("frees a resource tracked after disposal and throws", () => {
    const log: string[] = [];
    const scope = createDisposalScope();
    scope.dispose();
    expect(() => scope.track(resource(log, "late"))).toThrow(DisposedScopeError);
    expect(log).toEqual(["late"]);
  });
});
