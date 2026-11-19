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

Edit a document, undo and redo, and share it as a link (all pure, all in the root):

```ts
import { createHistory, decodeScene, encodeScene, push, setInk, undo } from "@hedronite/lts-scene";

const edited = setInk(scene, "glass"); // a new document, or { ok: false, issues }; the input is never written to
if (edited.ok) {
  const history = push(createHistory(scene), edited.scene); // undo(history).present is `scene` again
  const link = await encodeScene(edited.scene); // "s1." and base64url of deflated canonical JSON
  const opened = await decodeScene(link); // the same result as parseScene; never throws
}
```

The shape, the migration from the playground's old JSON, the issue codes, the canonical text, the edits, the history and the link format are in [STACK.md](../../STACK.md#scene-document).
