# @hedronite/lts-core

The shared foundation: the asset registry, manifests, asset descriptors and seeded randomness. Pure TypeScript, no three.js.

```ts
import { createRegistry, registerManifest, createRandom } from "@hedronite/lts-core";

const registry = createRegistry();
registerManifest(registry, manifest);               // all or nothing; ids are unique
const random = createRandom(42);                     // same seed, same sequence
```

## Kinds

An asset's `kind` is a registered kind. The seven LuminosiTS ships (`icon`, `primitive`, `object`, `scene`, `material`, `shader`, `effect`) are registered already. A package adds one by declaring its id, so it type-checks everywhere a kind is taken, and registering it:

```ts
declare module "@hedronite/lts-core" {
  interface AssetKindMap { sound: true }
}
registerKind("sound");
```

## Descriptors

An `AssetDescriptor` describes one asset to a program that does not know which asset it is: its manifest entry (`meta`), a Zod `parameters` schema with the hints a panel needs (`fields`: label, group, min, max, step), `defaults`, a lazy `build(params, palette, options)`, usage-code `templates` and `snippets(params)` that fill them in, and an optional `poster` path.

Each asset package exports its descriptors from `@hedronite/lts-<package>/descriptors`. A descriptor module imports no three.js: `build` loads the package's `./three` entry when it is called, so listing descriptors costs data, not a renderer.

```ts
import { descriptors } from "@hedronite/lts-objects/descriptors";

const watch = descriptors.find((d) => d.meta.id === "dress-watch");
watch.fields;                                        // hours, minutes, seconds, with labels, bounds and steps
watch.snippets({ hours: 3 });                        // usage code with the parameters filled in
const object = await watch.build({ hours: 3 }, palette); // loads three.js here, and only here
```

`defineDescriptor` checks a descriptor's parts against each other (metadata, hints, defaults, templates) and freezes it. `compareDescriptors(manifest, descriptors)` reports a manifest asset with no descriptor, a descriptor with no asset, a duplicate, or metadata that differs; every package's tests require it to find none.
