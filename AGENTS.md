# Agent standing orders (LuminosiTS)

LuminosiTS is a progressive, modular TypeScript visual library: icons, Three.js primitives, objects, scenes, materials and shaders, with a catalog app as its living index. Read [`README.md`](README.md) (the manifesto) and [`ROADMAP.md`](ROADMAP.md) before changing anything.

## State

Stage 0 (scaffold). Every package boundary exists. Only `core` has code: the asset registry with Zod metadata. The catalog shows an empty gallery. Do not document, run or claim a command that is not listed below.

## Commands

```bash
nix develop            # or direnv: Bun and Node from the flake
bun install            # CI uses --frozen-lockfile
bun run typecheck      # tsc --noEmit in every package, through Turborepo
bun run build          # tsc for packages, vite build for the catalog
bun run test           # Vitest
bun run dev            # the catalog at http://localhost:5173
```

TypeScript is pinned to 6.0.x: `typescript-eslint` and `@astrojs/check` do not accept 7 yet. Shared versions live in the `workspaces.catalog` block of the root `package.json`; packages refer to them as `catalog:`.

## Package boundaries

From the manifesto:

- No circular dependencies.
- `core` is the only shared foundation.
- Adapters are optional; raw packages work without them.
- Pure TypeScript in `core`, `primitives`, `objects`, `scenes`, `materials` and `shaders`: no React, no JSX.
- React and React Three Fiber only in `icons/react`, `adapters` and the apps, as optional peers.
- Import other packages through their published `exports`, never their `src/` or `dist/`.

## Generality

Assets are style-agnostic building blocks. A specific look belongs in a preset or pack, never in a primitive. Keep names, comments and examples neutral, so no aesthetic is assumed.

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
- Procedural generators are pure and seeded: `(params, seed) → data`. No `Math.random()`.

## Tests

- Write the oracle from the contract before the code. Never write tests by reading the implementation.
- Never split a function only to lower a complexity score.
- Tests are deterministic: fake timers, no live network, seeded randomness.

## Git

- Work on a branch and open a draft PR. Never push `main`, force-push, tag, or publish a package.
- Fixes are new commits on the PR branch.
- No secrets, `.env` files, local paths or internal notes in the repo.
