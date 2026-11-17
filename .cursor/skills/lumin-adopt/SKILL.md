---
name: lumin-adopt
description: >
  Learn from and port open-source work vendored under assets/vendor into LuminosiTS: study a folder or a
  module (what each file is, the techniques and packages it uses, what could become a library shader,
  screen effect, primitive or object), plan and open a port with its credit, origin and porting steps, and
  adopt a vendored agent skill into .agents/skills. study is read-only; adopt and skill write files, so run
  them only when a human asked, and dry-run first.
---

# lumin-adopt

`lumin-adopt.nu` beside this file. Needs `nu` and `bun`. Prints `{ ok, command, data }` or
`{ ok: false, command, error, kind, exit }`. Paths are `FOLDER/PATH` under `assets/vendor`.

```bash
nu lumin-adopt.nu study codevember-2026/07                 # roles, techniques, packages, port candidates
nu lumin-adopt.nu study threeui/src/shaders/crt/crtShaders.ts
nu lumin-adopt.nu adopt threeui/src/shaders/crt/crtShaders.ts --as effect --id crt --name "CRT screen" --dry-run
nu lumin-adopt.nu adopt threeui/src/shaders/crt/crtShaders.ts --as effect --id crt --name "CRT screen"
nu lumin-adopt.nu skill jakubkrehel-skills/skills/better-ui --dry-run
nu lumin-adopt.nu skill jakubkrehel-skills/skills/better-ui && bun run skills:sync
```

## Study

Reads source text only. Each module gets a `role` (`tsl-material`, `glsl-shader`, `screen-shader`,
`geometry`, `component`, `audio`, `ui`, `logic`, `types`), its `techniques`, its exports, the packages it
imports and its local import `closure`. `selfContained` means it needs nothing beyond three, React and R3F.
`candidates` are the self-contained modules with a role the library has a kind for, smallest first: the
places to start.

## Adopt

The plan names the target package and files, the `origin` to put on the asset's info (so its manifest and
the catalog credit the source), the two-line header to put above the port, the license that governs it, the
upstream files the port has to understand, and `steps` chosen by the techniques (GLSL to TSL, screenUV's
top-left origin, leaving raw WebGL behind, palette defaults). Without `--dry-run` it copies the upstream
files, the license and the credit into `.adopt/ID` (gitignored scratch) with `PLAN.json`.

Then do the port by hand, in the package, to the house rules: TSL on the WebGPU renderer, a zod schema
with defaults, colors from the look's palette, tests, and `origin` with a one-sentence `note` on what was
taken and what changed. Take the technique, never the dressing: no brand names, logos, product, film or
other third-party text or marks. Check with `nu ../lumin-check/lumin-check.nu`; `adopt.test.ts` fails if an
origin names a vendored file that is missing or has no license.

## Skills

`skill` copies a vendored skill folder into `.agents/skills/NAME` as published, with the folder's license
and a `CREDIT.md` that says where it came from. Only when a person asks for that skill, having read it
whole: a vendored skill is someone else's instructions to agents, and none is adopted yet. Run `bun run skills:sync` after. An adopted skill stays
byte-identical to its vendored copy (a test checks); to change it, update the vendored folder and adopt
again with `--force`. It refuses to replace a skill that was not adopted from the same place.
