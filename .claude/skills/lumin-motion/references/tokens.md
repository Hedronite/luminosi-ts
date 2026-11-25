# Tokens

Motion in this repository is token-first. The base three durations are the token package's own; the rest are this skill's
proposal for D8, named here so scenes do not invent numbers.

## Durations

| Token | Milliseconds | Class |
|---|---|---|
| `duration.fast` | 120 | micro: hover, press, focus ring |
| `duration.base` | 200 | UI state: toggle, select, small panel |
| — | 180 to 260 | a panel opening from a control |
| — | 220 to 320 | a popover or a toast arriving |
| — | 400 to 800 | a section entrance |
| — | 800 to 1600 | a hero sequence, in beats |
| `duration.slow` | 320 | the top of the UI range, the bottom of the entrance range |

Pick the class first, then the number: a hover at 320 ms feels broken, an entrance at 120 ms is a flicker.

## Easing

| Token | Shape | Where |
|---|---|---|
| `enter` | decelerating (ease-out) | anything arriving: a panel, a section, a title |
| `exit` | accelerating (ease-in), shorter than the enter | anything leaving |
| `settle` | decelerating with no overshoot | the last beat of a hero, a value that comes to rest |
| `standard` | a gentle ease-out with a soft start | hovers, UI state, the default |
| `linear` | none | a scrubbed track, and only that |

- Overshoot (elastic, bounce) is not in the set: a product's motion comes to rest.
- Two easings in one clip are enough. A third is usually a track that should be a beat.
- A raw cubic curve is not written in a scene document; a clip names a token or nothing, and gets `standard`.

## Stagger and offsets

- **Stagger:** 40 to 90 ms between items of a group (lines, cards, list rows). Less below 480 px wide.
- **Offsets:** 8, 16 or 24 px. A rise is 16 px for a card, 24 px for a headline, 8 px for a label.
- **Scale:** 0.98 to 1 for a small emphasis, never 0.5 to 1.
- **Opacity:** 0 to 1 in the same span; a fade alone is not an entrance.

## Three worked entrances

### A hero title (time driver, load trigger)

| Keyframe | Time | Value | Easing |
|---|---|---|---|
| 1 | 0.00 s | opacity 0, y 24 px | `enter` |
| 2 | 0.80 s | opacity 1, y 0 | `settle` |

Supporting copy follows 120 ms later with a 0.6 s `enter`; the action last, 200 ms after the copy. Rest pose: opacity 1,
y 0 — a reduced-motion visitor sees the finished page.

### A section reveal (in-view trigger, once)

A card block rises 16 px over 0.5 s, opacity 0 to 1, `enter`, fired when a third of it is visible. Items stagger 60 ms.
`replay` stays off: scrolling up and back down does not re-run it.

### A scrubbed chapter (scroll driver, scroll-scrub trigger)

A camera moves from one composed frame to the next across a chapter's scroll span:

| Keyframe | Progress | Value | Easing |
|---|---|---|---|
| 1 | 0.0 | camera z 6.0 | `linear` |
| 2 | 1.0 | camera z 3.2 | `linear` |

`linear` because the damping is the conductor's job, not the curve's; a second ease on top of a damped input reads as lag.
The chapter's rest pose is its first keyframe, which is also the frame a reduced-motion visitor sees.

## Budgets a motion must hold

From the repository's own budgets, a motion may not be the reason a line goes over:

- A stage adds no texture and no geometry for motion; a track moves what is there.
- A frame's work is O(nodes animated), not O(tracks * keyframes): keyframes are looked up, not scanned per frame.
- A paused, hidden or off-screen stage renders zero frames.
