# Credit
- **What:** `lumin-ui`, whose scripted checks and judgment now include a slop-pattern area: the decoration a generated interface reaches for, and the direction, type and copy discipline that replaces it.
- **Inspired by:** [MengTo/Skills](https://github.com/MengTo/Skills) at `a7f25b25e9e15e1944f9fe6d69d943f77a155ef7` (MIT, vendored in `assets/vendor/mengto-skills`)
- **Inspired by:** [google-gemini/demolab](https://github.com/google-gemini/demolab) at `cd0c1f8540c0186ec9592af972a0700fa20909d4` (Apache-2.0, vendored in `assets/vendor/gemini-demolab`) — credited to Google
- **License of this skill:** MIT OR Apache-2.0, as the rest of this repository
- **Vendored copies:** `assets/vendor/mengto-skills/CREDIT.md`, `assets/vendor/gemini-demolab/CREDIT.md`

This skill is **inspired by** both sets, not adapted from them. The checks are LuminosiTS's own rules, written as data in
`lumin-ui.nu` and run over the repository's own JSX and CSS; the judgment is rewritten in this repository's words and
vocabulary. What was taken is the technique:

| Source | What it contributed |
|---|---|
| the two design-audit skills in the first set (`agent-skills/ui/audit-ai-design-slop`, `agent-skills/ui/no-ai-design-slop`) | the split between a quality defect and a slop pattern, evidence cited at a location, the catalogue of decorative defaults (eyebrow kickers, capsule chips, fake telemetry, decorative numbering), and "delete it" as the first fix |
| the frontend-design skill in the second set (`skills/gemini-frontend-design/SKILL.md`) | the direction drawn from the subject, the palette beyond beige, at most two families and three body sizes below the hero, one primary action per section, copy that leads with the benefit, and the visual pass before finishing |

What was not taken: any prompt or instruction to call a font service, a content-delivery host or an image generator — this
repository's pages run under a content-security policy, and the skill says nothing that would ask for one. Nor was any
name, mark or text kept in the skill body: `SKILL.md` and `judgment.md` name no source at all, and this file is the one
place that does.

`evals.json` beside this file is LuminosiTS's own: eight fixed prompts with the answer the skill is expected to give, the
facts each answer needs, and a list of things the skill must never say. `tools/lumin/src/skills.test.ts` checks both.
