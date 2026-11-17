---
name: lumin
description: >
  Find and read LuminosiTS assets through the lumin CLI: search by name, id or tag; show one asset with its
  package and copy-ready snippets; list by kind, package or tag; package summaries; asset budgets; and which
  package may import which. Use before reading source to answer "what exists, where, and how do I use it".
  Read-only. Prefer it over grepping packages: one call, deterministic JSON.
---

# lumin

`lumin.nu` beside this file. Needs `nu` and `bun` on `PATH`, and one `bun run build` (it reads the built
manifests). Prints `{ ok, command, data }` or `{ ok: false, command, error, kind, exit }` and exits with `exit`.
An unknown id fails with `kind: "unknown_asset"` and `matches`, the closest ids.

```bash
nu lumin.nu search "crystal" [--kind object] [--limit 10]   # ranked: id, name, package, tags, score
nu lumin.nu show platonic-icosahedron                        # metadata + snippets (React, TypeScript, SVG …)
nu lumin.nu list [--kind icon] [--package @hedronite/lts-icons] [--tag geometry] [--limit 50] [--newest]
nu lumin.nu kinds                                            # counts per kind
nu lumin.nu packages                                         # exports, README summary, assets shipped
nu lumin.nu budgets                                          # pipeline output vs assets/budgets.json
nu lumin.nu boundaries [--package objects]                   # import rules from .dependency-cruiser.cjs
```

Kinds: `icon`, `primitive`, `object`, `scene`, `material`, `shader`, `effect`. Ids are unique across packages.
Use `show` for the import line before writing code against an asset; it is the same snippet the catalog shows.
