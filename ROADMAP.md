# LuminosiTS (LTS) — Growth Roadmap

Companion to the LuminosiTS manifesto. This document tracks progressive stages from initial scaffold to a mature, general-purpose visual arsenal usable for any client aesthetic.

**Name:** LuminosiTS (short: LTS)  
**Repo shape:** Bun monorepo + Turborepo, Nix flake, root `AGENTS.md`  
**Philosophy:** Progressive, modular, pure TypeScript core, complementary TSX, optimization-first, style-agnostic building blocks.

---

## Stage 0 — Scaffold & Foundations (Week 0–1)

**Goal:** Runnable monorepo with empty but correctly bounded packages, minimal catalog shell, and agent guidance.

- [x] Initialize Bun workspace + Turborepo + root `tsconfig.base.json`
- [x] Create Nix flake (Bun, Node, TypeScript; optional Rust/Go)
- [x] Scaffold all packages with correct `package.json` exports, peer deps, and pure-TS vs TSX boundaries
- [x] Add root `AGENTS.md`
- [x] Minimal `core` registry + Zod metadata types
- [x] Bare Vite + React catalog app that imports the core package
- [x] Basic CI (typecheck + build via Turbo)
- [x] README + manifesto linked

**Exit criteria:** `bun install && bun run build` succeeds. Catalog boots and shows an empty gallery. `AGENTS.md` is present and accurate.

---

## Stage 1 — Core + Icons + Catalog v1 (Week 1–3)

**Goal:** Usable icon system and a living visual index.

- [x] Core: asset registry, progressive loader interface, manifest schema, disposal helpers
- [x] Icons package: first flexible set of SVGs (UI, geometric, common symbols)
  - Pure TS data export
  - Optional React components (`./react`)
  - Categories and tags
- [x] Catalog gallery + detail view for icons
  - Search, filters, copy-as-component / copy-as-SVG
- [x] First 20–40 icons covering common needs

**Exit criteria:** Can import and use icons in a real project. Catalog is the primary way to browse them.

---

## Stage 2 — Primitives & Materials (Week 3–6)

**Goal:** High-quality geometric primitives and material presets usable in Three.js.

- [x] Primitives package: platonic solids and useful geometric forms
  - Properly scaled, centered, typed
  - Low-to-medium poly with clear budgets
- [x] Materials package: first set of PBR presets (neutral, metallic, glass, matte, etc.)
- [x] Basic lights and environment helpers
- [x] Catalog 3D preview viewport (R3F) for primitives and materials
- [x] Code snippets in detail view

**Exit criteria:** Drop a primitive + material into a vanilla Three.js or R3F scene with one import.

---

## Stage 3 — Objects, Shaders & Adapters (Week 6–10)

**Goal:** Composable objects, custom shaders, and first-class R3F support.

- [x] Objects package: typed GLTF/GLB wrappers, first procedural generators
- [x] Shaders package: reusable effects (refraction, glow, outline, etc.)
- [x] Adapters package: R3F components for primitives, objects, materials
  - React as optional peer
- [x] Catalog: scene playground (compose multiple items, lighting controls)
- [x] Optimization pipeline notes (Draco/Meshopt, texture formats) — tooling can start in `tools/`

**Exit criteria:** Full path from import to interactive scene works in both vanilla and R3F. Catalog playground is usable.

---

## Stage 4 — Scenes, Growth Tools & Polish (Week 10–16)

**Goal:** Prebuilt scene kits, better generation/optimization, and demonstration of range.

- [x] Scenes package: several environment kits covering different moods or use cases
- [x] Growth timeline and “recently added” views in catalog
- [x] Tools: first CLI or script for asset validation / optimization (can bridge to Rust)
- [x] Expanded icon set: 14 icon packs from open-source sets (Lucide, Famicons, CoreUI, Stash, isocons), 11,978 icons, credited
- [ ] More materials and shaders
- [x] Documentation or expanded catalog docs
- [x] Dogfood on a real page or small prototype (any aesthetic)
- [x] Optional open-source under Hedronite organization

**Exit criteria:** Catalog feels like a complete progressive index. Library is pleasant to use in real projects across different visual styles.

---

## Stage 5 — Maturity & Expansion (Ongoing)

**Goal:** Sustainable growth driven by actual use.

- [ ] Procedural generation improvements
- [ ] Additional adapters or targets if needed
- [ ] Companion Rust tools for heavy mesh processing or generation
- [ ] Performance budgets and automated checks
- [ ] Client or project usage patterns inform new packs and presets
- [ ] Optional integration points with other tooling (non-blocking)

---

## Cross-Cutting Concerns

- **Testing:** Typecheck + basic unit tests for registry and loaders. Visual regression optional later.
- **Versioning:** Changesets or similar for monorepo packages.
- **Performance:** Track poly counts, texture sizes, and load times in catalog metadata.
- **Generality:** Assets remain style-agnostic building blocks. Specific looks live in packs or presets.
- **Documentation:** Manifesto remains the conceptual source of truth. `AGENTS.md`, roadmap, and package READMEs stay in sync.
- **Agent context:** Keep language and examples neutral so agents are not steered toward a single aesthetic.

---

## Success Markers

- Can start a new web or game project for any client and pull exactly the visual pieces needed without boilerplate or style lock-in.
- Catalog is the first place you look to see what exists and to demonstrate range.
- The project remains modular, progressive, and pleasant for both human and agent contributors.

This roadmap is sequential but not rigid. Stages can overlap once foundations are solid. The catalog is the continuous integration point for every stage.
