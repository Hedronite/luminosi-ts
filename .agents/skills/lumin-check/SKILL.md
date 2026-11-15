---
name: lumin-check
description: >
  Run the LuminosiTS gate (icons check, typecheck, build, validate, tests, lint, boundaries, knip, browser
  tests) and get one JSON summary: which step failed and its last lines. Use before calling work done, or to
  see which step breaks. `bun run check` is the definition of done; this is that, summarized.
---

# lumin-check

`lumin-check.nu` beside this file. Needs `nu` and `bun`. Prints `{ ok, command: "check", data: { steps } }`;
each step has `step`, `ok`, `ms` and `tail` (the last 15 lines). On failure `kind` is `failed` and `data.steps`
still holds what ran. Stops at the first failing step unless `--keep-going`.

```bash
nu lumin-check.nu                                  # every step, in CI order
nu lumin-check.nu --only typecheck,lint            # a subset, still in CI order
nu lumin-check.nu --keep-going                     # report every failure, not just the first
```

Steps: `icons:check` `typecheck` `build` `validate` `test` `lint` `boundaries` `knip` `e2e`.
`e2e` and `validate` need `build` first; run them with it, or after a build.
A red step is fixed in the code, never by weakening a rule (AGENTS.md).
