---
name: lumin-scene
description: >
  Check, compare, edit and export LuminosiTS scene documents (`lts-scene` JSON): validate a document with the
  path of every problem and the closest ids for an unknown one, diff two documents by node id, patch one with
  the package's edit operations, export it as React code, a vanilla module, canonical JSON or a share
  link, list the credits of the work it uses, and render it to a PNG. Use it instead of reading a scene file by eye or hand-editing its JSON. The primary agent path to a scene.
---

# lumin-scene

`lumin-scene.nu` beside this file. Needs `nu` and `bun`, and one `bun run build`. It prints the CLI's envelope exactly,
`{ ok, command, data }` or `{ ok: false, command, error, kind, exit }`, and exits with `exit`. A document is a path, or `-`
to read stdin; the cap is 256 KiB, and a larger one fails with `too_large`, it is never cut.

```bash
nu lumin-scene.nu validate scene.json                          # valid, version, migratedFrom, issues [{ path, code, message, matches? }]
nu lumin-scene.nu diff a.json b.json                           # same, complete, changes keyed by node id, ops, unexpressed
nu lumin-scene.nu patch scene.json --ops '[{"op":"setInk","ink":"accent"}]' [--out new.json] [--force]
nu lumin-scene.nu export scene.json --as tsx [--out Scene.tsx]    # tsx | vanilla | json | link
nu lumin-scene.nu credits scene.json                           # label, work, source, pin, license, credit
nu lumin-scene.nu render scene.json --out scene.png [--width 512 --height 512 --gpu]   # needs a build
cat scene.json | nu lumin-scene.nu validate -
```

## Reading the result

- `validate` exits 1 for an invalid document, with every issue and its JSON path. An unknown id lists `matches`, the closest ids.
  Bad JSON gives `kind: "invalid"` with a `line` and a `column`. An old document (the playground's, version 0) is migrated: `migratedFrom: 0`.
- `diff` never counts the order of the node list as a change. `ops` is a list for `patch`. **Check `complete`:** when it is
  `false`, the seed or the camera changed, the edit operations have no word for that, `ops` does not reproduce the second
  document, and `unexpressed` lists the paths left out.
- `patch` applies `ops` in order and all or nothing: a failing step gives `kind: "invalid"` with its `index` and `issues`, and no document.
  The input file is never modified. The result is in `data.document`, or in `--out` (a new path; `--force` replaces one).
- Edits: `addNode {node}`, `removeNode {id}`, `setTransform {id, change}`, `setSurface {id, surface?}`, `setEffects {effects}`,
  `setInk {ink}`, `setLights {change}`, `setLook {look}`. `removeNode` takes the node's children too.
- `export --as link` over 16 KiB gives `too_large`; export as `json` then.
