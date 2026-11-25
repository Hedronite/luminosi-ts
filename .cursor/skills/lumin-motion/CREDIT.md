# Credit
- **What:** A motion skill in LuminosiTS's own terms: tracks, clips, drivers, triggers, rest pose, reduced motion and motion tokens for `lts-scene`.
- **Inspired by:** [MengTo/Skills](https://github.com/MengTo/Skills) at `a7f25b25e9e15e1944f9fe6d69d943f77a155ef7` (MIT, vendored in `assets/vendor/mengto-skills`)
- **License of this skill:** MIT OR Apache-2.0, as the rest of this repository
- **Vendored copy:** `assets/vendor/mengto-skills/agent-skills/web-design/…` (see `assets/vendor/mengto-skills/CREDIT.md`)

This skill is **inspired by** those skills, not adapted from them. What was taken is the technique: the motion token
classes and their numbers, the choreography patterns worth shipping, the scroll conductor's mechanism (measured anchors,
a damped progress with a clamped step, pause on hidden), the "animate once" default for a section reveal, and the rest-pose
answer to reduced motion. What was not taken: the renderer they are written against, any library they name, any code, and
any name, mark or text belonging to their authors or to a product.

The sources this distils, all in the pinned folder above:

| Vendored skill | What it contributed |
|---|---|
| `agent-skills/web-design/animation-systems` | duration classes, the easing set, stagger, choreography order, "delete a motion that serves nothing" |
| `agent-skills/web-design/build-threejs-scroll-worlds` | the scroll conductor (anchors, damping, clamped step, hidden pause), the chapter ledger under a scene, "store the contract as data" |
| `agent-skills/web-design/scroll-world-storytelling` | how to choose between a real-time world, a scrubbed sequence and a document-led story |
| `agent-skills/web-design/scroll-progress-timeline` | progress as a value a clip reads, and the once-per-section default |
| `agent-skills/web-design/scroll-scrubbed-object-handoff` | a scrubbed sequence as keyframes over a span |
| `agent-skills/web-design/cinematic-scroll-storytelling` | beats and staging for a scroll story led by the document |
| `agent-skills/web-design/scroll-scrubbed-visual-sequence` | a sequence whose time is scrubbed, and when a scrub is the wrong answer |

The evals beside this file (`evals.json`) are LuminosiTS's own: ten fixed prompts with the answer this skill is expected to
give, run by `tools/lumin/src/skills.test.ts`.
