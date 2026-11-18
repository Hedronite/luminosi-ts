# @hedronite/lts-registry

Every asset the LuminosiTS packages ship, registered in one place, with the search and the copy-ready snippets that go with it. The catalog, the `lumin` agent commands and the asset checks all read it from here.

```ts
import { loadRegistry, filterAssets, rankAssets, snippetsFor } from "@hedronite/lts-registry";

const registry = loadRegistry();                         // every package's manifest; throws if an id is used twice
rankAssets(registry.list(), "glass");                    // ranked matches for a query
filterAssets(registry.list(), { text: "arrow", kind: "icon" });
```

It is data only: it imports each package's manifest and root entry, never its `./three` entry, so it pulls no three.js into an app that lists assets. A test walks the package's static imports, across packages, to keep it that way.
