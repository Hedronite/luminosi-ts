# @hedronite/lts-tokens

Design tokens. A preset is a look: interface colors for light and dark schemes, plus the scene colors materials use. `neutral` is the default; `hedronite` is an optional pack. Every text pair is tested for WCAG contrast.

```css
@import "tailwindcss";
@import "@hedronite/lts-tokens/theme.css"; /* bg-surface, text-fg, border-line, bg-accent, … */
```

```ts
import { hedronite, contrastRatio } from "@hedronite/lts-tokens";
document.documentElement.dataset.preset = hedronite.id; // switch the look
```
