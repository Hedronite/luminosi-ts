# @hedronite/lts-icons

Stroke icons on a 24-unit grid, generated from `assets/src/icons` (`bun run icons`). Tree-shakeable: one named export per icon.

```ts
import { arrowRight, iconToSvg } from "@hedronite/lts-icons";
const svg = iconToSvg(arrowRight, { title: "Next" }); // decorative without a title
```

```tsx
import { ArrowRight } from "@hedronite/lts-icons/react"; // React is an optional peer
<ArrowRight title="Next" size={20} />
```

## Icon packs

Other people's open-source icon sets, converted to data from `assets/vendor` by `bun run icons:packs`. Each pack is its own module, so you load only the ones you use:

| Pack | Icons | License | Credit |
|---|---|---|---|
| `lucide` | 1,808 | ISC | Lucide Icons and contributors |
| `famicons` | 1,342 | MIT | Family |
| `coreui` | 562 | CC BY 4.0 | CoreUI (coreui.io) |
| `stash-regular`, `stash-light`, `stash-solid`, `stash-duotone`, `stash-editor` | 1,231 | MIT | Pingback LLC |
| `isocons-rounded-left`, `-rounded-right`, `-rounded-top`, `isocons-sharp-left`, `-sharp-right`, `-sharp-top` | about 1,006 each | CC BY 4.0 | Isometric Icons by isocons.app (leyeConnect and meandchimso) |

```ts
import { arrowRight } from "@hedronite/lts-icons/packs/lucide";
import { PackIcon } from "@hedronite/lts-icons/react";
import { packIconToSvg } from "@hedronite/lts-icons";

<PackIcon icon={arrowRight} title="Next" />;
const svg = packIconToSvg(arrowRight);
```

A pack icon keeps its set's own grid and paint (filled, stroked or both, per path); every black in the source becomes `currentColor`. **Packs keep their sources' licenses**, not this package's MIT OR Apache-2.0: credit the authors when you ship one (CC BY 4.0 requires it). `iconPacks` (from `@hedronite/lts-icons/packs`) lists each pack's license, credit and source; the catalog's Icon packs view shows them beside the icons.

