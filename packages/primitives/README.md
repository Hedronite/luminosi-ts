# @hedronite/lts-primitives

Polyhedra as data, built from a convex hull: Platonic solids, prisms, antiprisms, bipyramids and geodesic spheres. Plus three.js helpers: flat-shaded geometry, a studio light rig and `disposeObject`.

```ts
import { createPolyhedronGeometry, primitive, platonic, disposeObject } from "@hedronite/lts-primitives";
const geometry = createPolyhedronGeometry(primitive("platonic-icosahedron")); // you own it: geometry.dispose()
const shape = platonic("dodecahedron", 2);                                       // vertices and faces, no WebGL
```
