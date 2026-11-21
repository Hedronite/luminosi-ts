# Credit

- **What:** ThreeRT: hardware ray-traced three.js, a real-time path tracer behind a three.js-style API (Rust + wgpu engine, TypeScript scene and gameplay packages, showcase scenes, docs)
- **Source:** https://github.com/meshy-dev/ThreeRT (`8cb4e9b1`)
- **License:** MIT (`LICENSE`); patched dependencies under their own licenses (glamx: MIT or Apache-2.0; parry3d: its own license); the city tool is from jeantimex's tokyo (MIT); the Poly Haven models are CC0
- **Credit:** Meshy LLC
- **Pulled:** 2026-11-16

Vendored into LuminosiTS as published, except:
- `site/` (the threert.dev marketing site) is left out. Its media include screenshots of Counter-Strike maps, which are Valve's and not open source.
- `showcase/showroom/assets/*.glb` (six Khronos glTF sample models, each under its own CC0 or CC BY 4.0 license, shipped without per-model attribution) is left out. The showroom case needs them fetched again.
- The repository's `.github/` and `.claude/` tooling folders are left out.

ThreeRT's own assets are not in its repository (`bun scripts/setup.ts` fetches them); `docs/ASSETS.md` lists their terms. The macOS and iOS clients are closed source and not included. Site: https://threert.dev. The license above applies to this folder, not LuminosiTS's own.
