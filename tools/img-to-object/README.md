# img-to-object

Turns a reference image of an object into a LuminosiTS `object` asset. It's built on a vendored copy of an Apache-2.0 image-to-Three.js forge (see [`SOURCE.md`](SOURCE.md) and [`NOTICE`](NOTICE)).

## State

- **Vendored and tested:** the upstream skill and forge live in [`upstream/`](upstream/), pinned to 2.0.1. `bun run forge:test` runs the forge's own test suite in CI.
- **First reconstruction:** `dress-watch` (`dressWatchSpec` in `@hedronite/lts-objects`), a generic dress watch read off a reference photo and written as an `ObjectSpec` generator. The forge didn't drive it yet; it was reviewed by rendering it beside the reference (front and three-quarter views, both looks) until the shapes matched.
- **The forge emits ObjectSpec:** [`plugin/`](plugin/) is the `lts-object-spec` emission target, a forge plugin selected with `--target`. No upstream file changes; the forge's socket runs it once a workspace is action-ready, checks the artifact and runs it twice to prove it deterministic.
- **The review loop:** `lumin review-object --spec FILE --reference IMG` measures the photo with the forge's foreground mask, renders the spec on the catalog's `embed.html` (same size and background, the object fitted into the photo's subject box at one scale) and scores it with the forge's Divine Eye and comparison sheet. A spec reviewed against its own render scores silhouette IoU 0.98 (an e2e test).
- **From photo to library:** `lumin new-object ID --from-image IMG` starts a forge workspace (`.img-to-object/ID`, gitignored); once the forge reports action-ready, `--from-workspace` emits through the `lts-object-spec` target, reviews against the workspace's reference and adds `assets/src/objects/ID.json`. `bun run objects` turns those into library assets (`objectSpecById`, the manifest, the catalog). `your-desk-lamp` is the first, from the sample sculpt spec.
- **Next:** more shapes in the emitter (extrusions, sweeps, tubes), a forge run on a real photo end to end, and the review's lighting matched to studio product photos.

## Reviewing a reconstruction

```bash
bun run build                                         # the embed page lives in the catalog build
bun run lumin review-object --spec assets/src/objects/your-desk-lamp.json --reference ./lamp.png --out ./review
```

`./review` gets `render.png` (framed like the photo), `three-quarter.png`, `sheet.png` (the forge's side-by-side), `scores.json` (the Divine Eye: verdict, fidelity, silhouette IoU and scale as hard gates, then structure, edges, tone and objectness) and `review.json`. `--look` picks the token preset; `--yaw` and `--pitch` match the photo's camera. The envelope carries the verdict; the sheet is what accepts or rejects. Hue comes from the look, so color signals compare lightness and structure more than hue.

## The `lts-object-spec` target

```bash
python3 tools/img-to-object/plugin/install.py          # into $IMG2_HOME (default ~/.img2)
# then, in a forge workspace that has reached action-ready:
python3 tools/img-to-object/upstream/forge/stage3_build/emit_target.py \
  --spec object-sculpt-spec.json --target lts-object-spec
# writes .img2/artifacts/lts-object-spec/object-spec.json and object-spec.report.json
```

The emitter (`plugin/emit_object_spec.py`, standard-library Python) reads the fields the forge's TypeScript emitter reads and keeps its rules, so the ObjectSpec and the generated factory agree:

- **Components:** each becomes a part. Its pivot is the transform's position and rotation; its unit-sized shape is sized by `transform.scale`, else `dimensions`, and that size never reaches the children. Supported primitives: box, sphere, ellipsoid, cylinder, cone, capsule (as a lathe), torus, lathe, plane card (as a thin box) and instanced-cluster (its base shape).
- **Attachments:** a cylinder, cone or capsule with an `attachment` is a tapered cylinder from `localStart` to `localEnd`, with its pivot at the start.
- **Sockets:** from `actionProfile.sockets`.
- **Repetition systems:** radial rings of copies, as the factory builds them. Other placement modes are built radial too, and the report says so.
- **Materials:** a preset chosen from metalness, roughness, transmission and emission, a palette slot, and a shade that reproduces the source color's lightness under the neutral look, plus its roughness and metalness. The hue comes from the look, not the photo. The report lists each source color beside its result.
- **Not supported yet:** extrusions, sweeps, tubes, blades, and implicit or visual-hull surfaces. The emitter fails and names each component; nothing is dropped silently.
- **The forge's two sizing traps** are kept, so the output matches the factory, and reported:
  - a `transform.scale` hides `dimensions`;
  - a radius with no height or length leaves the height at 1.

`bun run forge:test` runs the emitter's contract tests next to the forge's, including a run through the real socket with the plugin installed in a temporary home. `src/emit.test.ts` checks the output from the TypeScript side: it parses, builds and frees; parts land where the sculpt spec puts them; and the palette and shades agree with `@hedronite/lts-tokens`. `fixtures/your-desk-lamp.sculpt.json` is an in-house sample sculpt spec.

## Rules

- The tool is `img-to-object`. Nothing we ship is named or branded after the upstream project.
- Reference images are our own photos or CC0, recorded in `assets/LICENSES.md`, or a private reference that never enters the repo (a product photo, for example). The `dress-watch` reference is private.
- Never commit product photos from a manufacturer or retailer.
- Reconstructions are generic: no brand names, logos or dial text, even when the reference shows them. Sample names follow the "Your …" pattern.
- Upstream's visual gate stands: a reconstruction is accepted only on saved, read-back screenshots compared against the reference, not on structural tests alone.
- Upstream files stay Apache-2.0. Edit them only when needed; mark each edit as `SOURCE.md` says.
