# Source pin

| | |
|---|---|
| Upstream | <https://github.com/img2threejs/img2threejs> |
| Release | 2.0.1, tag `v2.0.1` (tag object `05330796ff1f3deeaad80f4c1a052d2c8f2dd6db`) |
| Commit | `0c0c49bc168e648dbaf9c8c080474de0b3a941b6`, 2026-11-05 |
| License | Apache-2.0, Copyright 2026 hoainho ([`upstream/LICENSE`](upstream/LICENSE)) |
| Vendored | 2026-11-15 |

## What's in `upstream/`

The skill (`SKILL.md`, `grimoire/`, `skills/`), the forge (`forge/`, Python 3.10+, standard library only), its docs and specs (`docs/`), the repository's CI scripts (`scripts/`), and the optional vision adapter's project files (`integrations/vision/`, which `forge/tests` checks). The vision adapter's dependencies (SAM2, Depth Anything, MediaPipe, torch) are **not** installed; nothing here downloads models.

Removed, and why:

| Path | Why |
|---|---|
| `assets/` | Upstream's logo and sponsor marks. We don't carry another project's branding |
| `bin/`, `package.json` | The npm installer, which fetches upstream releases into agent hosts. Not needed in a vendored copy |
| `integrations/glb_character_pipeline/`, `integrations/mesh3d/` | Character rigging and mesh generation with their own toolchains. Out of scope for object reconstruction |
| `CLAUDE.md`, `.github/` | Upstream's own agent and CI setup. Its test command is below; its visual-gate rule is kept in [`README.md`](README.md) |

## Edited files

None yet. When the build stage is adapted to emit `ObjectSpec`, each edited file gets a header (`Modified by the LuminosiTS contributors: …`) and a row here.

## Updating

1. Clone the new tag, and record its tag object and commit here.
2. Copy it over `upstream/` with the same removals (`rsync -a --delete` with the excludes in the table).
3. Re-apply any edited files listed above.
4. Run `bun run forge:test` and the full `bun run check`.

## Tests

```bash
bun run forge:test   # python3 -m unittest discover -s forge/tests, inside upstream/
```

2.0.1 on Python 3.14 (apiary): 1416 tests, 64 skipped. The skipped ones need a TypeScript showcase checkout (`IMG2THREEJS_SHOWCASE_ROOT`) or optional tools.
