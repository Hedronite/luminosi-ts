---
name: lumin-motion
description: >
  Design and review motion in LuminosiTS scenes as data: keyframe tracks on a property path, clips, the drivers that move
  them (time, scroll, pointer), the triggers that start them (load, hover, in-view, scroll-scrub), a rest pose per animated
  property, and the reduced-motion rule that every stage obeys. Gives the motion tokens (durations, easing, stagger) and
  the choreography patterns worth shipping, in the vocabulary of `lts-scene` and the `lumin` commands. Use when a scene,
  page or element should move, when a scroll story is asked for, when an animation feels wrong, or when reviewing motion.
---
# lumin-motion

Motion in LuminosiTS is **data on a scene document**, not a library call: a track names a property path, its keyframes and
an easing token, a clip groups tracks, a driver produces the input, and a trigger decides when. The stage reads the
document and plays it from a clock it is given. Nothing in this skill names an animation library, because the document is
the library.

Two rules sit above everything else here:

- **A rest pose exists for every animated property.** Reduced motion is that pose, held, with no animation frames.
- **A stage that is not on screen renders no frames.** A stage that is out of view is not running slowly; it is stopped.

## What exists today, and what this skill is written against

The track document is **in the schema**: `lts-scene` version 2 carries `tracks`, `clips` and `rest`, a version 1 document comes up
through the migration, and `lumin scene validate`, `patch` and `diff` cover tracks. Its runtime shipped in G5 and its emission and
playground in G6, so the whole document, its runtime, the emission and the playground work today:

| Piece | State |
|---|---|
| `lts-scene` **v2** with `tracks`, `clips`, `rest` | **shipped** |
| Migration from v1 documents to v2 | **shipped** |
| `lumin scene patch` and `diff` covering tracks | **shipped** |
| `createScene` and the `<Scene>` adapter playing tracks from an injected clock | **shipped in G5** |
| Drivers (time, scroll, pointer) and triggers (load, hover, in-view, scroll-scrub) | **shipped in G5** |
| Reduced motion holding the rest pose on every stage | **shipped in G5** |
| `toTsx` and `toVanilla` emitting tracks; the playground editing them | **shipped in G6** |
| `lumin scene` creating and patching a track with no browser | **shipped in G6** |

A v1 document has no tracks: `lumin scene validate` migrates it, and the migrated document's motion is empty. All of it is shipped: the runtime, the triggers and reduced motion (G5), the emission and the
playground (G6).

## The shape of a track

A track is a property path, its keyframes, and the easing tokens between them. A clip groups tracks. A rest pose is the value each
animated property holds when nothing is driving it. This document is a complete scene: a version 2 `lts-scene` document with one
entrance, and the parser reads it as shown.

```json
{
  "format": "lts-scene",
  "version": 2,
  "look": "neutral",
  "seed": 0,
  "nodes": [
    {
      "id": "hero-title",
      "parent": null,
      "position": [0, 2, 0],
      "rotation": [0, 0, 0],
      "scale": [1, 1, 1],
      "asset": {
        "kind": "primitive",
        "id": "platonic-cube"
      },
      "surface": {
        "material": "metal"
      }
    }
  ],
  "lights": {
    "rig": "studio",
    "intensity": 1
  },
  "environment": {
    "kind": "studio"
  },
  "camera": {
    "target": [0, 0, 0],
    "position": [0, 1, 6],
    "fov": 35
  },
  "effects": [],
  "ink": "look",
  "tracks": [
    {
      "id": "hero-rise",
      "target": "node.hero-title.position",
      "keyframes": [
        {
          "time": 0,
          "value": [0, 2, 0],
          "easing": "enter"
        },
        {
          "time": 0.8,
          "value": [0, 0, 0],
          "easing": "settle"
        }
      ],
      "driver": "time",
      "trigger": "load"
    }
  ],
  "clips": [
    {
      "tracks": [
        "hero-rise"
      ],
      "id": "hero",
      "easing": "standard"
    }
  ],
  "rest": {
    "node.hero-title.position": [0, 0, 0]
  }
}
```

- **Times are seconds in the clip's own time**, not frames: the clock decides how fast they are played, and a scrubbed track is mapped
  from progress, never from the wall clock.
- **A property path is checked when the document is read** against the document itself: a node has `position`, `rotation` and `scale`, each a vec3, and a track drives one of them whole. a node that is not there, a surface parameter on
  a node with no surface, an effect that is not there, or a field a property does not have is refused with the path, not ignored. The
  paths are `node.<id>.position|rotation|scale` (a vec3), `node.<id>.surface.params.<name>`, `effect.<id>.params.<name>` and
  `camera.position|target` (a vec3) or `camera.fov` (a number).
- **Every animated property has a rest value**, and a rest value's type is the property's: a track without one is refused.
- **The easing is a token** — `enter`, `exit`, `settle`, `standard` or `linear` — never a raw curve.
- **`driver` and `trigger` are data** in G4 (G5 reads them): `time`, `scroll`, `pointer`; and `load`, `hover`, `in-view`, `scroll-scrub`.

## Drivers: what moves a track

| Driver | What it produces | Use it for |
|---|---|---|
| `time` | seconds since the track started, clamped at both ends | entrances, loops, a state change |
| `scroll` | progress 0 to 1 across the scene, its direction, and a damped copy | camera moves, chapter transitions, a scrubbed film |
| `pointer` | position in the stage, -1 to 1 on each axis | parallax, a light that follows the cursor, a tilt |

A scroll driver is fed by a conductor, not by a scroll event: it measures the anchors once, reads the scroll position
passively, damps toward it, clamps its step to 1/30 s, and pauses while the document is hidden. That is what makes a
scrubbed scene reversible and the same on a fast machine and a slow one.

## Triggers: when a track starts

| Trigger | Fires | Notes |
|---|---|---|
| `load` | once, when the stage has drawn its first frame | the entrance of the page |
| `hover` | while the pointer is over the stage | a lift, a glow, a short loop |
| `in-view` | when the stage or the node enters the viewport | run it **once** unless a replay is asked for |
| `scroll-scrub` | while a scroll driver's progress moves through the clip | progress maps to time, backwards included |

`animate once` is the default for `in-view`: a section reveal that replays on every small scroll is noise. A replay is a
deliberate `replay: true` on the trigger, not an accident of the input.

## The rest pose, and reduced motion

Every animated property needs a rest value, and the rest value is what the scene looks like when motion is off:

- Under `prefers-reduced-motion: reduce` **every stage shows the rest pose and renders no animation frames**. Not a
  slower entrance, not a fade: the held pose.
- A pointer or hover track does not run; the rest pose is what the visitor sees.
- A scroll-scrubbed scene snaps to the nearest composed chapter and holds it.
- Content is visible at the rest pose. Motion never carries information that only motion shows.

## Motion tokens

The base durations are the packages' own (`@hedronite/lts-tokens`): `fast` 120 ms, `base` 200 ms, `slow` 320 ms. This
skill adds the classes a scene needs above them, and the easing set to pair with each:

| Class | Duration | Easing token | Example |
|---|---|---|---|
| Micro (hover, press) | 120 to 200 ms | `standard` | a button lift, a card glow |
| UI state (toggle, select) | 180 to 260 ms | `standard` | a panel that opens |
| Small transition (popover, toast) | 220 to 320 ms | `enter` in, `exit` out | a tooltip |
| Section entrance | 400 to 800 ms | `enter` | a paragraph block rising |
| Hero sequence | 800 to 1600 ms, in beats | `enter`, then `settle` | a title, then the visual |
| Scrub | whatever the scroll gives | `linear` | a camera move across chapters |

The token names are `enter` (decelerating, ease-out), `exit` (accelerating, ease-in), `settle` (a gentle overshoot-free
stop), `linear` (scrub only) and `standard` (the default). Until D8 puts these in the token package, a clip names them and
the stage maps them; no easing is written as a raw cubic curve in a scene document.

Stagger is 40 to 90 ms per item in a group, less on a narrow screen. Offsets are 8, 16 or 24 px, never an arbitrary
number; see [references/tokens.md](references/tokens.md) for the table in full and the worked entrances.

## Choreography that earns its place

1. **Hero, then supporting elements, then the action.** One moment first; the rest follows with a small stagger.
2. **A section reveals once, when a fifth to a third of it is visible.** Not on every pixel.
3. **Hover is a lift and a glow, not a bounce.** 2 to 6 px, a slightly stronger shadow, a short duration.
4. **Scroll moves the world; the pointer answers locally.** A scroll-scrubbed camera and a hovered object can coexist,
   and neither takes the other's job.
5. **A transition explains a relationship** (where a panel came from, what changed). If it explains nothing, delete it.

## Review checklist

- The document is valid: every target path exists, every keyframe time rises, the clip's tracks exist.
- Every animated property has a rest value, and the scene is complete at the rest pose.
- Reduced motion holds the rest pose and draws no frames.
- The stage is off-screen when its frames should be zero, and hidden tabs have zero.
- The durations are from the table, the offsets are from the set, and the easing is a token.
- Scroll is reversible: scrolling back plays it back, and a reload at depth shows that chapter.
- Nothing animates layout (width, height, top, left) or a value that forces a reflow each frame.
- No library, no brand, no vendor name: the document is the source of truth.

## References

- [references/tracks.md](references/tracks.md): the v2 document — tracks, clips, rest, property paths, the v1 migration.
- [references/drivers-and-triggers.md](references/drivers-and-triggers.md): each driver and trigger in full, the conductor
  contract, and what a paused or hidden stage does.
- [references/tokens.md](references/tokens.md): the duration and easing tables, stagger, offsets, and three worked entrances.
- [references/rest-and-reduced-motion.md](references/rest-and-reduced-motion.md): the rest pose rule, reduced motion on every
  stage, and the budgets a motion must not break.
- [evals.json](evals.json): ten fixed prompts with the answer this skill is expected to give, checked by a test.
