# Credits

LuminosiTS is MIT OR Apache-2.0. It also carries open-source work by others, each under its own license. This file says what, from where, and under which terms. When you add third-party material, add it here, keep its license beside it, and credit its authors. Open-source assets are welcome as long as they're credited (Evan, 2026-11-15); `assets/vendor/` holds the larger sets.

| What | Where in this repo | Source | License | Credit |
|---|---|---|---|---|
| The image-to-Three.js forge (skill, Python forge, docs) | `tools/img-to-object/upstream/` | [img2threejs/img2threejs](https://github.com/img2threejs/img2threejs) 2.0.1, `0c0c49bc168e` | Apache-2.0 (`upstream/LICENSE`; modifications in `tools/img-to-object/NOTICE`) | Copyright 2026 hoainho |
| Omarchy theme palettes (`colors.toml`, 24 themes) | `assets/src/looks/omarchy/` | [basecamp/omarchy](https://github.com/basecamp/omarchy) `d76f364b` (Osaka Jade recovered from its history) | MIT (`assets/src/looks/omarchy/LICENSE`) | Copyright David Heinemeier Hansson |
| Ported color schemes inside those themes | `assets/src/looks/omarchy/looks.json` (`credit`) | Catppuccin, Everforest, Flexoki, Gruvbox, Kanagawa, Nord, Rosé Pine, Tokyo Night | MIT, each upstream | Catppuccin; sainnhe; Steph Ango; Pavel Pertsev (morhetz); rebelot; Arctic Ice Studio and Sven Greb; Rosé Pine; enkia |
| Hedron and Hedron Light palettes | `assets/src/looks/virtualmachinist/` | [VirtualMachinist/Omahedron](https://github.com/VirtualMachinist/Omahedron) `20c5dc40` | First-party | VirtualMachinist |
| Isometric Icons: isometric SVG icons, six edge variants each, with `catalog.json` | `assets/vendor/isocons/` | https://www.isocons.app/ (v2.1) | CC BY 4.0 (`LICENSE`) | Isometric Icons by isocons.app (leyeConnect and meandchimso) |
| Lucide icons (1,808 SVGs) | `assets/vendor/lucide/` | https://github.com/lucide-icons/lucide | ISC (`LICENSE`) | Lucide Icons and contributors |
| CoreUI Icons Free (562 SVGs) | `assets/vendor/coreui-icons/` | https://github.com/coreui/coreui-icons | Icons CC BY 4.0; fonts SIL OFL 1.1; code MIT (`LICENSE`) | CoreUI (coreui.io) |
| Famicons (1,342 SVGs) | `assets/vendor/famicons/` | https://github.com/familyjs/famicons | MIT (`LICENSE`) | Family |
| Stash icons (five styles, as TSX with inline SVG) | `assets/vendor/stash-icons/` | https://github.com/stash-ui/icons | MIT (`LICENSE`) | Pingback LLC |
| ThreeUI Community: the open-source edition of the ThreeUI component catalog (app, components, shaders, scene assets) | `assets/vendor/threeui/` | https://github.com/MengTo/threeui | MIT (`LICENSE`); fonts SIL OFL 1.1 (`FONT-LICENSES.md`); see `ASSET-LICENSES.md` and `THIRD_PARTY_NOTICES.md` | Meng To / ThreeUI |
| Three Three.js demos: geometry-in-flux, bioluminescence, threejs-3d-webpage | `assets/vendor/techartist/` | https://iamtechartist.github.io/ | MIT (a `LICENSE` beside each demo) | Techartist |
| Codevember 2026: one three.js / React Three Fiber experiment per day, with source, notes and recordings | `assets/vendor/codevember-2026/` | https://github.com/ttillberg/codevember-2026 (`4df8e67a`) | MIT (`LICENSE`); day 06 uses a public-domain painting (Joseph Wright of Derby, 1766) | Theo Tillberg |
| ThreeRT: hardware ray-traced three.js (Rust + wgpu engine, TypeScript packages, showcase, docs) | `assets/vendor/threert/` | https://github.com/meshy-dev/ThreeRT (`8cb4e9b1`) | MIT (`LICENSE`); patched dependencies in `renderer/third_party/` and `tools/city` keep their own (MIT / Apache-2.0); Poly Haven models CC0 | Meshy LLC |
| The landing-page-design agent skill | `assets/vendor/ai-design-skills/` | https://github.com/elayadesign/ai-design-skills (`456d9e0d`) | MIT (`LICENSE`) | Elaya |
| Interface agent skills (better-ui, better-typography, better-colors, interface-review and more) | `assets/vendor/jakubkrehel-skills/` | https://github.com/jakubkrehel/skills | MIT (`LICENSE`) | Jakub Krehel (jakub.kr, interfaces.dev) |
| Agent skills for motion and scroll, material finishes, lighting, sky and water, and two AI-design audits — reference data, distilled into `lumin-motion` and `lumin-ui`, with a port ledger for the rest | `assets/vendor/mengto-skills/` | https://github.com/MengTo/Skills (`a7f25b25`) | MIT (`LICENSE`) | Meng To — inspired by |
| The Gemini frontend design skill — reference data, distilled into `lumin-ui` | `assets/vendor/gemini-demolab/` | https://github.com/google-gemini/demolab (`cd0c1f85`) | Apache-2.0 (`LICENSE`) | Google (Google Gemini) — inspired by |
| Icon packs generated from the icon sets above (Lucide, Famicons, CoreUI, Stash, isocons) | `packages/icons/src/packs/` | `assets/vendor/` via `tools/icons` | Each pack keeps its source's license (ISC, MIT, CC BY 4.0); see `iconPacks` | As for each source above |

Ported from the vendored work above into the library, each with its `origin` in its manifest and a credit header above its code:

| What | Where in this repo | Ported from | License | Credit |
|---|---|---|---|---|
| CRT screen effect (`crt`) | `packages/postfx/src/nodes.ts` (`crtNode`) | `assets/vendor/threeui/src/shaders/crt/crtShaders.ts` | MIT (`assets/vendor/threeui/LICENSE`) | Meng To / ThreeUI |
| Soap film surface shader (`soap-film`) | `packages/shaders/src/effects.ts` (`createSoapFilmMaterial`) | `assets/vendor/codevember-2026/07/src/Balloon.tsx` | MIT (`assets/vendor/codevember-2026/LICENSE`) | Theo Tillberg |

The looks converted from these palettes (`packages/tokens/src/generated/looks.ts`) carry each scheme's credit in their `credit` field.
