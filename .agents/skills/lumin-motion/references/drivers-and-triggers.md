# Drivers and triggers

A **driver** is what a track reads to know where it is; a **trigger** is what decides that it is running. They are
separate on purpose: the same clip can be driven by time on load and the same shape by scroll in a story.

## Drivers

### `time`

Seconds since the clip started, from the clock the stage is given — never from the browser's own frame time in a test.

- The clock is injected in G5: a stage plays what its clock says, so a test can step to 0.4 s and read the frame.
- Time is clamped at both ends of the clip. A looping track names its span in the clip.
- A hidden tab stops the clock; it does not run fast when the tab returns.

### `scroll`

Progress across the scene, 0 to 1, with three parts:

| Part | What it is |
|---|---|
| `progress` | the exact position, measured from the scene's anchors |
| `direction` | `1` down, `-1` up, `0` still |
| `smooth` | a damped copy of `progress`, what the scene should draw |

The conductor behind it (G5):

1. **Measures once.** Each anchor is a section's midpoint, clamped to the scrollable height; the first is 0, the last is
   the end. It re-measures on resize and on a section's own resize, not every frame.
2. **Reads passively.** One scroll listener with `{ passive: true }`, and the scroll position is read there, never in the
   draw loop.
3. **Damps.** `smooth += (progress - smooth) * (1 - exp(-lambda * dt))` with a small `lambda` (about 5), and a step
   clamped to `1/30` s so a stall does not jump the scene.
4. **Snaps under reduced motion.** `smooth` is `progress`; there is nothing to damp.
5. **Pauses when hidden.** `visibilitychange` stops the loop; coming back restarts it from the measured position.

The same contract makes a scrubbed scene **reversible**: scrolling up plays it backwards, a reload at depth opens at that
chapter, and an anchor link lands on the composed frame.

### `pointer`

The pointer's position in the stage, -1 to 1 on each axis, with the distance from the centre.

- It runs only while the stage is hovered or focused; on touch it is the last tap, or nothing.
- A pointer track must have a rest pose: a tilt or a parallax at rest is 0, not the last place the pointer was.
- It never moves the scroll story: if a scroll driver is also running, the pointer answers locally.

## Triggers

| Trigger | When it starts | When it stops |
|---|---|---|
| `load` | after the stage's first frame is drawn | at the clip's end, and it does not replay |
| `hover` | pointer enter or keyboard focus | pointer leave or blur; the clip returns to rest |
| `in-view` | the node or the stage crosses the viewport threshold | at the clip's end; `replay: true` allows a second run |
| `scroll-scrub` | whenever progress moves through the clip's span | when progress leaves the span; the scene holds the edge value |

Rules that hold for all four:

- **A trigger fires once per entry** unless `replay` says otherwise. `in-view` without `replay` is the default section
  reveal.
- **A trigger does not fire on an element that cannot be seen.** A node behind an occluder or outside the stage is not
  in view.
- **The first paint is composed.** A load clip starts from its rest pose, so the first frame is the scene as designed, and
  the clip moves it — never a frame of undeclared state.
- **A scrub is not a play.** It has no duration of its own; if the visitor stops scrolling, it stops.

## Off-screen and hidden

- A stage outside the viewport renders **zero frames**: not a low frame rate, zero. An intersection observer starts and
  stops it.
- A hidden document renders zero frames.
- A paused stage holds its last frame; resuming continues from the clock the stage was given, not from wall time.

## What a stage may not do on its own

- Start a loop that nothing stops: every loop is a track with a clip length.
- Read `performance.now()` for a scene's position: the clock is injected.
- Keep a frame's work alive after the node it drew is gone.
