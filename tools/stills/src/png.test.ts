import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng } from "./png.js";

const crc = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)));
  return out;
};

/** A PNG whose rows are given already filtered. */
const png = (width: number, height: number, color: 2 | 6, filtered: readonly number[]): Uint8Array => {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = color;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Uint8Array.from(filtered))), chunk("IEND", new Uint8Array())];
  return Uint8Array.from(parts.flatMap((part) => [...part]));
};

describe("decodePng", () => {
  it("reads unfiltered RGBA rows", () => {
    const picture = decodePng(png(2, 1, 6, [0, 1, 2, 3, 4, 5, 6, 7, 8]));
    expect([picture.width, picture.height]).toEqual([2, 1]);
    expect([...picture.rgba]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("gives RGB pictures an opaque alpha", () => {
    expect([...decodePng(png(1, 1, 2, [0, 10, 20, 30])).rgba]).toEqual([10, 20, 30, 255]);
  });

  it("undoes the sub, up, average and Paeth filters", () => {
    // Two rows of two RGB pixels; row one is Sub, row two is Up, then the same shapes again with Average and Paeth.
    const sub = decodePng(png(2, 1, 2, [1, 10, 20, 30, 1, 1, 1])).rgba;
    expect([...sub]).toEqual([10, 20, 30, 255, 11, 21, 31, 255]);
    const up = decodePng(png(1, 2, 2, [0, 5, 6, 7, 2, 1, 1, 1])).rgba;
    expect([...up]).toEqual([5, 6, 7, 255, 6, 7, 8, 255]);
    const average = decodePng(png(2, 1, 2, [3, 10, 20, 30, 0, 0, 0])).rgba;
    expect([...average]).toEqual([10, 20, 30, 255, 5, 10, 15, 255]);
    const paeth = decodePng(png(2, 2, 2, [0, 10, 10, 10, 20, 20, 20, 4, 5, 5, 5, 6, 6, 6])).rgba;
    expect([...paeth]).toEqual([10, 10, 10, 255, 20, 20, 20, 255, 15, 15, 15, 255, 26, 26, 26, 255]);
  });

  it("refuses what it cannot read", () => {
    expect(() => decodePng(Uint8Array.from([1, 2, 3]))).toThrow("not a PNG");
    const header = new Uint8Array(13);
    new DataView(header.buffer).setUint32(0, 1);
    new DataView(header.buffer).setUint32(4, 1);
    header[8] = 16;
    header[9] = 2;
    const sixteen = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", header)]);
    expect(() => decodePng(sixteen)).toThrow("unsupported PNG");
  });
});
