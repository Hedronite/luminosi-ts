import type { Page } from "@playwright/test";

/** The four ways a loose check is shown to fail: what a regression would do to the picture. */
export const plants = ["blank canvas", "recoloured subject", "missing part", "moved camera"] as const;
export type Plant = (typeof plants)[number];

/** Alters the page the rig drew, the way a regression would alter the picture. `clear` undoes it. */
export async function plant(page: Page, what: Plant | "clear"): Promise<void> {
  await page.evaluate((change) => {
    const stage = document.querySelector<HTMLElement>('[data-testid="still"]');
    if (stage === null) throw new Error("the page has no still stage");
    const canvas = stage.querySelector("canvas");
    if (canvas === null) throw new Error("the still stage has no canvas");
    document.getElementById("plant")?.remove();
    canvas.style.visibility = "";
    canvas.style.filter = "";
    canvas.style.transform = "";
    if (change === "blank canvas") canvas.style.visibility = "hidden";
    if (change === "recoloured subject") canvas.style.filter = "sepia(1) hue-rotate(140deg) saturate(1.5)";
    // The camera a few degrees along: the picture shifted and a little larger.
    if (change === "moved camera") canvas.style.transform = "translate(16px, 10px) scale(1.04)";
    if (change === "missing part") {
      // A block of the middle of the stage painted over with the stage's own background.
      const block = document.createElement("div");
      block.id = "plant";
      block.style.cssText = "position:absolute;left:176px;top:176px;width:160px;height:160px;background:#f5f5f5";
      stage.append(block);
    }
  }, what);
}
