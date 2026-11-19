import type { Scene } from "@hedronite/lts-scene";

/**
 * The regressions the strict round trip must catch, each made in the document and so in the code emitted for it: a node moved,
 * an effect dropped, a parameter changed. `bun run scenes:plants` emits the planted document's module into `e2e/scenes/plants/`
 * (never committed), and the spec draws it through `still.html?scene=<fixture>&via=code&plant=<name>`.
 */
export const plantNames = ["moved-node", "dropped-effect", "changed-parameter"] as const;
export type PlantName = (typeof plantNames)[number];

/** A numeric parameter moved to another value its schema takes (cells, bands and hours all have room two either way). */
const nudged = (value: number): number => (value > 3 ? value - 2 : value + 2);

/** The document with the plant made in it, or undefined where the plant has nothing to act on (a document with no effects drops none, one with no parameters changes none). */
export function planted(scene: Scene, plant: PlantName): Scene | undefined {
  switch (plant) {
    case "moved-node": {
      const [first, ...rest] = scene.nodes;
      if (first === undefined) return undefined;
      const [x, y, z] = first.position;
      return { ...scene, nodes: [{ ...first, position: [x + 0.5, y, z] }, ...rest] };
    }
    case "dropped-effect":
      return scene.effects.length === 0 ? undefined : { ...scene, effects: scene.effects.slice(1) };
    case "changed-parameter": {
      // A screen effect's parameter shows across the whole picture, a surface's across its node, an asset's in the node: the widest first.
      for (const [index, effect] of scene.effects.entries()) {
        const [key, value] = Object.entries(effect.params ?? {}).find((entry): entry is [string, number] => typeof entry[1] === "number") ?? [];
        if (key !== undefined && value !== undefined) return { ...scene, effects: scene.effects.map((each, at) => (at === index ? { ...effect, params: { ...effect.params, [key]: nudged(value) } } : each)) };
      }
      for (const [index, node] of scene.nodes.entries()) {
        const surface = node.surface;
        if (surface?.params !== undefined) {
          const [key, value] = Object.entries(surface.params).find((entry): entry is [string, number] => typeof entry[1] === "number") ?? [];
          if (key !== undefined && value !== undefined) return { ...scene, nodes: scene.nodes.map((each, at) => (at === index ? { ...node, surface: { ...surface, params: { ...surface.params, [key]: nudged(value) } } } : each)) };
        }
        if (node.asset.params !== undefined) {
          const [key, value] = Object.entries(node.asset.params).find((entry): entry is [string, number] => typeof entry[1] === "number") ?? [];
          if (key !== undefined && value !== undefined) return { ...scene, nodes: scene.nodes.map((each, at) => (at === index ? { ...node, asset: { ...node.asset, params: { ...node.asset.params, [key]: nudged(value) } } } : each)) };
        }
      }
      return undefined;
    }
  }
}
