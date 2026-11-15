# @hedronite/lts-adapters

React Three Fiber components over the libraries. Each owns its GPU resources and frees them on change or unmount. React and R3F are optional peers; every other package works without this one.

```tsx
import { PrimitiveMesh, StudioLights, CrystalCluster } from "@hedronite/lts-adapters";

<Canvas>
  <StudioLights />
  <PrimitiveMesh primitive="platonic-icosahedron" material="glass" />
  <CrystalCluster count={9} seed={3} position={[1.5, 0, 0]} />
</Canvas>
```
