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
