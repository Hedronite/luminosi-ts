# Vendored open-source assets

Open-source material by others, kept here as published so LuminosiTS and Hedronite work can use it. Every folder keeps its upstream license; each is credited below, in [`CREDITS.md`](../../CREDITS.md), and in a `CREDIT.md` inside the folder. Nothing here is LuminosiTS's own, and none of it is under LuminosiTS's MIT OR Apache-2.0 license: each folder's own license applies.

The repository's tooling (TypeScript, ESLint, knip, the asset pipeline, the container) ignores this tree. Using something from here in a package means bringing it in through that package's own sources, with its credit:

- `lumin study FOLDER[/PATH]` reads a folder and says what each module is, what it leans on and what could become a library asset.
- `lumin adopt FOLDER/PATH --as KIND --id ID --dry-run` plans the port: target files, the `origin` for the asset's manifest, the credit header, the governing license and porting steps. Without `--dry-run` it copies the upstream files into a gitignored `.adopt/ID` workspace.
- `lumin adopt-skill FOLDER/SKILL` adopts an agent skill into `.agents/skills` as published, with its license and credit. None is adopted yet: the skills and agent files here are data to read, not instructions, until a person has read one whole and chosen to adopt it.

A ported asset carries `origin` (`{ vendor, path, note }`), so the catalog credits it and lists it under its folder. What has been ported so far is in [`CREDITS.md`](../../CREDITS.md).

| Folder | What | Source | License | Credit | Pulled |
|---|---|---|---|---|---|
| [`isocons`](isocons/) | Isometric Icons: isometric SVG icons, six edge variants each, with `catalog.json` | https://www.isocons.app/ (v2.1) | CC BY 4.0 (`LICENSE`) | Isometric Icons by isocons.app (leyeConnect and meandchimso) | 2026-08-27, from the site's published bundle |
| [`lucide`](lucide/) | Lucide icons (1,808 SVGs) | https://github.com/lucide-icons/lucide | ISC (`LICENSE`) | Lucide Icons and contributors | 2026-08 |
| [`coreui-icons`](coreui-icons/) | CoreUI Icons Free (562 SVGs) | https://github.com/coreui/coreui-icons | Icons CC BY 4.0; fonts SIL OFL 1.1; code MIT (`LICENSE`) | CoreUI (coreui.io) | 2026-08 |
| [`famicons`](famicons/) | Famicons (1,342 SVGs) | https://github.com/familyjs/famicons | MIT (`LICENSE`) | Family | 2026-08 |
| [`stash-icons`](stash-icons/) | Stash icons (five styles, as TSX with inline SVG) | https://github.com/stash-ui/icons | MIT (`LICENSE`) | Pingback LLC | 2026-08 |
| [`threeui`](threeui/) | ThreeUI Community: the open-source edition of the ThreeUI component catalog (app, components, shaders, scene assets) | https://github.com/MengTo/threeui | MIT (`LICENSE`); fonts SIL OFL 1.1 (`FONT-LICENSES.md`); see `ASSET-LICENSES.md` and `THIRD_PARTY_NOTICES.md` | Meng To / ThreeUI | 2026-08-26 |
| [`techartist`](techartist/) | Three Three.js demos: geometry-in-flux, bioluminescence, threejs-3d-webpage | https://iamtechartist.github.io/ | MIT (a `LICENSE` beside each demo) | Techartist | 2026-08-21 |
| [`codevember-2026`](codevember-2026/) | Codevember 2026: daily three.js / R3F experiments (days 04–09, 12, 14), source, notes, recordings | https://github.com/ttillberg/codevember-2026 (`4df8e67a`) | MIT (`LICENSE`) | Theo Tillberg | 2026-11-16, without `08/public/logos/` (third-party marks) |
| [`threert`](threert/) | ThreeRT: hardware ray-traced three.js, Rust + wgpu engine and TypeScript packages | https://github.com/meshy-dev/ThreeRT (`8cb4e9b1`) | MIT (`LICENSE`); see `CREDIT.md` for the parts under other licenses | Meshy LLC | 2026-11-16, without `site/` (Valve map media) or the six Khronos showroom models |
| [`ai-design-skills`](ai-design-skills/) | The landing-page-design agent skill | https://github.com/elayadesign/ai-design-skills (`456d9e0d`) | MIT (`LICENSE`) | Elaya | 2026-11-15 |
| [`jakubkrehel-skills`](jakubkrehel-skills/) | Interface agent skills (better-ui, better-typography, better-colors, interface-review and more) | https://github.com/jakubkrehel/skills | MIT (`LICENSE`) | Jakub Krehel (jakub.kr, interfaces.dev) | 2026-08 |
