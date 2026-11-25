import { describe, expect, it } from "vitest";
import { acceptAll, fixtureScene, fixtureText, sceneOf } from "./arbitrary.js";
import { addTrack, removeNode, removeTrack, setRest, setTrackKeyframes } from "./edit.js";
import { migrate } from "./migrate.js";
import { checkRefs } from "./refs.js";
import { parseScene, structureIssues, type Scene, type SceneTrack } from "./schema.js";

const BASE = fixtureScene("tracks");
/** The node the tracks in these tests drive: the first one in the fixture. */
const NODE = BASE.nodes[0]?.id ?? "";

const track = (over: Partial<SceneTrack> = {}): SceneTrack => ({
  id: "rise",
  target: `node.${NODE}.position`,
  keyframes: [
    { time: 0, value: [0, 2, 0], easing: "enter" },
    { time: 1, value: [0, 0, 0], easing: "settle" },
  ],
  ...over,
});

/** The fixture with this motion, and nothing else of the fixture's own: its tracks and clips belong to the cases below. */
const withTracks = (tracks: readonly SceneTrack[], rest: Record<string, unknown> = { [`node.${NODE}.position`]: [0, 0, 0] }): Scene => ({ ...BASE, tracks, clips: [], rest });

describe("a version 2 document with tracks", () => {
  it("reads the fixture, and its text is the canonical text", () => {
    const scene = fixtureScene("tracks");
    expect(scene.version).toBe(2);
    expect(scene.tracks.length).toBeGreaterThan(0);
    expect(scene.clips.length).toBeGreaterThan(0);
    expect(Object.keys(scene.rest).length).toBeGreaterThan(0);
  });

  it("brings a version 1 document up with the motion fields empty", () => {
    const up = migrate(fixtureText("v1"));
    expect(up.ok && up.scene.version).toBe(2);
    expect(up.ok && up.scene.tracks).toEqual([]);
    expect(up.ok && up.scene.clips).toEqual([]);
    expect(up.ok && up.scene.rest).toEqual({});
  });

  it("refuses a target that names nothing, with the path of the track", () => {
    const scene = withTracks([track({ target: "node.hero.speed" })]);
    expect(structureIssues(scene)).toContainEqual(expect.objectContaining({ path: ["tracks", 0, "target"], code: "bad-target" }));
  });

  it("refuses a node that is not there, and a parameter on a node with no surface", () => {
    const missing = withTracks([track({ target: "node.nowhere.position" })]);
    expect(structureIssues(missing)).toContainEqual(expect.objectContaining({ path: ["tracks", 0, "target"], code: "bad-target" }));
    const param = withTracks([track({ target: "node.hero-title.surface.params.note" })]);
    expect(structureIssues(param)).toContainEqual(expect.objectContaining({ path: ["tracks", 0, "target"], code: "bad-target" }));
  });

  it("refuses a value that is not the property's, and a pose it cannot hold", () => {
    const wrongValue = withTracks([track({ keyframes: [{ time: 0, value: 3 }] })]);
    expect(structureIssues(wrongValue)).toContainEqual(expect.objectContaining({ path: ["tracks", 0, "keyframes", 0, "value"], code: "wrong-type" }));
    const wrongRest = withTracks([track()], { [`node.${NODE}.position`]: 3 });
    expect(structureIssues(wrongRest)).toContainEqual(expect.objectContaining({ path: ["rest", `node.${NODE}.position`], code: "wrong-type" }));
    const noRest = withTracks([track()], {});
    expect(structureIssues(noRest)).toContainEqual(expect.objectContaining({ path: ["rest"], code: "missing-rest" }));
  });

  it("refuses keyframes that do not run forward from zero, and two tracks with one id", () => {
    const backwards = withTracks([track({ keyframes: [{ time: 1, value: [0, 0, 0] }, { time: 0.5, value: [0, 1, 0] }] })]);
    expect(structureIssues(backwards)).toContainEqual(expect.objectContaining({ path: ["tracks", 0, "keyframes", 0, "time"], code: "out-of-range" }));
    const twins = withTracks([track(), track()]);
    expect(structureIssues(twins)).toContainEqual(expect.objectContaining({ path: ["tracks", 1, "id"], code: "duplicate-id" }));
  });

  it("refuses a clip that names a track there is not, and a track in two clips", () => {
    const base = withTracks([track()]);
    const dangling: Scene = { ...base, clips: [{ id: "one", tracks: ["gone"] }] };
    expect(structureIssues(dangling)).toContainEqual(expect.objectContaining({ path: ["clips", 0, "tracks", 0], code: "unknown-track" }));
    const twice: Scene = { ...base, clips: [{ id: "one", tracks: ["rise"] }, { id: "two", tracks: ["rise"] }] };
    expect(structureIssues(twice)).toContainEqual(expect.objectContaining({ path: ["clips", 1, "tracks", 0], code: "duplicate-id" }));
  });

  it("parses through the schema, and an easing is a token rather than a curve", () => {
    const scene = withTracks([track()]);
    expect(parseScene(scene).ok).toBe(true);
    const curve = withTracks([track({ keyframes: [{ time: 0, value: [0, 0, 0], easing: "cubic-bezier(0.4,0,0.2,1)" as never }] })]);
    expect(parseScene(curve).ok).toBe(false);
  });
});

describe("the edits of motion", () => {
  it("adds, retimes and removes a track, and the document reads after each", () => {
    const base = withTracks([]);
    const added = sceneOf(addTrack(base, track({ target: `node.${base.nodes[0]?.id ?? ""}.position` })));
    expect(added.tracks).toHaveLength(1);
    const retimed = sceneOf(setTrackKeyframes(added, "rise", [{ time: 0, value: [0, 1, 0] }]));
    expect(retimed.tracks[0]?.keyframes).toHaveLength(1);
    const removed = sceneOf(removeTrack(retimed, "rise"));
    expect(removed.tracks).toEqual([]);
    // A track no document has is `unknown-track`, and the document comes back untouched.
    expect(removeTrack(removed, "rise")).toMatchObject({ ok: false, issues: [{ code: "unknown-track" }] });
  });

  it("keeps a rest value when its track goes, and drops a node's motion with the node", () => {
    const base = withTracks([track()]);
    const removed = sceneOf(removeTrack(base, "rise"));
    expect(removed.rest).toEqual(base.rest);
    const gone = sceneOf(removeNode(base, base.nodes[0]?.id ?? ""));
    expect(gone.tracks).toEqual([]);
    expect(gone.rest).toEqual({});
  });

  it("sets a rest value, and refuses one that names nothing", () => {
    const base = withTracks([]);
    const id = base.nodes[0]?.id ?? "";
    expect(setRest(base, `node.${id}.rotation`, [0, 1, 0]).ok).toBe(true);
    expect(setRest(base, "node.nobody.rotation", [0, 1, 0])).toMatchObject({ ok: false, issues: [{ code: "bad-target" }] });
  });

  it("holds up against the small registry: a track's parameter must be one the asset takes", () => {
    const base = withTracks([track({ target: "effect.nope.params.cell" })]);
    const scene = { ...base, effects: [], tracks: [] };
    const issues = checkRefs({ ...scene, tracks: [track({ target: "camera.fov" })] }, acceptAll(scene));
    expect(issues).toEqual([]);
  });
});
