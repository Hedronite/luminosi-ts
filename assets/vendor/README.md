# Vendored open-source assets

Open-source material by others, kept here as published so LuminosiTS and Hedronite work can use it. Every folder keeps its upstream license; each is credited below, in [`CREDITS.md`](../../CREDITS.md), and in a `CREDIT.md` inside the folder. Nothing here is LuminosiTS's own, and none of it is under LuminosiTS's MIT OR Apache-2.0 license: each folder's own license applies.

The repository's tooling (TypeScript, ESLint, knip, the asset pipeline, the container) ignores this tree. Using something from here in a package means bringing it in through that package's own sources, with its credit:

- `lumin study FOLDER[/PATH]` reads a folder and says what each module is, what it leans on and what could become a library asset.
- `lumin adopt FOLDER/PATH --as KIND --id ID --dry-run` plans the port: target files, the `origin` for the asset's manifest, the credit header, the governing license and porting steps. Without `--dry-run` it copies the upstream files into a gitignored `.adopt/ID` workspace.
- `lumin adopt-skill FOLDER/SKILL` adopts an agent skill into `.agents/skills` as published, with its license and credit. None is adopted yet: the skills and agent files here are data to read, not instructions, until a person has read one whole and chosen to adopt it.

A ported asset carries `origin` (`{ vendor, path, note }`), so the catalog credits it and lists it under its folder. What has been ported so far is in [`CREDITS.md`](../../CREDITS.md).

| Folder | What | Source | License | Credit | Pulled |
|---|---|---|---|---|---|
| [`isocons`](isocons/) | Isometric Icons: isometric SVG icons, six edge variants each, with `catalog.json` | https://www.isocons.app/ (v2.1, `sha256:d096478f`) | CC BY 4.0 (`LICENSE`) | Isometric Icons by isocons.app (leyeConnect and meandchimso) | 2026-08-27, from the site's published bundle |
| [`lucide`](lucide/) | Lucide icons (1,808 SVGs) | https://github.com/lucide-icons/lucide (`6f56b8f1`) | ISC (`LICENSE`) | Lucide Icons and contributors | 2026-08 |
| [`coreui-icons`](coreui-icons/) | CoreUI Icons Free (562 SVGs) | https://github.com/coreui/coreui-icons (`88d1cfc4`) | Icons CC BY 4.0; fonts SIL OFL 1.1; code MIT (`LICENSE`) | CoreUI (coreui.io) | 2026-08 |
| [`famicons`](famicons/) | Famicons (1,342 SVGs) | https://github.com/familyjs/famicons (`e702639c`) | MIT (`LICENSE`) | Family | 2026-08 |
| [`stash-icons`](stash-icons/) | Stash icons (five styles, as TSX with inline SVG) | https://github.com/stash-ui/icons (`44091b18`) | MIT (`LICENSE`) | Pingback LLC | 2026-08 |
| [`threeui`](threeui/) | ThreeUI Community: the open-source edition of the ThreeUI component catalog (app, components, shaders, scene assets) | https://github.com/MengTo/threeui (`02f9835e`) | MIT (`LICENSE`); fonts SIL OFL 1.1 (`FONT-LICENSES.md`); see `ASSET-LICENSES.md` and `THIRD_PARTY_NOTICES.md` | Meng To / ThreeUI | 2026-08-26 |
| [`techartist`](techartist/) | Three Three.js demos: geometry-in-flux, bioluminescence, threejs-3d-webpage | https://iamtechartist.github.io/ (one repository per demo: `da187f63`, `2dc70cfd`, `d827a2a4`) | MIT (a `LICENSE` beside each demo) | Techartist | 2026-08-21 |
| [`codevember-2026`](codevember-2026/) | Codevember 2026: daily three.js / R3F experiments (days 04–09, 12, 14), source, notes, recordings | https://github.com/ttillberg/codevember-2026 (`4df8e67a`) | MIT (`LICENSE`) | Theo Tillberg | 2026-11-16, without `08/public/logos/` (third-party marks) |
| [`threert`](threert/) | ThreeRT: hardware ray-traced three.js, Rust + wgpu engine and TypeScript packages | https://github.com/meshy-dev/ThreeRT (`8cb4e9b1`) | MIT (`LICENSE`); see `CREDIT.md` for the parts under other licenses | Meshy LLC | 2026-11-16, without `site/` (Valve map media) or the six Khronos showroom models |
| [`ai-design-skills`](ai-design-skills/) | The landing-page-design agent skill | https://github.com/elayadesign/ai-design-skills (`456d9e0d`) | MIT (`LICENSE`) | Elaya | 2026-11-15 |
| [`jakubkrehel-skills`](jakubkrehel-skills/) | Interface agent skills (better-ui, better-typography, better-colors, interface-review and more) | https://github.com/jakubkrehel/skills (`267330e1`) | MIT (`LICENSE`) | Jakub Krehel (jakub.kr, interfaces.dev) | 2026-08 |

## Fetching
A folder's raw upstream is not in this repository: it is fetched at the pin into a cache. Run
`bun run vendor:fetch` (or `lumin vendor fetch [FOLDER…]`) once in a fresh clone, before `icons:packs:check`,
`vendor:check`, or any test that reads a folder. The cache is `.vendor/<folder>/` at the repository root,
gitignored, or `$LTS_VENDOR_CACHE/<folder>/` when that variable is set. `bun run vendor:fetch` checks each
folder's content hash after fetching it, and `lumin vendor verify` recomputes every cached hash offline.

What stays in this tree, and ships: `CREDIT.md`, the folder's license-bearing files (`LICENSE*`, `NOTICE*`,
`COPYING*`, `*LICENSES*.md`, `THIRD_PARTY_NOTICES*`) at their own paths, the pin `vendor.json`, and any kept
folder (`isocons`). Nothing is ever fetched by a test, a build or a check.

## Pins

Every `CREDIT.md` pins its folder on the `Source` line, so the folder can be reproduced and checked against upstream:

- **A commit,** in backticks: 8 to 40 hex digits (`4df8e67a`). It is the commit whose files match the folder byte for byte, apart from anything `CREDIT.md` lists as left out or changed. A branch name, a bare tag or "latest" is not a pin.
- **A version and a hash,** when upstream has no repository or publishes no archive: `v2.1, ` followed by `sha256:` and 64 hex digits, in backticks. The hash is of the folder as vendored: the sha256 of its files' `sha256  path` lines, sorted by path, with `CREDIT.md` and `.DS_Store` left out.

`bun run vendor:check` fails for a folder whose source line has neither, and recomputes the hash of a version-and-hash pin. It cannot reach upstream, so a commit pin is checked for form only: to check one, clone upstream and compare each file's blob id (`git hash-object` here, `git ls-tree` there) at that commit. After a deliberate change to a pinned folder, pin it again.

## License gate

A folder keeping its upstream license does not mean every file in it can be copied into a package: a license may ask for a credit, allow a file to be shown and nothing more, or forbid it. The policy table in [`tools/vendor/src/policy.ts`](../../tools/vendor/src/policy.ts) says what each license permits, in one of four classes:

| Class | What it allows |
|---|---|
| adopt | Copy and port freely: a public-domain dedication (CC0 1.0, a work in the public domain). |
| adopt with attribution | Copy and port, with the license's condition kept: the notice travels with the copy (MIT, ISC, Apache 2.0, BSD), or a credit, the license named and the changes stated (CC BY 4.0). `lumin adopt` then makes the credit header required, not a courtesy. |
| showcase only | Shown and studied here, never copied into a package: font software (SIL OFL 1.1, as the library ships and ports no fonts) and pictures of other people's scenes. |
| forbidden | Never copied: a copyleft or non-commercial license, and any license the table does not know. |

A folder's `vendor.json` carries `licenses`, which describe the folder path by path: each entry gives an SPDX license and either the paths it covers (globs) or `remainder` for everything else, and every file of the folder falls under exactly one entry. A folder under one license has a single `remainder` entry; a mixed folder (one whose `licenses` have more than one entry: `codevember-2026`, `coreui-icons`, `lucide`, `threert` and `threeui`) also names the paths under other licenses, so the License column of the folder table at the top of this file says what the folder mostly is and the `licenses` say what each file is. In an expression `OR` takes the more permissive class and `AND` the more restrictive. A test of `bun run test` fails a folder whose `licenses` leave a file uncovered or cover one twice, name a license the table does not know, or name paths that match no file.

`lumin adopt` and `lumin adopt-skill` read the rule for every file they would copy. A file under a showcase-only or forbidden license, or under none, refuses the whole command with `license_gate`, naming the file and the rule that applied, and copies nothing. Showcase-only material stays open for `lumin study` and for reading.

An asset's `origin` says how it relates to its folder. A work that is `ported` or `adopted` copies upstream files, so each path must be one the policy lets be copied. A work only `inspired` by another copies no code: it passes unless the path is forbidden outright.
