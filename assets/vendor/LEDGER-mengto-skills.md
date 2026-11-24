---
title: "Port candidates — materials, lighting, sky and water"
type: vendor-ledger
status: reference
created: "2026-11-24"
source: "https://github.com/MengTo/Skills at a7f25b25e9e15e1944f9fe6d69d943f77a155ef7"
license: MIT
---

# Port candidates

It sits beside `mengto-skills/` rather than inside it: the generator walks a fetched folder's cache, and with no cache it walks the folder itself, so a file inside would count in one and not the other and `vendor:check` would depend on whether the cache was warm. `assets/vendor/README.md` is beside the folders for the same reason.

What the material, lighting, sky and water skills of this folder teach, which roadmap slice each belongs to, and what stops a straight port. Nothing here is code: these are techniques read as data, and each becomes a Lumin technique only when its slice is built.

## Why nothing ports as written

- **The renderer moved.** Every one of these skills is written against three.js r169 to r187 on WebGL 2, with GLSL patched in through `onBeforeCompile` and `MeshStandardMaterial`/`MeshPhysicalMaterial` fields. Since D1 Lumin draws on the WebGPU renderer with TSL, so a port rewrites each patched term as a node; the measured constants and the build order are what survive.
- **Raw colors are not allowed in a package (D2).** The metal skill is a table of F0 linear reflectance values (steel 0.56/0.57/0.58, brass 0.89/0.72/0.36, gold 1.00/0.71/0.29, copper 0.95/0.64/0.54) and the lighting skills are tables of radiance triples. D2 says a package names no raw color: a port has to carry these through a token or a documented descriptor field, which is a design decision for D2/D4, not a copy.
- **No textures, no files.** D4 promises procedural finishes with no texture files; these skills assume image maps. The noise, footprint fade and roughness layering are the technique; the maps are not.

## Materials

| Skill | What it teaches | Slice | Port shape | Stopped by |
|---|---|---|---|---|
| `3d-metal-material` | A conductor has no color of its own: F0 per metal, a finish table (polished/brushed/aged with roughness, anisotropy, patina deltas and `envMapIntensity`), an environment built as six lit cards with linear radiance, bevels, contact darkness, bloom threshold 5.0 / gain 0.22 / quarter resolution, and nine symptom-first failures | **D4** procedural finishes, with **D3** for the tone-map and bloom order | A material descriptor whose inputs are a metal token, a finish token and an environment; the cards become a D6 room | F0 and radiance are raw colors (D2); GLSL terms have no TSL equivalent yet |
| `3d-wood-material` | One small periodic noise field read at several scales for grain, mip-footprint fade so detail does not shimmer, roughness layering | **D4** | The grain term as a node input on the existing wood descriptor | Same D2 constraint; the maps the skill assumes are not shipped |
| `3d-cloth-material` | Hanging cloth read as a weave: anisotropic highlight along the thread, sheen, depth-darkened valleys | **D4** | Weave and sheen in the D4 finish set | Cloth needs a surface normal the primitives do not have; the weave ports, the simulation does not (out of D7 scope) |
| `3d-paper-material` | Fiber roughness, edge translucency, a soft under-shadow | **D4** | Fiber and translucency as descriptor fields | Translucency needs a transmission path D3 would have to add |
| `3d-wood-lighting-scorecard` | A rubric for judging a lit wooden surface (contrast, contact, highlight shape) with a script that writes a scorecard | **D4** evidence, **D8** quality tooling later | A scoring rubric for `lumin-ui`-style reports, not code | It scores a WebGL render; the rubric survives, the script does not |

## Lighting, sky and water

| Skill | What it teaches | Slice | Port shape | Stopped by |
|---|---|---|---|---|
| `3d-sky-background` | Three separate responsibilities (visible sky, reflection/ambient environment, direct sun) and one shared sun direction derived from the normalized view direction | **D6** environments | A sky node plus the environment it feeds | None beyond the D2 constraint |
| `3d-sky-rays` | An occlusion-aware post pass: linear HDR color, a sky mask, a radial march toward the sun, additive composite before the tone map | **D3** stage quality, `packages/postfx` | A postfx effect with a mask input | None technical; it is a pass like the ones postfx already runs |
| `3d-ultra-realistic-water` | A deep-water Gerstner spectrum shaded per pixel, with a horizon and a sun | **D6** | A TSL water material, per-face normals from the spectrum | Needs a custom node material (D1's renderer), not a port |
| `3d-harbour-water` | Calmer water for a harbour: smaller amplitude, foam at the walls, a reflecting plane | **D6** | The same water node with a shallow preset | Same as above |
| `3d-underwater-god-rays` | Light shafts through a volume, with a per-pixel depth fade | **D3** | A postfx pass with a depth texture | r170 GLSL; the volume has no TSL equivalent yet |
| `light-a-threejs-workspace` | A working light rig: key, fill, rim, practical and emissive roles, each with a purpose | **D3** per-look lights, **D6** rooms | Light roles as part of the look, not per asset | The rig is written as three.js objects; the roles are the technique |
| `relight-painted-surfaces` | Re-lighting a painted surface by rebuilding its normals from a height field | **D3** | A relight pass over a finished frame | r187 GLSL and a Python bake step; the bake is outside a package |
| `3d-kasumidera-ultra-realism` | A photograph-first art direction: reference intake, camera and lens choice, framing, and a delivery checklist | **D6** art direction | Reference material for how a room is composed, and prompts for judging it | Nothing technical; it is direction, not code, and its prompt files are not vendored here |
| `3d-high-resolution-textures` | Texture resolution and mip discipline for a large scene | **D3** budgets | Guidance for the D3 quality tiers | It assumes texture files; Lumin's finishes are procedural |
| `control-camera-lenses` | Lens behaviour: focal length, aperture, distortion, depth of field | **D3** camera and depth of field | A lens descriptor on the camera | Needs D3's depth-of-field pass first |

## What this ledger is not

- Not a plan: no slice above is started by this folder, and no code from it enters the tree. The vendor keeps Markdown only.
- Not a license question: the folder is MIT and the credit says so; a port carries its own `origin` and credit when it happens.
- Not a promise: D2 may rule that some of these constants never enter a package, in which case the entry stays a technique note and the slice ships without it.
