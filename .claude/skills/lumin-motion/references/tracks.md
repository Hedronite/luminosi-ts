# Tracks: the v2 scene document

The contract these notes are written against lands in G4. Until then a document is v1 and has no tracks; this file is the
shape the code will accept, so a scene can be designed in it now.

## A document, version 2

```jsonc
{
  "version": 2,
  "look": "hedron",
  "nodes": [ /* as in v1 */ ],
  "tracks": [
    { "id": "…", "target": "…", "keyframes": [ { "time": 0, "value": 0 } ], "driver": "time", "trigger": "load" }
  ],
  "clips": [ { "id": "…", "tracks": ["…"], "easing": "standard" } ],
  "rest": { "node-id.property.path": 0 }
}
```

A v1 document migrates to v2 by gaining empty `tracks`, `clips` and `rest`: a scene with no motion is a valid v2 scene, and
a v2 document with no tracks renders exactly as v1 did.

## Tracks

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | unique in the document; what a clip names |
| `target` | yes | a property path: `<node id>.<property>` where the property is one the node's kind has |
| `keyframes` | yes, one or more | `{ time, value, easing? }`, times rising, the first at 0 |
| `driver` | no | `time` (default), `scroll`, `pointer` |
| `trigger` | no | `load`, `hover`, `in-view`, `scroll-scrub`; a trigger without a driver is refused |

- **Times are seconds** in clip time. A track driven by scroll maps progress to its keyframe span; it has no wall clock of
  its own.
- **Values are the property's own type**: a number for a transform component, a list for a vector, a color token name for an
  ink. A value of the wrong type is refused with the keyframe's index and the target path.
- **A property path is checked against the node.** `hero-title.transform.position.y` is a path; `hero-title.position.y`
  is refused with the path it could not resolve, because the transform names its channels.
- **One track drives one property.** Two tracks on one path are refused: a scene with two answers for one value is a bug,
  not a blend.

## Clips

A clip names tracks that belong together, and may carry the default `easing` for its tracks.

- A clip's tracks share the clip's time base. A clip's length is its longest track.
- A track may belong to one clip. A track in no clip is played by its own trigger.
- A clip is how a scene expresses a beat: `hero`, `chapter-2`, `outro`. It is not a sequence of clips: chaining clips is a
  trigger's job, not a data structure's.
- A clip that a trigger scrubs must have every track driven by `scroll`; a mix of drivers inside one scrubbed clip is
  refused.

## Rest

`rest` holds a value for **every animated property**, keyed by the same property path a track targets.

- A missing rest value for an animated property is refused: reduced motion has nothing to hold without it.
- The rest pose is the scene's *complete* state, not an intermediate one. If a hidden element is at `opacity: 0` in its
  rest pose, the content it carries is invisible to a reduced-motion visitor; carry it in the document instead.
- `rest` may hold a value for a property no track drives; it is then simply the scene's state.

## Editing and diffing

`lumin scene patch` (G4 adds tracks to its operations) applies the package's edit operations all or nothing, and `lumin
scene diff` compares two documents by node id and track id. A patch that adds a track with a bad path is refused with the
path, and the document is left as it was.

## Migrating a version 1 document

1. Bump `version` to 2.
2. Add `"tracks": []`, `"clips": []`, `"rest": {}`.
3. Nothing else: a v1 scene renders identically, and the round trip (parse then serialize) is an identity on a v2
   document.

A migration never invents a track. A scene that should move gets its tracks from a person or an agent, not from a
migration.

## What a track is not

- **Not a curve editor's model.** A track is keyframes and an easing token; a bezier handle per keyframe is a curve editor,
  which is out of scope. Numeric fields and agent editing come first.
- **Not rigging.** A track drives a property of a node; a skeleton, a constraint or a physics body is not a track.
- **Not a script.** There is no expression language and no script hook. A behaviour that cannot be written as keyframes on
  a property path is not in D7.
