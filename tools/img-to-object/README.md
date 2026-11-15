# img-to-object

Turns a reference image of an object into a LuminosiTS `object` asset. It's built on a vendored copy of an Apache-2.0 image-to-Three.js forge (see [`SOURCE.md`](SOURCE.md) and [`NOTICE`](NOTICE)).

## State

- **Vendored and tested:** the upstream skill and forge live in [`upstream/`](upstream/), pinned to 2.0.1. `bun run forge:test` runs the forge's own test suite in CI.
- **First reconstruction:** `dress-watch` (`dressWatchSpec` in `@hedronite/lts-objects`), a generic dress watch read off a reference photo and written as an `ObjectSpec` generator. The forge didn't drive it yet; it was reviewed by rendering it beside the reference (front and three-quarter views, both looks) until the shapes matched.
- **Next:** the forge's build stage emits an `ObjectSpec` (pure data, validated by `@hedronite/lts-objects`) instead of a `THREE.Group` factory; the review loop runs on the catalog's Playwright setup; `lumin-new object --from-image` drives it with a dry run first.

## Rules

- The tool is `img-to-object`. Nothing we ship is named or branded after the upstream project.
- Reference images are our own photos or CC0, recorded in `assets/LICENSES.md`, or a private reference that never enters the repo (a product photo, for example). The `dress-watch` reference is private.
- Never commit product photos from a manufacturer or retailer.
- Reconstructions are generic: no brand names, logos or dial text, even when the reference shows them. Sample names follow the "Your …" pattern.
- Upstream's visual gate stands: a reconstruction is accepted only on saved, read-back screenshots compared against the reference, not on structural tests alone.
- Upstream files stay Apache-2.0. Edit them only when needed; mark each edit as `SOURCE.md` says.
