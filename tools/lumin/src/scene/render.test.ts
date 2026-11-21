import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Picture } from "../../../stills/src/png.js";
import { checkSide, isBlank, MAX_SIDE, renderScene, serve } from "./render.js";

const scratch = mkdtempSync(join(tmpdir(), "lts-render-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A picture of one color, with `plant` pixels (index to RGBA) set to another. */
function picture(width: number, height: number, color: readonly [number, number, number, number], plant: ReadonlyMap<number, readonly [number, number, number, number]> = new Map()): Picture {
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) rgba.set(plant.get(pixel) ?? color, pixel * 4);
  return { width, height, rgba };
}

const background = [245, 245, 245, 255] as const;

describe("isBlank", () => {
  it("is true for a frame of the stage's color and nothing else", () => {
    expect(isBlank(picture(8, 8, background))).toBe(true);
  });

  it("is false when one pixel, in any channel, is not the background", () => {
    expect(isBlank(picture(8, 8, background, new Map([[63, [245, 245, 244, 255]]])))).toBe(false);
    expect(isBlank(picture(8, 8, background, new Map([[0, [0, 0, 0, 255]]])))).toBe(false);
    expect(isBlank(picture(8, 8, background, new Map([[31, [245, 245, 245, 254]]])))).toBe(false);
  });

  it("is false for a frame that is another flat color: it is blank only against the stage's own", () => {
    expect(isBlank(picture(8, 8, [10, 10, 10, 255]))).toBe(false);
  });
});

describe("checkSide", () => {
  it("takes a side that is left out, and a whole number up to the cap", () => {
    expect(checkSide("width", undefined)).toBeUndefined();
    expect(checkSide("width", 1)).toBeUndefined();
    expect(checkSide("height", MAX_SIDE)).toBeUndefined();
  });

  it("names a side that is over the cap, under 1, or not a whole number", () => {
    expect(checkSide("width", MAX_SIDE + 1)).toBe("--width is at most 2048 pixels, and 2049 was asked");
    expect(checkSide("height", 0)).toBe("--height is a whole number of pixels, not 0");
    expect(checkSide("height", 100.5)).toBe("--height is a whole number of pixels, not 100.5");
    expect(checkSide("width", Number.NaN)).toBe("--width is a whole number of pixels, not NaN");
  });
});

describe("renderScene before any browser starts", () => {
  const paths = { root: scratch, command: "render" };
  const options = { document: "{}", out: join(scratch, "out.png") };

  it("refuses a side over the cap as a usage error, and says so before it looks for a build", async () => {
    expect(await renderScene({ ...options, width: 4096 }, paths)).toMatchObject({ ok: false, kind: "usage", exit: 2 });
    expect(await renderScene({ ...options, height: 4096 }, paths)).toMatchObject({ ok: false, kind: "usage", exit: 2 });
  });

  it("says not_built when the catalog has no still page", async () => {
    expect(await renderScene(options, paths)).toMatchObject({ ok: false, kind: "not_built", exit: 1 });
    mkdirSync(join(scratch, "apps/catalog/dist"), { recursive: true });
    expect(await renderScene(options, paths)).toMatchObject({ ok: false, kind: "not_built" });
  });
});

describe("serve", () => {
  it("serves a file of the built directory, refuses a path out of it, and answers 404 for a missing one", async () => {
    const dist = join(scratch, "served");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "still.html"), "<p>still</p>");
    writeFileSync(join(scratch, "secret.txt"), "outside");
    const { server, origin } = await serve(dist);
    try {
      const page = await fetch(`${origin}/still.html?doc`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await page.text()).toBe("<p>still</p>");
      expect((await fetch(`${origin}/nothing.js`)).status).toBe(404);
      expect((await fetch(`${origin}/..%2fsecret.txt`)).status).toBe(404);
      expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await new Promise<void>((done) => {
        server.close(() => {
          done();
        });
      });
    }
  });
});
