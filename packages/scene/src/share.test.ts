/// <reference types="node" />
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { currentFixtures, fixtureScene, fixtureText, scenes } from "./arbitrary.js";
import { toCanonicalJson } from "./emit/json.js";
import { migrate } from "./migrate.js";
import { decodeScene, encodeScene, SHARE_LIMITS, SHARE_PREFIX } from "./share.js";
import type { SceneResult } from "./schema.js";

/** The deflated bytes of some bytes, written here with the platform's own stream so the codec is held to the format and not to itself. */
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const packed = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(packed).arrayBuffer());
}

const base64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** A link made from any text, by hand. */
async function linkOf(text: string): Promise<string> {
  return `${SHARE_PREFIX}${base64Url(await deflate(new TextEncoder().encode(text)))}`;
}

/** The named issues of a result that failed. */
function failed(result: SceneResult): readonly { readonly code: string; readonly path: readonly (string | number)[]; readonly message: string }[] {
  if (result.ok) throw new Error("the link was accepted");
  return result.issues;
}

const codesOf = (result: SceneResult): string[] => failed(result).map((issue) => issue.code);

/** Whether a value is a result of `decodeScene`: an object that says whether it is ok. */
const isResult = (value: unknown): value is SceneResult => typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";

/** A result that is a result: ok with a document that holds, or not ok with issues that each have a name, a path and a sentence. */
function isWellFormed(result: SceneResult): boolean {
  if (result.ok) return typeof result.scene === "object";
  return result.issues.length > 0 && result.issues.every((issue) => issue.code.length > 0 && Array.isArray(issue.path) && issue.message.length > 0);
}

describe("a link", () => {
  it("is s1. and then base64url of deflated canonical JSON, in the form the platform reads", async () => {
    const link = await encodeScene(fixtureScene("v1"));
    expect(link.startsWith("s1.")).toBe(true);
    expect(link.slice(3)).toMatch(/^[A-Za-z0-9_-]+$/);
    const inflated = new Response(new Blob([Buffer.from(link.slice(3), "base64url")]).stream().pipeThrough(new DecompressionStream("deflate-raw")));
    expect(await inflated.text()).toBe(toCanonicalJson(fixtureScene("v1")));
  });

  it.each(currentFixtures)("opens as the same document for the %s fixture, and fits in a link", async (name) => {
    const scene = fixtureScene(name);
    const link = await encodeScene(scene);
    expect(link.length).toBeLessThanOrEqual(SHARE_LIMITS.link);
    const result = await decodeScene(link);
    expect(result).toEqual({ ok: true, scene });
  });

  it("opens as the same document for every valid document, negative zero and awkward ids included", async () => {
    await fc.assert(
      fc.asyncProperty(scenes, async (scene) => {
        const result = await decodeScene(await encodeScene(scene));
        expect(result).toEqual({ ok: true, scene });
      }),
      { numRuns: 20 },
    );
  });

  it("is one text for one document", async () => {
    await fc.assert(
      fc.asyncProperty(scenes, async (scene) => {
        expect(await encodeScene(structuredClone(scene))).toBe(await encodeScene(scene));
      }),
      { numRuns: 25 },
    );
  });

  it("opens a link made from a version 0 document, the playground's old JSON, as a document of the current version", async () => {
    const result = await decodeScene(await linkOf(fixtureText("v0")));
    expect(result).toEqual(migrate(fixtureText("v0")));
    expect(result.ok && result.scene.version).toBe(2);
    expect(result.ok && result.scene.nodes.map((node) => node.id).slice(0, 2)).toEqual(["node-1", "node-2"]);
  });

  it("is read with the space around it taken off, as a link pasted from a message may have", async () => {
    const link = await encodeScene(fixtureScene("v1"));
    expect(await decodeScene(`  ${link}\n`)).toEqual({ ok: true, scene: fixtureScene("v1") });
  });
});

describe("a link that is not one", () => {
  it("is named, with no throw, for each way of being wrong", async () => {
    const good = await linkOf(toCanonicalJson(fixtureScene("v1")));
    const cases: readonly (readonly [string, string, string])[] = [
      ["empty", "", "not-a-link"],
      ["no prefix", good.slice(3), "not-a-link"],
      ["another version", `s2.${good.slice(3)}`, "not-a-link"],
      ["only a prefix", "s1.", "bad-compression"],
      ["bad base64 (characters that are not base64url)", "s1.!!!!not base64!!!!", "bad-encoding"],
      ["standard base64 with padding", `s1.${Buffer.from("hello world").toString("base64")}`, "bad-encoding"],
      ["a partial byte", "s1.A", "bad-encoding"],
      ["valid base64 of junk", `s1.${Buffer.from("this is not deflate data at all").toString("base64url")}`, "bad-compression"],
      ["deflate of text that is not JSON", await linkOf("not json"), "invalid-json"],
      ["deflate of a JSON value that is not a document", await linkOf("[1, 2, 3]"), "wrong-type"],
      ["deflate of bytes that are not UTF-8", `s1.${base64Url(await deflate(new Uint8Array([0xff, 0xfe, 0xfd])))}`, "invalid-json"],
      ["deflate of a document of a later version", await linkOf(JSON.stringify({ format: "lts-scene", version: 9 })), "unsupported-version"],
    ];
    for (const [label, text, code] of cases) {
      // eslint-disable-next-line no-await-in-loop -- one case after another keeps the failing one named
      const result = await decodeScene(text);
      expect([label, isWellFormed(result), codesOf(result)]).toEqual([label, true, [code]]);
    }
  });

  it("names a document that reads badly by its path, as migrate does", async () => {
    const broken = { ...fixtureScene("v1"), lights: { rig: "studio", intensity: 99 } };
    const result = await decodeScene(await linkOf(JSON.stringify(broken)));
    expect(failed(result)).toEqual([expect.objectContaining({ path: ["lights", "intensity"], code: "out-of-range" })]);
  });

  it("refuses a link over 16 KiB by its length, before it reads it", async () => {
    const seventeen = `s1.${"A".repeat(17 * 1024)}`;
    const result = await decodeScene(seventeen);
    expect(codesOf(result)).toEqual(["link-too-long"]);
    expect(failed(result)[0]?.message).toContain("17411");
    // The line: 16384 characters are read (and found not to be deflate), 16385 are refused by length.
    expect(codesOf(await decodeScene(`s1.${"A".repeat(SHARE_LIMITS.link - 3)}`))).not.toContain("link-too-long");
    expect(codesOf(await decodeScene(`s1.${"A".repeat(SHARE_LIMITS.link - 2)}`))).toEqual(["link-too-long"]);
  });

  it("refuses a document that inflates past 256 KiB, and takes one that fills it exactly", async () => {
    const text = toCanonicalJson(fixtureScene("v1"));
    const padded = (size: number): string => `${text}${" ".repeat(size - new TextEncoder().encode(text).length)}`;
    const over = await decodeScene(await linkOf(padded(300 * 1024)));
    expect(codesOf(over)).toEqual(["document-too-large"]);
    expect(codesOf(await decodeScene(await linkOf(padded(SHARE_LIMITS.document + 1))))).toEqual(["document-too-large"]);
    expect(await decodeScene(await linkOf(padded(SHARE_LIMITS.document)))).toEqual({ ok: true, scene: fixtureScene("v1") });
  });

  it("stops inflating at the limit: a small link that holds a huge text is refused, quickly", async () => {
    // Eight million zero bytes deflate to a few kilobytes: a link, well under the length cap, that would fill memory if it were inflated whole.
    const bomb = `s1.${base64Url(await deflate(new Uint8Array(8_000_000)))}`;
    expect(bomb.length).toBeLessThan(SHARE_LIMITS.link);
    const before = performance.now();
    const result = await decodeScene(bomb);
    expect(codesOf(result)).toEqual(["document-too-large"]);
    expect(performance.now() - before).toBeLessThan(2000);
  });
});

describe("decodeScene never throws", () => {
  it("returns a result for any string at all", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string(), fc.uint8Array({ maxLength: 40 }).map((bytes) => String.fromCharCode(...bytes)), fc.constant("")), async (text) => {
        // A rejection fails the property: the promise is awaited through `resolves`.
        await expect(decodeScene(text)).resolves.toSatisfy(isWellFormed);
      }),
      { numRuns: 40 },
    );
  });

  it("returns a result for any string that starts like a link, and for base64url of any bytes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string().map((tail) => `s1.${tail}`),
          fc.stringMatching(/^[A-Za-z0-9_-]{0,300}$/).map((tail) => `s1.${tail}`),
          fc.uint8Array({ maxLength: 300 }).map((bytes) => `s1.${base64Url(bytes)}`),
        ),
        async (text) => {
          // A rejection fails the property: the promise is awaited through `resolves`.
        await expect(decodeScene(text)).resolves.toSatisfy(isWellFormed);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("returns a result for a real link cut short, with a character changed, or with bytes added", async () => {
    const link = await encodeScene(fixtureScene("framed-solid-shader"));
    await fc.assert(
      fc.asyncProperty(fc.nat(link.length), fc.constantFrom("A", "-", "_", "=", "+", "!", "é"), fc.uint8Array({ maxLength: 40 }), async (at, character, extra) => {
        for (const text of [link.slice(0, at), `${link.slice(0, at)}${character}${link.slice(at + 1)}`, `${link}${base64Url(extra)}`]) {
          // A rejection fails the property: the promise is awaited through `resolves`.
          // eslint-disable-next-line no-await-in-loop -- three texts, one after another
          await expect(decodeScene(text)).resolves.toSatisfy(isWellFormed);
        }
      }),
      { numRuns: 25 },
    );
  });

  it("returns a result for a value that is not a string", async () => {
    for (const value of [undefined, null, 0, {}, [], Symbol("x")]) {
      const outcome: unknown = Reflect.apply(decodeScene, undefined, [value]);
      // eslint-disable-next-line no-await-in-loop -- one value after another
      await expect(Promise.resolve(outcome)).resolves.toSatisfy((result: unknown) => isResult(result) && isWellFormed(result));
    }
  });
});
