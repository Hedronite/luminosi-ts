# The rest pose, and reduced motion

## The rest pose

Every animated property has a value it holds when nothing drives it. That value is written in the document's `rest` block,
and it is the scene's complete state.

- **Complete, not partial.** If a node is off the stage at rest, the scene is still readable: the copy lives in the
  document, not in the animation that reveals it.
- **One value per property.** A property with a track and no rest value is refused: there is nothing for reduced motion to
  hold.
- **The first painted frame is the rest pose** (or the first keyframe, which is the same thing) — never an undeclared
  intermediate.

## Reduced motion

`prefers-reduced-motion: reduce` is not a slower scene. On every stage:

1. **The rest pose is shown.** Every track is skipped, and every animated property takes its `rest` value.
2. **No animation frames are drawn.** The frame counter does not rise; a test reads the counter and expects it flat.
3. **Scrubbed scenes snap to a chapter.** A scroll-scrubbed scene opens at the nearest composed chapter and holds it; it
   does not creep with the scroll.
4. **Pointer and hover tracks do not run.** A tilt rests at 0; a glow stays off.
5. **Content stays visible and reachable.** No element is parked at `opacity: 0` waiting for a motion that will not come.
6. **The decision is live.** A visitor who switches the setting mid-session sees the rest pose on the next frame; a stage
   does not keep moving because it started before the change.

What is *not* acceptable under reduced motion: shortening the duration and playing it anyway; replacing an entrance with a
cross-fade that still animates; a scroll story that keeps the visitor pinned.

## Pausing, off-screen and hidden

| Situation | What the stage does |
|---|---|
| The visitor paused it | holds the last frame, the clock stops |
| The stage is out of the viewport | renders **zero** frames; an intersection observer stops it |
| The document is hidden | renders zero frames; a hidden tab does not fast-forward on return |
| The stage is scrolled back into view | resumes from the injected clock, from the frame it showed |

The frame counter is the proof: a test asserts it flat while a stage is off-screen, and rising again on return.

## What to say in a review

Name the pose and the counter, not the intention:

- "Reduced motion shows the rest pose on both stages; the frame counter stays flat for 2 s, then rises on return."
- "The hero's rest pose is opacity 1, y 0, so a visitor with motion off reads the finished page."
- "The scrubbed chapter holds its first keyframe at reduced motion, and the copy is in the document."

A claim that motion is off with a rising frame counter is the failure, however the code reads.
