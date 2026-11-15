---
name: lumin-new
description: >
  Add a source asset to LuminosiTS. Today: a stroke icon from an SVG on the 24-unit grid, written to
  assets/src/icons with its icons.json entry, after checking the id is free and the SVG uses only allowed
  shapes. Writes files: run only when a human asked, and dry-run first.
---

# lumin-new

`lumin-new.nu` beside this file. Needs `nu` and `bun`. Prints `{ ok, command: "new-icon", data }` where `data`
is the plan (`svgPath`, `metaPath`, `entry`, `next`) and `dryRun`. Fails with `kind` `usage`, `exists` (id taken
by any asset or icon source) or `invalid` (wrong viewBox, disallowed elements, or fill/stroke/style/class).

```bash
nu lumin-new.nu icon arrow-up-right --name "Arrow up right" --tags navigation --svg ./arrow.svg --dry-run
nu lumin-new.nu icon arrow-up-right --name "Arrow up right" --tags navigation --svg ./arrow.svg
bun run icons                                      # then regenerate packages/icons
```

The SVG: `<svg … viewBox="0 0 24 24">` with only `path`, `circle`, `ellipse`, `line`, `polyline`, `polygon` and
`rect`, no fill, stroke, style or class (the renderer draws a 2-unit round stroke). Keep it on the grid and
legible at 16 px. Then `nu ../lumin-check/lumin-check.nu --only icons:check,test`.
