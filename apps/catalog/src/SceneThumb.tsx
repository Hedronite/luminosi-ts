import { primitive } from "@hedronite/lts-primitives";
import { sceneKit, type SceneKitId } from "@hedronite/lts-scenes";
import { Wireframe } from "./Wireframe";

/** A scene kit's composition seen from the front: each placement's wireframe at its x/y position and scale. */
export function SceneThumb({ id, size }: { readonly id: SceneKitId; readonly size: number }) {
  return (
    <svg width={size} height={size} viewBox="-1.3 -1.3 2.6 2.6" aria-hidden="true">
      {sceneKit(id).placements.map((p) => {
        const extent = p.scale * 2.4;
        return (
          <svg key={`${p.primitive}-${String(p.position[0])}`} x={p.position[0] - extent / 2} y={-p.position[1] - extent / 2} width={extent} height={extent} viewBox="-1.2 -1.2 2.4 2.4" overflow="visible">
            <Wireframe shape={primitive(p.primitive)} size={extent} />
          </svg>
        );
      })}
    </svg>
  );
}
