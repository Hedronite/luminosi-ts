---
name: lumin-new
description: >
  Add a source asset to LuminosiTS: a stroke icon from an SVG on the 24-unit grid (assets/src/icons), or an
  object from a reference photo through the image-to-object forge (assets/src/objects), with a review that
  renders it framed like the photo and scores it. Writes files: run only when a human asked, and dry-run first.
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

## Objects from a photo

The forge (`tools/img-to-object/upstream/SKILL.md`) does the reconstruction; these commands bracket it.

```bash
nu lumin-new.nu object your-desk-lamp --from-image ./lamp.png --dry-run
nu lumin-new.nu object your-desk-lamp --from-image ./lamp.png        # makes .img-to-object/your-desk-lamp
# … work the forge in that workspace until it reports action-ready …
nu lumin-new.nu object your-desk-lamp --from-workspace .img-to-object/your-desk-lamp --name "Your desk lamp" --dry-run
nu lumin-new.nu object your-desk-lamp --from-workspace .img-to-object/your-desk-lamp --name "Your desk lamp"
bun run objects                                    # then regenerate packages/objects
nu lumin-new.nu review --spec assets/src/objects/your-desk-lamp.json --reference ./lamp.png --out ./review
```

`--from-image` copies the photo into a gitignored workspace, initializes the forge's state, and returns `next`
(the forge's next command). `--from-workspace` emits through the forge's `lts-object-spec` target (it refuses
with `kind` `not_ready` until the forge reports action-ready), reviews against `reference.*` in the workspace
(needs `bun run build`), and plans `assets/src/objects/<id>.json` plus its `objects.json` entry. Its `review`
holds the Divine Eye's verdict, fidelity, silhouette IoU and hard-gate failures, and the paths of the render,
the three-quarter view and the side-by-side sheet. Read the sheet before accepting: the numbers alone don't
accept a reconstruction. Reference photos stay out of the repo; names and shapes carry no brand.
