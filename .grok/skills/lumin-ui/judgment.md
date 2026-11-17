# Judgment: what the script cannot decide

Read only the sections the review names. One fast test per question; a finding needs a location, the
user it hurts and a fix. A choice you merely dislike (a density, a radius, a voice) is never a finding.

## Severity

- **HIGH**: blocks a task, misleads, hides something, risks losing work, or repeats across the product.
  These are HIGH on sight: a control with no name; no visible focus; a pointer-only path; motion that
  ignores reduced motion; content clipped or overlapping at 320px or 200% zoom; text below contrast;
  color as the only signal; a destructive action with no confirm or undo; truncated text with no way to
  read it; hidden content with no cue that it exists; an error with no way forward; a semantic color used
  for another meaning; a state change shown only by motion.
- **MEDIUM**: slows or confuses, or breaks consistency. **LOW**: isolated polish.
- Within a severity, rank by reach: a token or shared component outranks the same symptom in one leaf.

## a11y

- **Keyboard path.** Unplug the mouse in your head: can every action, including orbiting, zooming and
  resetting a 3D view, be done from the keyboard? A canvas also needs a text alternative (name, specs).
- **Color alone.** Picture the screen in grayscale: does every state (selected, error, pressed) survive?
- **Hidden reasons.** Is anything explained only on hover, or a disabled control with no visible reason?
- **Alt text.** Would the alt text, read in place of the image, finish the sentence it sits in?
- **Focus order.** Does Tab follow the reading order, and land where the user's attention is after a
  dialog opens or closes?

## color

- **One hue, one job.** List the hues on screen; each maps to exactly one meaning. Accent marks what can
  be acted on; status colors mean status.
- **Looks.** A pair that passes in the default look and fails in others is a token problem: fix it in the
  look's colors (the converter reports what it moved), not with a per-element override.

## type

- **Hierarchy.** Count sizes and weights in view: two weights far apart read as deliberate; four close
  ones read as accidents. Headings shrink as they nest.
- **Truncation.** Does the hidden part matter for the task (an asset name, a license)? If yes, it needs a
  way to read it.
- **Numbers.** Counts, sizes and timings that change in place want tabular figures.

## layout

- **The one fact.** Name what the user came for on this view. If it is not first and leading, that is the
  finding.
- **Emphasis.** More than one primary action, or more than three secondary ones side by side, wants a menu.
- **Controls versus content.** Does every clickable thing look clickable, and nothing static look like a
  button?
- **Grouping.** Space between groups should be clearly larger (about twice) than space within them,
  unless a card or background carries the group.
- **Edges.** More than two leading edges in one column is noise.
- **Discovery.** For each collapsed or offscreen region: would a first-time user know it exists?

## motion

- **Without motion.** Turn animation off in your head: is every state change still visible?
- **Frequency.** Things used constantly (hovers, toggles, tabs) get little or no motion; rare moments may
  get more. A 3D stage in reduced motion shows a still frame and stays usable.

## copy

- **Recovery.** Every error says what happened and what to do next; an error that keeps happening is a
  design problem, not a copy problem.
- **Tone versus stakes.** Light copy only for success, empty states and onboarding; plain copy wherever
  work can be lost.
- **Words.** One name per thing across the catalog, site and docs (look, preset, theme: pick one), and
  labels that name the result ("Copy snippet", not "OK").
- **Empty states.** Orientation plus one next action; a search with no results echoes the query and
  offers a way out.
