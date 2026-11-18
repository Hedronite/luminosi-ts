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

- [x] Core: asset registry, progressive loader interface, manifest schema, disposal helpers (the loader interface and the disposal scope were removed in #36)
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
- [x] More materials and shaders: 13 material presets (clearcoat, fabric sheen, frosted glass, iridescent thin film, anodized metal, rubber added) and 7 TSL effects (toon outline, refraction, dissolve, hologram added), with a side-by-side material lineup in the catalog
- [x] Documentation or expanded catalog docs
- [x] Dogfood on a real page or small prototype (any aesthetic)
- [x] Optional open-source under Hedronite organization

**Exit criteria:** Catalog feels like a complete progressive index. Library is pleasant to use in real projects across different visual styles.

---

## Stage 5 — Maturity & Expansion (Ongoing)

**Goal:** Sustainable growth driven by actual use.

The open lines of this stage are now concrete slices in Stages 6 to 12 below: budgets (A3, B5), adapters and targets (A2, C5, F3), procedural range (D4, D5, D9), and usage-driven packs (G2). Rust tools stay optional and unplanned.

### Adopt and remix open-source work

Vendored work (`assets/vendor`) becomes library parts, projects and skills, not only a showcase.

- [x] Provenance: an asset's `origin` names the vendored file it was ported from; the catalog credits it and lists it under its folder (#30)
- [x] `lumin study`: what each vendored module is, what it leans on, and what could be ported (#30)
- [x] `lumin adopt`: a planned port with its credit, license and porting steps, in a gitignored workspace (#30)
- [x] First ports: the CRT screen effect (ThreeUI) and the soap film shader (Codevember day 07) (#30)
- [x] `lumin adopt-skill`: a vendored agent skill into `.agents/skills` with its license and credit (none adopted yet: vendored skills are read as data until a person has reviewed one) (#30)
- [ ] Forking and new projects: superseded by E6 (scaffold from a scene document or a vendored demo) and E7 (modify through the scene document), which need Stage 8
- [ ] Study inline scripts in HTML demos (the Techartist demos are single HTML files)
- [ ] More ports from the study's candidates: ThreeUI's dot matrix, energy orb and liquid form; Codevember's depth of field and nacre

---

## Stages 6 to 12 — from asset library to design suite

The aim: the design system for 3D and screen effects that lives in the repo. One versioned, validated scene document that people edit in a studio and agents edit through `lumin`, compiled to plain three.js and React Three Fiber code with no proprietary runtime; looks that recolor interface, scene and inks together; a remix pipeline with a provenance trail; and gates that prove each artifact is fast, accessible and legally clean before it merges.

Each line is one PR. Order holds in one place: Stage 6, then 7, then 8; Stages 9 to 11 interleave once C1 and C2 exist. **Quick win** marks a small, low-risk slice. Decisions still open are noted where they gate a slice.

### Stage 6 (A) — True ground

- [x] A1 Data entries (quick win): package entries split into data and `./three` builders; no three.js on the gallery's first route (#34)
- [x] A2 Adapter split (quick win): adapters root without `three/webgpu`, a `./webgpu` subpath; smaller site island (#39)
- [x] A3 Budgets that bite (quick win): entry chunks, 3D chunks, site island, draw calls and triangles per object (#41)
- [x] A4 Motion and keys (quick win): reduced motion, a pause control, keyboard orbit, a steady hologram, the hook in adapters; a paused stage draws nothing on its own (#32, #37, #44)
- [x] A5 WebGPU lane: a script that runs the catalog's 3D stages on the WebGPU backend, on a machine with a GPU and not in CI; the catalog is served on a secure origin (tailnet HTTPS) (#55)
- [x] A6 Truth pass (quick win): README, STACK and skill docs match the code, with a test (#35)
- [x] A7 Vendor pins and quarantine (quick win): every vendored source pinned; vendored agent files excluded from discovery (the policy in #30, the settings in #35)
- [x] A8 CI split (quick win): cached parallel jobs, faster PRs (#38, #40)
- [x] A9 Loose ends (quick win): disposal of instanced meshes, icon package licenses, unused loader and scope (#36)
- [ ] A10 Vendor home: where the vendored tree lives (needs a decision)

### Stage 7 (B) — Live parameters

- [x] B1 Asset descriptors: one contract (metadata, parameter schema, lazy build, snippets, poster) replaces the per-id switches (#46, #49, #50, #52)
- [ ] B2 Uniform handles: parameter edits without recompiles; an injected clock
- [x] B3 One print pass: cheaper, editable screen effects; `setParams` and `setInks`; the smoke at half size; no frames off screen (#54)
- [ ] B4 Looks without rebuilds: a look change is a uniform write
- [x] B5 Merged objects (quick win): the dress watch in 8 draw calls (#42)
- [ ] B6 Posters: real thumbnails for every 3D asset
- [ ] B7 Golden images: appearance under test
- [ ] B8 Parameter panel: a schema-driven panel in the detail view

### Stage 8 (C) — The scene document

- [ ] C1 `lts-scene` schema: one versioned format for a composition, with migrations
- [ ] C2 Build and emit: document to pixels and to code (TSX, vanilla)
- [ ] C3 Playground on documents: open, save, share, undo, free transforms
- [ ] C4 `lumin scene`: validate, render, diff, patch, export for agents, and a stdio MCP server over the same operations
- [ ] C5 `<lts-scene>` element: poster first, lazy three, reduced-motion aware, no React needed
- [ ] C6 Credits travel with the scene: emitted code carries its attribution

### Stage 9 (D) — Fidelity

- [ ] D1 One renderer: every viewport on the WebGPU renderer (needs a decision)
- [ ] D2 Scene tokens v2: looks light the scene; no raw colors in packages (revisit an `accent-text` token here)
- [ ] D3 Stage quality: shadows, bloom, depth of field, tone mapping per look, with a lite tier
- [ ] D4 Procedural finishes: brushed, weave, grain, orange peel, frost, with no texture files
- [ ] D5 ObjectSpec v2: repeat, extrude, sweep, tube, text, per-part shader
- [ ] D6 Environments: more than one room; credited CC0 HDRIs optional
- [ ] D7 Motion tracks: animation as data, with a rest pose for reduced motion (needs a decision on scope)
- [ ] D8 Interface tokens and a design pass: type scale, spacing, elevation, easing; the interface quality tooling is in place (partial: `lumin-ui` #31, the catalog passing it #32)
- [ ] D9 Generators: isometric icons from the primitives; generated looks

### Stage 10 (E) — Adopt and remix, matured

- [ ] E1 Provenance record: commit, license id, transformations, reviewer (partial: the `origin` field, #30)
- [ ] E2 License gate: a policy table decides what can be adopted and what stays showcase-only
- [ ] E3 Equivalence rig: a port is scored against its source, side by side
- [ ] E4 Parameter lifting: ported literals become a reviewed schema bound to the palette
- [ ] E5 Adoption checklist as a command
- [ ] E6 Scaffold: start projects from a scene document or a vendored demo
- [ ] E7 Modify: change a scaffolded project through its scene document
- [x] E8 Skills: decided (#30, #31): vendored skills are data; their ideas are rewritten in-house (`lumin-ui`)
- [ ] E9 Upstream drift: compare pins with upstream on demand
- [ ] E10 Two-way catalog links: source to component and back, with what changed (partial: "In the library", #30)

### Stage 11 (F) — Studio and distribution

- [ ] F1 Release mechanics: changesets, API reports, packs split by license (needs a go-ahead to publish)
- [ ] F2 Public catalog on HTTPS with share links (needs a decision on hosting)
- [ ] F3 `lumin add`: copy a component's source, tests and credits into a project
- [ ] F4 Studio: the playground graduated to an app, over the scene document (needs a decision on which studio)
- [ ] F5 Token interchange: W3C design tokens and Figma variables in and out
- [ ] F6 Stills and video: deterministic frames from a scene

### Stage 12 (G) — Proof

- [ ] G1 hedronite.com's hero from a scene document
- [ ] G2 Three contrasting pages from scaffolds, each in a different look
- [ ] G3 Device and assistive pass on real phones and a screen reader
- [ ] G4 Cost comparison against a runtime-embed tool, with published numbers

### Follow-ups

Small slices left open by earlier waves, each its own PR.

- [ ] Descriptor presentation: optional `preview` and `thumbnail` fields on the asset descriptor, so the catalog's per-id presentation table and object shape table go away
- [ ] Root typecheck: `e2e/` and the config files are checked by the root typecheck
- [ ] CI shards balanced by run time, not by file count
- [ ] Icon packs as data: each pack is a data entry the catalog and `lumin` read, not code

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
