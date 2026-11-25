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

## slop

The slop area is a class of finding beside a quality defect, not a synonym for it. A finding is cited where it is
(`file:line`, the rendered viewport, the measured number) and says which of the two it is:

- **Quality defect**: a usability, accessibility, responsive, content or runtime problem. A rule in `a11y`, `color`,
  `type`, `layout`, `motion`, `ui` or `copy` names one.
- **Slop pattern**: a repeated default, a decorative layer, or a generated-looking convention with no useful role. The
  `slop` rules name the mechanical ones; the judgment below covers what a script cannot see.

Never guess whether a machine made the page, never give it a score, and never reject a technique by itself: a gradient, a
serif, a glass surface or a card is not a finding. A pattern is a finding when it carries no information.

- **Direction.** A page that stands for something has one visual direction, drawn from its subject — its materials,
  light, audience — and held from the first screen to the footer. If the direction cannot be said in one sentence, the
  page does not have one yet.
- **Palette beyond beige.** Warm cream with rust, or dark slate with neon purple, is a reflex, not a choice. Ask what the
  subject is made of: roast, forest, ink, marine, stone, silver, sunlit pastel, gallery light. A page may be quiet; it may
  not be colourless by default. Every colour comes from the look's tokens.
- **Type discipline.** At most two families, and at most three body sizes below the hero: differentiate with weight, family
  and colour, not a fourth and fifth step. The hero's display size and the wordmark are the two exceptions, and body prose
  stays at one scale — no oversized lead paragraph over smaller ones.
- **No decorative chips, badges or telemetry.** A capsule or a bordered chip belongs to a control or a real status cell. A
  "LIVE" dot, a "SCROLL" cue, an eyebrow kicker above a section heading: each is a finding, and each is deleted rather than
  restyled.
- **No decorative numbering.** A heading numbered `01`, `[ 01 / 04 ]` or `I.` is decorative numbering unless the sequence
  is real; make it an ordered list where the order means something, or drop the number.
- **No shouted headings.** A heading set in capitals is a shouted heading: a finding. Use sentence case; weight and size
  carry the hierarchy.
- **One primary action.** A section has one primary action; a second is a link or a different control, not a twin button.
  Choices between modes, sizes or filters are a segmented control, tabs, radios or a select — not a row of bordered
  buttons.
- **Copy that sells the thing, not itself.** Headings lead with the benefit or the fact ("Instant local reasoning"), not
  the number or the spec, and generated copy carries no em-dashes, no stacked adjectives and no commentary about the design
  itself.
- **A visual pass before finishing.** A source scan is not proof. Open the page over HTTP, at desktop and at 390 px, look at
  the opening viewport and below the fold, and check the populated, empty and error states; the rendered pass is what turns a
  finding into evidence. In this repository that is `lumin-ui render --url` for the mechanical parts and a person's eyes for
  the rest.

