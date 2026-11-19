/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry, type BufferGeometry, type Material } from "three";
import { describe, expect, it } from "vitest";
import { buildsOf, noteBuilds } from "./builds";

const count = (root: Group): number => {
  const seen = new Set<string>();
  noteBuilds(root, seen);
  return seen.size;
};

describe("noteBuilds", () => {
  it("counts a mesh, its geometry and its material once each, however often it looks", () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const seen = new Set<string>();
    noteBuilds(root, seen);
    noteBuilds(root, seen);
    expect(seen.size).toBe(3);
  });

  it("is raised by a new mesh, by a swapped material and by a swapped geometry, and never lowered", () => {
    const root = new Group();
    const mesh = new Mesh<BufferGeometry, Material>(new BoxGeometry(), new MeshBasicMaterial());
    root.add(mesh);
    const seen = new Set<string>();
    noteBuilds(root, seen);
    expect(seen.size).toBe(3);

    root.add(new Mesh(mesh.geometry, mesh.material));
    noteBuilds(root, seen);
    expect(seen.size).toBe(4);

    mesh.material = new MeshBasicMaterial();
    noteBuilds(root, seen);
    expect(seen.size).toBe(5);

    mesh.geometry = new SphereGeometry();
    noteBuilds(root, seen);
    expect(seen.size).toBe(6);

    root.remove(mesh);
    noteBuilds(root, seen);
    expect(seen.size).toBe(6);
  });

  it("counts every material of a mesh that has several, and sees nothing in a graph with no drawable", () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), [new MeshBasicMaterial(), new MeshBasicMaterial()]));
    expect(count(root)).toBe(4);
    expect(count(new Group().add(new Group()))).toBe(0);
  });

  it("does not read a name: two meshes named alike are two", () => {
    const root = new Group();
    const first = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const second = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    first.name = second.name = "the same";
    root.add(first, second);
    expect(count(root)).toBe(6);
  });
});

describe("buildsOf", () => {
  it("is one set for a stage that has a test id, even when its host is a new element", () => {
    buildsOf({ dataset: { testid: "stage-a" } }).add("one");
    expect([...buildsOf({ dataset: { testid: "stage-a" } })]).toEqual(["one"]);
    expect(buildsOf({ dataset: { testid: "stage-b" } }).size).toBe(0);
  });

  it("is one set per element for a host with no test id", () => {
    const host = { dataset: {} };
    buildsOf(host).add("one");
    expect(buildsOf(host).size).toBe(1);
    expect(buildsOf({ dataset: {} }).size).toBe(0);
  });
});

// The still-frame rig draws one frame for a poster or a golden: it is no stage, and nobody reads its counters.
const exempt = new Set(["Still.tsx"]);

/** The Canvas elements in `source` that have no `GpuCounts` inside them. */
const uncounted = (source: string): string[] => (source.match(/<(?:WebGPU)?Canvas\b[\s\S]*?<\/(?:WebGPU)?Canvas>/g) ?? []).filter((canvas) => !canvas.includes("<GpuCounts"));

describe("every 3D stage in the catalog", () => {
  const src = fileURLToPath(new URL(".", import.meta.url));
  const files = readdirSync(src).filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx") && !exempt.has(name));

  it("has the counter inside each of its Canvas and WebGPUCanvas elements", () => {
    const stages = files.flatMap((name) => (readFileSync(join(src, name), "utf8").match(/<(?:WebGPU)?Canvas\b/g) ?? []).map(() => name));
    expect(stages.length).toBeGreaterThanOrEqual(5);
    for (const name of files) expect(uncounted(readFileSync(join(src, name), "utf8")), `${name} has a Canvas with no GpuCounts`).toEqual([]);
  });

  it("is a check that sees a Canvas with no counter", () => {
    expect(uncounted("<Canvas frameloop={x}><Lights /></Canvas>")).toHaveLength(1);
    expect(uncounted("<WebGPUCanvas><GpuCounts target={t} /></WebGPUCanvas>")).toEqual([]);
    expect(uncounted("<WebGPUCanvas><Lights /></WebGPUCanvas><Canvas><GpuCounts /></Canvas>")).toHaveLength(1);
  });
});
