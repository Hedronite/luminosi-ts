# Agent standing orders (LuminosiTS)

LuminosiTS is a progressive, modular TypeScript visual library: icons, Three.js primitives, objects, scenes, materials and shaders, with a catalog app as its living index. Read [`README.md`](README.md) (the manifesto), [`ROADMAP.md`](ROADMAP.md) and [`STACK.md`](STACK.md) (how the languages and tools fit together) before changing anything.

## State

Stages 0–4 of [`ROADMAP.md`](ROADMAP.md) are built: core, tokens, icons, primitives, materials, objects, shaders, scenes and adapters; the catalog (`apps/catalog`, with a playground and a growth view); an Astro page that dogfoods the library (`apps/site`); and the asset pipeline and validator (`tools/`). Do not document, run or claim a command that is not listed below.

## Commands

```bash
nix develop            # or direnv: Bun and Node from the flake
bun install            # CI uses --frozen-lockfile
bun run typecheck      # tsc --noEmit in every package, through Turborepo
bun run build          # tsc for packages, vite build for the catalog
bun run test           # Vitest
bun run icons          # regenerate packages/icons from assets/src/icons (icons:check verifies)
bun run validate       # every package manifest loaded together: unique ids, dates, glTF sources and budgets
bun run lint           # ESLint, type-aware, with the rules below
bun run boundaries     # dependency-cruiser: the package boundaries below
bun run knip           # unused files, exports and dependencies
bun run e2e            # Playwright smoke + axe on the built catalog (after build)
bun run forge:test     # the vendored img-to-object forge's own tests (Python 3.10+, standard library only)
bun run check          # all of the above, in CI order
bun run dev            # the catalog at http://localhost:5173
bun run --filter site dev   # the Astro page
docker compose up -d --build   # catalog on :4180, site on :4181, served by Caddy (deploy/Caddyfile)
bun run e2e:container  # the same e2e suite against the running container
```

The container builds from source and serves static files only (no Node or Bun at runtime). It runs as an unprivileged user with a read-only root and no capabilities. The catalog's CSP is a header in `deploy/Caddyfile`; the site's comes from Astro (`security.csp` in `apps/site/astro.config.mjs`), which hashes its inline island scripts. Never add `'unsafe-inline'` to `script-src`. Images are local; nothing is pushed to a registry.

`bun run check` is the definition of done until Web-TOPS can gate this repo.

`.astro` files are type-checked by `astro check` (`site:typecheck`). ESLint does not lint them yet; `eslint-plugin-astro` 1.7 is the line that supports ESLint 9.

The asset pipeline (`tools/assets`) runs as part of `bun run build`: it turns `assets/src/models/*.json` into meshopt-compressed `.glb` files and fails the build when an asset exceeds `assets/budgets.json`. Source art is data; the repo holds no binary models.

TypeScript is pinned to 6.0.x: `typescript-eslint` and `@astrojs/check` do not accept 7 yet. Shared versions live in the `workspaces.catalog` block of the root `package.json`; packages refer to them as `catalog:`.

## Skills: lumin

Three agent skills in `.agents/skills` (copied to `.claude`, `.cursor` and `.grok` by `bun run skills:sync`; a test fails if the copies drift). Each is a short `SKILL.md` and a Nushell wrapper over `tools/lumin`, which prints one JSON envelope, `{ ok, command, data }` or `{ ok: false, error, kind, exit }`.

- `lumin`: find and read. Search, show (with snippets), list, kinds, packages, budgets, boundaries. Read-only.
- `lumin-check`: the gate, one summary per step.
- `lumin-new`: add a source icon. Writes files; only when a human asked; dry-run first.

Use `nu .agents/skills/lumin/lumin.nu show <id>` before grepping packages. Without Nushell, `bun run lumin <command>` prints the same envelope.

## img-to-object

`tools/img-to-object` turns a reference image into an `object` asset. `upstream/` is a vendored Apache-2.0 forge, pinned in `SOURCE.md`; edit it only when needed, and mark each edit as `SOURCE.md` says. Its output is an `ObjectSpec` (`@hedronite/lts-objects`: `parseObjectSpec`, `createObjectFromSpec`), pure data with colors from the token palette. The forge produces one through `tools/img-to-object/plugin`, the `lts-object-spec` emission target (`--target lts-object-spec`); `bun run forge:test` covers the forge and the emitter. Reference images are our own or CC0; reconstructions carry no brand names, logos or text. Read `tools/img-to-object/README.md` before using it.

## Package boundaries

From the manifesto, enforced by `.dependency-cruiser.cjs`:

- No circular dependencies.
- `core` (and `tokens`, the design tokens) are the only shared foundation.
- `objects` may build on `primitives` and `materials`; `scenes` may compose `primitives`, `materials` and `shaders`. Other libraries import only `core` and `tokens`.
- Adapters are optional; raw packages work without them.
- Pure TypeScript in `core`, `tokens`, `primitives`, `objects`, `scenes`, `materials` and `shaders`: no React, no JSX.
- React and React Three Fiber only in `icons/react`, `adapters` and the apps, as optional peers.
- Import other packages through their published `exports`, never their `src/` or `dist/`.

## Generality

Assets are style-agnostic building blocks. A specific look belongs in a preset or pack, never in a primitive. Keep names, comments and examples neutral, so no aesthetic is assumed.

Colors come from `@hedronite/lts-tokens`. A preset (`neutral` is the default; `hedronite` is an optional pack) supplies interface colors for light and dark schemes and the scene colors materials use. Use the semantic Tailwind utilities (`bg-surface`, `text-fg`, `text-fg-muted`, `border-line`, `bg-accent`, `text-on-accent`), never raw colors. Every text pair in every preset is tested for WCAG contrast.

## TypeScript

These follow the Web-TOPS protocol ([Hedronite/web-tops](https://github.com/Hedronite/web-tops)), which will gate this repo once its tooling exists:

- Never use `any`, `as` (other than `as const`) or `!`. Take `unknown` and narrow it, or parse it with Zod.
- Only erasable syntax: no `enum`, `namespace` or parameter properties.
- Guard indexed access (`arr[0]`, `record[key]`) for `undefined`, with `=== undefined`.
- Validate external data where it enters (manifests, fetched JSON, env) with Zod.
- Type-only imports use `import type`.
- No floating promises. Bound concurrency.
- Caught values are `unknown`; rethrow with `{ cause }`.
- Every lint or type suppression names its rule and a reason. No `@ts-ignore`.

## Three.js

- Dispose what you create: geometries, materials, textures, render targets.
- No allocation (`new`, `.clone()`, array literals) inside the frame loop, and no `setState` in `useFrame`.
- Color textures use `SRGBColorSpace`; data textures (normal, roughness, metalness, AO) stay linear.
- Self-host decoders (Draco, Meshopt, KTX2) at the same version as `three`; never load them from a CDN.
- Clamp the pixel ratio (`Math.min(devicePixelRatio, 2)`) and render on demand when nothing animates.
- Procedural generators are pure and seeded: `(params, seed) → data`. No `Math.random()`; use `createRandom` from `core`.
- Shaders are TSL (`@hedronite/lts-shaders`) and need three's `WebGPURenderer`, which falls back to WebGL 2. Validate shader parameters with Zod where they enter.

## Tests

- Write the oracle from the contract before the code. Never write tests by reading the implementation.
- Never split a function only to lower a complexity score.
- Tests are deterministic: fake timers, no live network, seeded randomness.

## Git

- Work on a branch and open a draft PR. Never push `main`, force-push, tag, or publish a package.
- Fixes are new commits on the PR branch.
- No secrets, `.env` files, local paths or internal notes in the repo.
