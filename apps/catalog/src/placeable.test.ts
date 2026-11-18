import { describe, expect, it } from "vitest";
import { loadPlaceable } from "./placeable";

describe("loadPlaceable", () => {
  it("lists the objects a stage can hold, named by their descriptors", async () => {
    const placeable = await loadPlaceable();
    const byId = new Map(placeable.map((object) => [object.id, object]));
    expect(byId.get("dress-watch")?.name).toBe("Your dress watch");
    expect(byId.has("your-desk-lamp")).toBe(true);
    expect(byId.has("crystal-cluster")).toBe(true);
  });

  it("leaves out an object that needs a model url", async () => {
    expect((await loadPlaceable()).some((object) => object.id === "crystal-cluster-glb")).toBe(false);
  });

  it("says which objects take a material: the ones whose descriptor has one", async () => {
    const taking = (await loadPlaceable()).filter((object) => object.takesMaterial).map((object) => object.id);
    expect(taking).toEqual(["crystal-cluster", "instanced-lattice"]);
  });
});
