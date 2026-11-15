# Credits

LuminosiTS is MIT OR Apache-2.0. It also carries open-source work by others, each under its own license. This file says what, from where, and under which terms. When you add third-party material, add it here, keep its license beside it, and credit its authors.

| What | Where in this repo | Source | License | Credit |
|---|---|---|---|---|
| The image-to-Three.js forge (skill, Python forge, docs) | `tools/img-to-object/upstream/` | [img2threejs/img2threejs](https://github.com/img2threejs/img2threejs) 2.0.1, `0c0c49bc168e` | Apache-2.0 (`upstream/LICENSE`; modifications in `tools/img-to-object/NOTICE`) | Copyright 2026 hoainho |
| Omarchy theme palettes (`colors.toml`, 24 themes) | `assets/src/looks/omarchy/` | [basecamp/omarchy](https://github.com/basecamp/omarchy) `d76f364b` (Osaka Jade recovered from its history) | MIT (`assets/src/looks/omarchy/LICENSE`) | Copyright David Heinemeier Hansson |
| Ported color schemes inside those themes | `assets/src/looks/omarchy/looks.json` (`credit`) | Catppuccin, Everforest, Flexoki, Gruvbox, Kanagawa, Nord, Rosé Pine, Tokyo Night | MIT, each upstream | Catppuccin; sainnhe; Steph Ango; Pavel Pertsev (morhetz); rebelot; Arctic Ice Studio and Sven Greb; Rosé Pine; enkia |
| Hedron and Hedron Light palettes | `assets/src/looks/virtualmachinist/` | [VirtualMachinist/Omahedron](https://github.com/VirtualMachinist/Omahedron) `20c5dc40` | First-party | VirtualMachinist |

The looks converted from these palettes (`packages/tokens/src/generated/looks.ts`) carry each scheme's credit in their `credit` field.
