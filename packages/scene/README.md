# @hedronite/lts-scene

One composition as one document: `lts-scene`, version 1. The root and `./emit` are pure data (zod and `@hedronite/lts-core`, no three.js, no React).

```ts
import { checkRefs, migrate, parseScene } from "@hedronite/lts-scene";
import { toCanonicalJson } from "@hedronite/lts-scene/emit";

const result = migrate(text); // any version, from text or a value: { ok: true, scene } or { ok: false, issues }
if (result.ok) {
  const problems = checkRefs(result.scene, (kind, id) => descriptors.get(id)); // ids and parameters, from your registry
  const out = toCanonicalJson(result.scene);
}
```

The shape, the migration from the playground's old JSON, the issue codes and the canonical text are in [STACK.md](../../STACK.md#scene-document).
